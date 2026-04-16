import { IFileEntry, IRegistry } from '@/types/registry';

import { DEFAULT_OLLAMA_CONFIG, IFileContentConfig, OllamaReranker } from './ollama-reranker';
import { PelicanLock } from './pelican-lock';

export interface IRerankerConfig {
  enabled: boolean;
  ollamaModel: string;
  ollamaHost: string;
  /** Max concurrent Ollama calls. */
  concurrency: number;
  /** Absolute relevance threshold applied to pelican score after boost. */
  threshold: number;
  /** Always keep at least this many results. */
  minKeep: number;
  /** Score boost for LLM-confirmed pairs. */
  confirmedBoost: number;
  /** Score boost for lock-cached confirmed pairs. */
  cacheBoost: number;
  /** Controls how file content is sampled and filtered before sending to the LLM. */
  fileContent?: Partial<IFileContentConfig>;
  debug?: boolean;
  lockPath?: string;
  onProgress?: (info: IRerankerProgress) => void;
}

export interface IRerankerProgress {
  status: 'checking' | 'scoring' | 'ready' | 'unavailable';
  scored?: number;
  total?: number;
  model?: string;
}

export const DEFAULT_RERANKER_CONFIG: IRerankerConfig = {
  enabled: true,
  ollamaModel: DEFAULT_OLLAMA_CONFIG.model,
  ollamaHost: DEFAULT_OLLAMA_CONFIG.host,
  concurrency: DEFAULT_OLLAMA_CONFIG.concurrency,
  threshold: 0.3,
  minKeep: 1,
  confirmedBoost: 0.15,
  cacheBoost: 0.2,
  lockPath: '.pelican/pelican.lock',
};

export interface IRerankCandidate {
  testFile: string;
  pelicanScore: number;
}

export interface IRerankResult {
  testFile: string;
  combined: number;
  kept: boolean;
  /** LLM-generated or cached explanation for why this test is relevant. */
  reason?: string;
  /** True when the result came from the .pelican.lock cache (no LLM call made). */
  fromCache: boolean;
}

export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

/**
 * Semantic reranker using a local Ollama LLM + `.pelican/pelican.lock` cache.
 *
 * Pipeline per changed file:
 *   1. Load lock cache from disk.
 *   2. Candidates confirmed in the lock → kept immediately with cached reason.
 *   3. Candidates rejected in the lock → dropped (no LLM call).
 *   4. Unknown candidates → sent to OllamaReranker in parallel.
 *      - LLM says relevant → confirm in lock, keep.
 *      - LLM says irrelevant → reject in lock, drop.
 *   5. Flush lock to disk.
 *   6. Blend LLM verdict with pelican score (additive boost).
 *
 * If Ollama is unavailable, the lock still acts as the source of truth:
 * cached confirmed pairs are surfaced, uncached pairs pass through with
 * pelican scores only.
 */
export class SemanticReranker {
  private config: IRerankerConfig;
  private ollama: OllamaReranker;
  private lock: PelicanLock;

  constructor(config: Partial<IRerankerConfig> = {}) {
    this.config = { ...DEFAULT_RERANKER_CONFIG, ...config };
    this.ollama = new OllamaReranker({
      model: this.config.ollamaModel,
      host: this.config.ollamaHost,
      concurrency: this.config.concurrency,
      debug: this.config.debug,
      fileContent: this.config.fileContent,
    });
    this.lock = new PelicanLock(this.config.lockPath);
  }

  /**
   * Check Ollama availability. Does NOT throw — unavailability is non-fatal.
   * The lock cache works without the LLM.
   */
  async warmUp(): Promise<void> {
    if (!this.config.enabled) return;
    await this.lock.load();
    this.config.onProgress?.({ status: 'checking', model: this.config.ollamaModel });
    const ok = await this.ollama.checkAvailable();
    if (!ok) {
      this.config.onProgress?.({ status: 'unavailable' });
      throw new ModelUnavailableError(
        `Ollama model "${this.config.ollamaModel}" not available at ${this.config.ollamaHost}. ` +
          `Run: ollama pull ${this.config.ollamaModel}`,
      );
    }
    this.config.onProgress?.({ status: 'ready', model: this.config.ollamaModel });
  }

  isAvailable(): boolean {
    return this.config.enabled && this.ollama.isAvailable();
  }

