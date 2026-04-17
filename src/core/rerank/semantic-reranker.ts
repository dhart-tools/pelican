import { IFileEntry, IRegistry } from '@/types/registry';

import {
  BiEncoderPrefilter,
  DEFAULT_BI_ENCODER_CONFIG,
  IBiEncoderCandidate,
} from './bi-encoder-prefilter';
import { CrossEncoderReranker } from './cross-encoder-reranker';
import {
  BUCKET_MULTIPLIER,
  DEFAULT_OLLAMA_CONFIG,
  IFileContentConfig,
  OllamaReranker,
} from './ollama-reranker';
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
  /** Base git ref for diff extraction. Flows through to OllamaReranker. */
  base?: string;
  /** Target git ref for diff extraction. Flows through to OllamaReranker. */
  target?: string;
  /**
   * When enabled, a local cross-encoder scores `(source, test)` pairs before
   * the LLM. Pairs scoring below `cePrefilterThreshold` are marked irrelevant
   * without an Ollama call. Set to a very low value (default 0.08) so only
   * obvious non-matches are dropped — the LLM still decides the ambiguous
   * middle. Disable if the CE model can't be downloaded.
   */
  cePrefilter?: boolean;
  /** Sigmoid score below which CE will drop a pair. Default 0.08. */
  cePrefilterThreshold?: number;
  /**
   * When enabled, a local bi-encoder (code-trained embedding model via Ollama)
   * ranks all candidates by cosine similarity and keeps only the top
   * `biEncoderTopK`. Makes the downstream LLM cost O(1) per source regardless
   * of repo size. Default true.
   */
  biEncoderPrefilter?: boolean;
  /** Ollama embedding model. Default jina/jina-embeddings-v2-base-code. */
  biEncoderModel?: string;
  /**
   * Safety ceiling on surviving candidates after bi-encoder ranking. Not a
   * forced fill — real pruning comes from the bi-encoder's min-score floor.
   * Default 30.
   */
  biEncoderTopK?: number;
  /** Disk cache for embeddings. Default `.pelican/embeddings.json`. */
  biEncoderCachePath?: string;
  /**
   * When false, bypass the `.pelican.lock` cache entirely — every candidate is
   * sent to the LLM regardless of prior confirm/reject state, and no new
   * entries are written. Useful for debugging filter behavior. Default true.
   */
  useCache?: boolean;
  /**
   * When true, the reranker asks the LLM for a short explanation per test.
   * When false (default), only the boolean verdict is requested — much faster,
   * result list contains files only, no reasons.
   */
  explanations?: boolean;
  /** Pack all candidates in one LLM call per source. Default true. */
  listwise?: boolean;
  /** Max candidates per listwise window. Default 16. */
  listwiseWindow?: number;
  /**
   * Pelican structural score at or above which a candidate is auto-kept
   * without sending it to the LLM. The structural signal is precise enough
   * at the high end that LLM verdicts rarely overturn — spending LLM time
   * there is wasted. Set to 1 (or anything >1) to disable auto-keep and
   * force every candidate through the LLM. When undefined, caller should
   * default to scoring.highConfidence so the rerank band mirrors the
   * labeling band.
   */
  autoKeepThreshold?: number;
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
  cePrefilter: false,
  cePrefilterThreshold: 0.08,
  biEncoderPrefilter: true,
  biEncoderModel: DEFAULT_BI_ENCODER_CONFIG.model,
  biEncoderTopK: DEFAULT_BI_ENCODER_CONFIG.topK, // 30 — safety ceiling only
  biEncoderCachePath: DEFAULT_BI_ENCODER_CONFIG.cachePath,
  explanations: false,
  useCache: true,
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
  private ce: CrossEncoderReranker | null = null;
  private ceReady = false;
  private biEncoder: BiEncoderPrefilter | null = null;
  private biEncoderReady = false;

  constructor(config: Partial<IRerankerConfig> = {}) {
    this.config = { ...DEFAULT_RERANKER_CONFIG, ...config };
    this.ollama = new OllamaReranker({
      model: this.config.ollamaModel,
      host: this.config.ollamaHost,
      concurrency: this.config.concurrency,
      debug: this.config.debug,
      fileContent: this.config.fileContent,
      base: this.config.base,
      target: this.config.target,
      explanations: this.config.explanations === true,
      listwise: this.config.listwise === true,
      listwiseWindow: this.config.listwiseWindow,
    });
    this.lock = new PelicanLock(this.config.lockPath);
    if (this.config.cePrefilter) {
      this.ce = new CrossEncoderReranker({ debug: this.config.debug });
    }
    if (this.config.biEncoderPrefilter !== false) {
      this.biEncoder = new BiEncoderPrefilter({
        model: this.config.biEncoderModel,
        host: this.config.ollamaHost,
        topK: this.config.biEncoderTopK,
        cachePath: this.config.biEncoderCachePath,
        debug: this.config.debug,
      });
    }
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
    // Warm the cross-encoder up front so the first rerank call doesn't eat a
    // ~600MB download. Failure is non-fatal: we just skip the prefilter and
    // fall through to LLM-only scoring.
    if (this.ce) {
      try {
        await this.ce.ensureModel();
        this.ceReady = true;
      } catch (err) {
        if (this.config.debug) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[rerank] CE prefilter unavailable — ${msg}\n`);
        }
        this.ce = null;
      }
    }
    if (this.biEncoder) {
      const ok = await this.biEncoder.checkAvailable();
      if (ok) {
        this.biEncoderReady = true;
      } else {
        if (this.config.debug) {
          process.stderr.write(
            `[rerank] bi-encoder model "${this.config.biEncoderModel}" not available at ` +
              `${this.config.ollamaHost} — run: ollama pull ${this.config.biEncoderModel}\n`,
          );
        }
        this.biEncoder = null;
      }
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

    const useCache = this.config.useCache !== false;
    if (useCache) await this.lock.load();

    const results: IRerankResult[] = [];
    const toScore: IRerankCandidate[] = [];

    // Partition: cached confirmed, cached rejected, unknown.
    // Cached rejections are sticky — pass `--no-cache` to force a full re-eval
    // if you believe a rejection is stale.
    for (const cand of candidates) {
      if (!useCache) {
        toScore.push(cand);
        continue;
      }
      if (this.lock.isConfirmed(changedFile, cand.testFile)) {
        const reason =
          this.config.explanations === true
            ? this.lock.getReason(changedFile, cand.testFile)
            : undefined;
        results.push({
          testFile: cand.testFile,
          combined: Math.min(1, cand.pelicanScore + this.config.cacheBoost),
          kept: true,
          reason,
          fromCache: true,
        });
      } else if (this.lock.isRejected(changedFile, cand.testFile)) {
        results.push({
          testFile: cand.testFile,
          combined: cand.pelicanScore,
          kept: false,
          fromCache: true,
        });
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
        // Cross-encoder prefilter: drop candidates with near-zero semantic
        // overlap before they reach the expensive LLM call. Threshold is kept
        // deliberately low (default 0.08) so we only shed the obvious misses.
        // Pelican's structural score + LLM still decide the ambiguous middle.
        const ceSurvivors = await this.cePrefilter(
          changedFile,
          sourceEntry,
          toScore,
          results,
          registry,
        );

        const survivors = await this.biEncoderPrefilterStage(
          changedFile,
          sourceEntry,
          ceSurvivors,
          results,
          registry,
        );

        const testEntries = survivors.map((c) => ({
          testFile: c.testFile,
          entry: registry.getFile(c.testFile) as IFileEntry | undefined,
        }));

        if (survivors.length === 0) {
          if (useCache) await this.lock.flush();
          if (this.config.debug) {
            const keptCount = results.filter((r) => r.kept).length;
            process.stderr.write(
              `[rerank] kept ${keptCount}/${results.length} for ${changedFile} (prefilters dropped all ${toScore.length})\n`,
            );
          }
          return results;
        }

        this.config.onProgress?.({ status: 'scoring', scored: 0, total: survivors.length });
        const llmResults = await this.ollama.rerankPairs(
          sourceEntry,
          changedFile,
          testEntries,
          (scored, total) => {
            this.config.onProgress?.({ status: 'scoring', scored, total });
          },
        );

        for (const llm of llmResults) {
          const cand = survivors.find((c) => c.testFile === llm.testFile)!;
          // LLM tilts pelican, doesn't overturn it. Multiplier is now
          // GENTLE (0.5..1.3) so borderline buckets don't swing the kept
          // count wildly. Pelican's structural score stays the anchor.
          const mult =
            llm.bucket !== undefined ? BUCKET_MULTIPLIER[llm.bucket] : undefined;
          const keptCombined =
            mult !== undefined
              ? Math.min(1, cand.pelicanScore * mult)
              : Math.min(1, cand.pelicanScore + this.config.confirmedBoost);
          const rejectCombined =
            mult !== undefined ? cand.pelicanScore * mult : cand.pelicanScore;
          if (llm.relevant) {
            if (useCache) this.lock.confirm(changedFile, llm.testFile, llm.reason);
            results.push({
              testFile: llm.testFile,
              combined: keptCombined,
              kept: true,
              reason: llm.reason,
              fromCache: false,
            });
          } else {
            if (useCache) this.lock.reject(changedFile, llm.testFile);
            results.push({
              testFile: llm.testFile,
              combined: rejectCombined,
              kept: false,
              reason: llm.reason,
              fromCache: false,
            });
          }
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

    if (useCache) await this.lock.flush();

    // No minKeep — if the LLM rejects all candidates, zero suggestions is
    // the correct answer. Force-keeping a rejected test is misleading.

    if (this.config.debug) {
      const keptCount = results.filter((r) => r.kept).length;
      process.stderr.write(`[rerank] kept ${keptCount}/${results.length} for ${changedFile}\n`);
    }

    return results;
  }

  /**
   * Drop candidates the cross-encoder judges irrelevant before they reach the
   * LLM. Rejected pairs are pushed into `results` as `kept:false` and recorded
   * in the lock cache, matching the shape LLM rejections take.
   *
   * Returns the survivors (caller scores these with Ollama). If the CE isn't
   * ready or errors, returns `toScore` unchanged — we never want the prefilter
   * to silently drop work just because the local model failed to load.
   */
  private async cePrefilter(
    changedFile: string,
    sourceEntry: IFileEntry,
    toScore: IRerankCandidate[],
    results: IRerankResult[],
    registry: IRegistry,
  ): Promise<IRerankCandidate[]> {
    if (!this.ce || !this.ceReady || toScore.length === 0) return toScore;
    const threshold = this.config.cePrefilterThreshold ?? 0.08;

    try {
      const sourceText = buildCETextForSource(sourceEntry);
      const candidateTexts = toScore.map((c) => {
        const entry = registry.getFile(c.testFile) as IFileEntry | undefined;
        return buildCETextForTest(c.testFile, entry);
      });
      const scores = await this.ce.scorePairs(sourceText, candidateTexts);

      const survivors: IRerankCandidate[] = [];
      for (let i = 0; i < toScore.length; i++) {
        if (scores[i] >= threshold) {
          survivors.push(toScore[i]);
        } else {
          if (this.config.useCache !== false) {
            this.lock.reject(changedFile, toScore[i].testFile);
          }
          results.push({
            testFile: toScore[i].testFile,
            combined: toScore[i].pelicanScore,
            kept: false,
            reason: `CE prefilter: score ${scores[i].toFixed(3)} < ${threshold}`,
            fromCache: false,
          });
        }
      }

      if (this.config.debug) {
        process.stderr.write(
          `[rerank] ${changedFile}: CE dropped ${toScore.length - survivors.length}/${toScore.length} ` +
            `(min=${Math.min(...scores).toFixed(3)}, max=${Math.max(...scores).toFixed(3)})\n`,
        );
      }
      return survivors;
    } catch (err) {
      if (this.config.debug) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[rerank] CE prefilter errored, falling through: ${msg}\n`);
      }
      return toScore;
    }
  }

  /**
   * Bi-encoder stage: rank remaining candidates by cosine similarity of code
   * embeddings and keep only the configured top-K. Dropped candidates are
   * written into `results` as `kept:false` (cached via lock) so they still
   * surface in debug output with a clear reason.
   *
   * If the bi-encoder model isn't loaded (pull failed, Ollama missing) this
   * is a no-op — we return `toScore` untouched so we never silently lose
   * candidates because of an environment issue.
   */
  private async biEncoderPrefilterStage(
    changedFile: string,
    sourceEntry: IFileEntry,
    toScore: IRerankCandidate[],
    results: IRerankResult[],
    registry: IRegistry,
  ): Promise<IRerankCandidate[]> {
    if (!this.biEncoder || !this.biEncoderReady || toScore.length === 0) return toScore;
    const topK = this.config.biEncoderTopK ?? DEFAULT_BI_ENCODER_CONFIG.topK;
    if (toScore.length <= topK) return toScore;

    try {
      const sourceText = buildCETextForSource(sourceEntry);
      const candidates: IBiEncoderCandidate[] = toScore.map((c) => {
        const entry = registry.getFile(c.testFile) as IFileEntry | undefined;
        return {
          id: c.testFile,
          text: buildCETextForTest(c.testFile, entry),
          prior: c.pelicanScore,
        };
      });

      const { kept, dropped } = await this.biEncoder.topK(sourceText, candidates);

      const survivorIds = new Set(kept.map((k) => k.candidate.id));
      const survivors = toScore.filter((c) => survivorIds.has(c.testFile));

      for (const d of dropped) {
        const cand = toScore.find((c) => c.testFile === d.candidate.id)!;
        if (this.config.useCache !== false) {
          this.lock.reject(changedFile, cand.testFile);
        }
        results.push({
          testFile: cand.testFile,
          combined: cand.pelicanScore,
          kept: false,
          reason: `bi-encoder: rank ${d.rank + 1}, cosine ${d.score.toFixed(3)}`,
          fromCache: false,
        });
      }

      if (this.config.debug) {
        process.stderr.write(
          `[rerank] ${changedFile}: bi-encoder kept ${survivors.length}/${toScore.length} ` +
            `(topK=${topK})\n`,
        );
      }
      return survivors;
    } catch (err) {
      if (this.config.debug) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[rerank] bi-encoder errored, falling through: ${msg}\n`);
      }
      return toScore;
    }
  }

}

function buildCETextForSource(entry: IFileEntry): string {
  const parts: string[] = [`source: ${entry.path}`];
  if (entry.exports.length) parts.push(`exports: ${entry.exports.slice(0, 20).join(', ')}`);
  if (entry.imports.length) parts.push(`imports: ${entry.imports.slice(0, 10).join(', ')}`);
  if (entry.selectors?.length) {
    const sels = entry.selectors.map((s) => s.value).filter(Boolean).slice(0, 15).join(', ');
    if (sels) parts.push(`selectors: ${sels}`);
  }
  if (entry.routesDefined?.length) {
    const routes = entry.routesDefined.map((r) => r.path).filter(Boolean).slice(0, 10).join(', ');
    if (routes) parts.push(`routes: ${routes}`);
  }
  return parts.join('\n');
}

function buildCETextForTest(testFile: string, entry: IFileEntry | undefined): string {
  if (!entry) return `test: ${testFile}`;
  const parts: string[] = [`test: ${testFile}`];
  if (entry.imports.length) parts.push(`imports: ${entry.imports.slice(0, 15).join(', ')}`);
  if (entry.cypress) {
    const describes = entry.cypress.describeBlocks.slice(0, 5).join(' > ');
    if (describes) parts.push(`describes: ${describes}`);
    const its = entry.cypress.itBlocks.slice(0, 8).join(' | ');
    if (its) parts.push(`its: ${its}`);
    const routes = entry.cypress.visitedRoutes.slice(0, 10).join(', ');
    if (routes) parts.push(`visits: ${routes}`);
    const selectors = entry.cypress.selectors.map((s) => s.value).filter(Boolean).slice(0, 15).join(', ');
    if (selectors) parts.push(`selectors: ${selectors}`);
  }
  return parts.join('\n');
}

export type { IFileContentConfig, IFileEntry };