  async rerank(
    changedFile: string,
    candidates: IRerankCandidate[],
    registry: IRegistry,
  ): Promise<IRerankResult[]> {
    if (!this.config.enabled || candidates.length === 0) {
      return candidates.map((c) => ({
        testFile: c.testFile,
        combined: c.pelicanScore,
        kept: true,
        fromCache: false,
      }));
    }

    await this.lock.load();

    const results: IRerankResult[] = [];
    const toScore: IRerankCandidate[] = [];

    // Partition: cached confirmed, cached rejected, unknown.
    // Don't trust cached rejections for high-scoring candidates — if pelican
    // is confident (>= threshold), re-evaluate rather than serving a stale
    // LLM rejection that might have been wrong.
    const HIGH_SCORE_OVERRIDE = this.config.threshold + 0.2;

    for (const cand of candidates) {
      if (this.lock.isConfirmed(changedFile, cand.testFile)) {
        const reason = this.lock.getReason(changedFile, cand.testFile);
        results.push({
          testFile: cand.testFile,
          combined: Math.min(1, cand.pelicanScore + this.config.cacheBoost),
          kept: true,
          reason,
          fromCache: true,
        });
      } else if (this.lock.isRejected(changedFile, cand.testFile)) {
        if (cand.pelicanScore >= HIGH_SCORE_OVERRIDE) {
          // Pelican is very confident — don't trust a cached rejection, re-score
          toScore.push(cand);
        } else {
          results.push({
            testFile: cand.testFile,
            combined: cand.pelicanScore,
            kept: false,
            fromCache: true,
          });
        }
      } else {
        toScore.push(cand);
      }
    }

    if (this.config.debug) {
      process.stderr.write(
        `[rerank] ${changedFile}: ${results.filter((r) => r.fromCache && r.kept).length} from lock cache, ` +
          `${results.filter((r) => r.fromCache && !r.kept).length} rejected from lock, ` +
          `${toScore.length} to score\n`,
      );
    }

    // Score unknown candidates with Ollama (if available)
    if (toScore.length > 0 && this.ollama.isAvailable()) {
      const sourceEntry = registry.getFile(changedFile) as IFileEntry | undefined;
      if (sourceEntry) {
        const testEntries = toScore.map((c) => ({
          testFile: c.testFile,
          entry: registry.getFile(c.testFile) as IFileEntry | undefined,
        }));

        this.config.onProgress?.({ status: 'scoring', scored: 0, total: toScore.length });
        const llmResults = await this.ollama.rerankPairs(sourceEntry, changedFile, testEntries);
        let scored = 0;

        for (const llm of llmResults) {
          const cand = toScore.find((c) => c.testFile === llm.testFile)!;
          if (llm.relevant) {
            this.lock.confirm(changedFile, llm.testFile, llm.reason);
            results.push({
              testFile: llm.testFile,
              combined: Math.min(1, cand.pelicanScore + this.config.confirmedBoost),
              kept: true,
              reason: llm.reason,
              fromCache: false,
            });
          } else {
            this.lock.reject(changedFile, llm.testFile);
            results.push({
              testFile: llm.testFile,
              combined: cand.pelicanScore,
              kept: false,
              reason: llm.reason,
              fromCache: false,
            });
          }
          scored++;
          this.config.onProgress?.({ status: 'scoring', scored, total: toScore.length });
        }
      } else {
        // Source file not in registry — can't build LLM prompt, pass through with pelican scores
        if (this.config.debug) {
          process.stderr.write(`[rerank] ${changedFile}: not found in registry, skipping LLM\n`);
        }
        for (const cand of toScore) {
          results.push({
            testFile: cand.testFile,
            combined: cand.pelicanScore,
            kept: cand.pelicanScore >= this.config.threshold,
            fromCache: false,
          });
        }
      }
    } else if (toScore.length > 0) {
      // LLM unavailable — pass through unknowns so pelican-only results still show
      for (const cand of toScore) {
        results.push({
          testFile: cand.testFile,
          combined: cand.pelicanScore,
          kept: cand.pelicanScore >= this.config.threshold,
          fromCache: false,
        });
      }
    }

    await this.lock.flush();

    // No minKeep — if the LLM rejects all candidates, zero suggestions is
    // the correct answer. Force-keeping a rejected test is misleading.

    if (this.config.debug) {
      const keptCount = results.filter((r) => r.kept).length;
      process.stderr.write(`[rerank] kept ${keptCount}/${results.length} for ${changedFile}\n`);
    }

    return results;
  }
}

export type { IFileContentConfig, IFileEntry };
