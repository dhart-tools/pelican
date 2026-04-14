import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import { Ollama } from 'ollama';

import { IFileEntry, IRegistry } from '@/types/registry';

import { extractDiffPayload } from './diff-extractor';
import { buildItBlockPayloads, buildSourcePayload, buildTestPayload } from './test-payload';

export interface IRerankerConfig {
  enabled: boolean;
  model: string;
  /** Hard floor — drop anything below this absolute combined score. */
  threshold: number;
  /**
   * Adaptive cutoff: drop candidates whose combined score falls more than
   * `gapFromTop` below the top score. Combined with `minKeep` so we never
   * over-prune small candidate sets.
   */
  gapFromTop: number;
  /** Always keep at least this many results, even if all fall in the gap. */
  minKeep: number;
  /**
   * Hybrid blend weight: `combined = pelicanWeight * pelicanScore + (1 - pelicanWeight) * rerankSim`.
   * Higher = trust pelican's structural scorers more. 0.5 = equal weight.
   */
  pelicanWeight: number;
  /** If true, log per-candidate scores to stderr. */
  debug?: boolean;
  /** Ollama host, defaults to http://127.0.0.1:11434 */
  host?: string;
  /** Relative path for embedding cache, under cwd. */
  cachePath?: string;
}

export const DEFAULT_RERANKER_CONFIG: IRerankerConfig = {
  enabled: true,
  model: 'nomic-embed-text',
  threshold: 0.3,
  gapFromTop: 0.05,
  minKeep: 2,
  pelicanWeight: 0.5,
  cachePath: '.suggestor/embeddings.json',
};

interface ICacheEntry {
  hash: string;
  embedding: number[];
}

export interface IRerankCandidate {
  testFile: string;
  pelicanScore: number;
}

export interface IRerankResult {
  testFile: string;
  /** Raw cosine similarity from the embedder (0–1). */
  similarity: number;
  /** Hybrid combined score = pelicanWeight*pelican + (1-pelicanWeight)*sim. */
  combined: number;
  kept: boolean;
}

/**
 * Bi-encoder semantic reranker built on top of Ollama's embedding API.
 *
 * Pipeline:
 *   1. Embed source semantic payload (distilled exports/selectors/routes/imports).
 *   2. For each candidate test, embed both:
 *      a) The test-level payload (concat of all describe/it/selectors).
 *      b) Each `it` block separately — take the MAX sim across them.
 *      Final test sim = max(test-level, per-it max). Per-it max-pool is more
 *      discriminating: catches `it("creates new transaction")` matching
 *      `TransactionCreateStepOne` even when the concat blob is generic.
 *   3. Hybrid blend with pelican's structural scorer score so the embedder
 *      can boost or demote, but cannot single-handedly drop a strong
 *      structural signal (direct-import, selector-match).
 *   4. Adaptive filter: gap-from-top in the combined-score space.
 *
 * All embeddings are cached on disk keyed by content hash. Test-level and
 * per-it embeddings share the same cache file.
 */
export class SemanticReranker {
  private client: Ollama;
  private config: IRerankerConfig;
  private cache = new Map<string, ICacheEntry>();
  private cacheDirty = false;
  private cacheLoaded = false;

  constructor(config: Partial<IRerankerConfig> = {}) {
    this.config = { ...DEFAULT_RERANKER_CONFIG, ...config };
    this.client = new Ollama({
      host: this.config.host ?? 'http://127.0.0.1:11434',
    });
  }

  /**
   * Core entry point. Candidates carry their pelican scorer score so the
   * reranker can blend, not just override. Returns combined ranking with
   * a `kept` flag for the gap-from-top filter.
   */
  async rerank(
    changedFile: string,
    candidates: IRerankCandidate[],
    registry: IRegistry,
    options: { base?: string; target?: string } = {},
  ): Promise<IRerankResult[]> {
    if (!this.config.enabled || candidates.length === 0) {
      return candidates.map((c) => ({
        testFile: c.testFile,
        similarity: 1,
        combined: c.pelicanScore,
        kept: true,
      }));
    }

    await this.loadCache();

    // Symmetric source payload — distilled labels, no raw JSX.
    const sourceEntry = registry.getFile(changedFile);
    const sourcePayload = sourceEntry
      ? buildSourcePayload(sourceEntry)
      : `path: ${changedFile}`;

    // Real diff layered on top when available.
    const diff = await extractDiffPayload(changedFile, options.base, options.target);
    const diffSnippet = diff.fallback ? '' : `\nchanged lines:\n${diff.text}`;
    const queryText = sourcePayload + diffSnippet;

    if (this.config.debug) {
      process.stderr.write(
        `\n[rerank:dump] === SOURCE QUERY (diff ${diff.fallback ? 'unavailable' : 'attached'}) ${queryText.length} chars ===\n`,
      );
      process.stderr.write(
        queryText.slice(0, 600) + (queryText.length > 600 ? '\n...[TRUNC]\n' : '\n'),
      );
    }
    const queryEmbedding = await this.embed(queryText);

    // Pass 1: score every candidate (test-level + per-it max-pool).
    const scored: { testFile: string; similarity: number; pelicanScore: number }[] = [];
    for (const cand of candidates) {
      const entry = registry.getFile(cand.testFile);
      if (!entry) {
        scored.push({ testFile: cand.testFile, similarity: 0, pelicanScore: cand.pelicanScore });
        continue;
      }

      const testLevelPayload = buildTestPayload(entry);
      const testLevelEmbedding = await this.embedCached(cand.testFile, testLevelPayload);
      const testLevelSim = cosine(queryEmbedding, testLevelEmbedding);

      // Per-it max-pool: embed each it block separately, take max sim.
      let perItMax = 0;
      let perItBest = '';
      const itPayloads = buildItBlockPayloads(entry);
      for (let i = 0; i < itPayloads.length; i++) {
        const cacheKey = `${cand.testFile}#it${i}`;
        const itEmbedding = await this.embedCached(cacheKey, itPayloads[i]);
        const itSim = cosine(queryEmbedding, itEmbedding);
        if (itSim > perItMax) {
          perItMax = itSim;
          perItBest = itPayloads[i].split('\n').pop() ?? '';
        }
      }

      const finalSim = Math.max(testLevelSim, perItMax);

      if (this.config.debug) {
        process.stderr.write(
          `[rerank:dump] ${cand.testFile} testLevel=${testLevelSim.toFixed(3)} perItMax=${perItMax.toFixed(3)} (best: ${perItBest.slice(0, 60)}) → final=${finalSim.toFixed(3)}\n`,
        );
      }

      scored.push({
        testFile: cand.testFile,
        similarity: finalSim,
        pelicanScore: cand.pelicanScore,
      });
    }

    await this.flushCache();

    // Pass 2: hybrid blend + adaptive filter on COMBINED score.
    const w = this.config.pelicanWeight;
    const withCombined = scored.map((s) => ({
      ...s,
      combined: w * s.pelicanScore + (1 - w) * s.similarity,
    }));
    const sorted = [...withCombined].sort((a, b) => b.combined - a.combined);
    const topCombined = sorted[0]?.combined ?? 0;
    const gapCutoff = topCombined - this.config.gapFromTop;

    const keptSet = new Set<string>();
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      const passesAbsolute = r.combined >= this.config.threshold;
      const passesGap = r.combined >= gapCutoff;
      const withinMinKeep = i < this.config.minKeep;
      if (passesAbsolute && (passesGap || withinMinKeep)) {
        keptSet.add(r.testFile);
      }
    }

    const results: IRerankResult[] = withCombined.map((s) => {
      const kept = keptSet.has(s.testFile);
      if (this.config.debug) {
        process.stderr.write(
          `[rerank] sim=${s.similarity.toFixed(3)} pel=${s.pelicanScore.toFixed(3)} combined=${s.combined.toFixed(3)} ${s.testFile}${kept ? '' : ' (drop)'}\n`,
        );
      }
      return {
        testFile: s.testFile,
        similarity: s.similarity,
        combined: s.combined,
        kept,
      };
    });

    if (this.config.debug) {
      const dropped = scored.length - keptSet.size;
      process.stderr.write(
        `[rerank:summary] kept ${keptSet.size}/${scored.length} (top=${topCombined.toFixed(3)} cutoff=${gapCutoff.toFixed(3)} dropped=${dropped}, pelicanWeight=${w})\n`,
      );
    }

    return results;
  }

  private async embed(text: string): Promise<number[]> {
    const res = await this.client.embeddings({
      model: this.config.model,
      prompt: text,
    });
    return res.embedding;
  }

  /**
   * Disk-backed embedding cache. Key is an arbitrary string (test path, or
   * `${testPath}#itN`). Value is (payload hash, embedding). Re-embeds when
   * the payload hash changes — i.e. when the registry re-extracted the test
   * and its content changed.
   */
  private async embedCached(key: string, payload: string): Promise<number[]> {
    const hash = sha1(payload);
    const existing = this.cache.get(key);
    if (existing && existing.hash === hash) {
      return existing.embedding;
    }
    const embedding = await this.embed(payload);
    this.cache.set(key, { hash, embedding });
    this.cacheDirty = true;
    return embedding;
  }

  private async loadCache(): Promise<void> {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    const cachePath = this.config.cachePath ?? DEFAULT_RERANKER_CONFIG.cachePath!;
    try {
      const raw = await fs.readFile(cachePath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, ICacheEntry>;
      for (const [k, v] of Object.entries(data)) {
        this.cache.set(k, v);
      }
    } catch {
      // missing / malformed — start empty
    }
  }

  private async flushCache(): Promise<void> {
    if (!this.cacheDirty) return;
    const cachePath = this.config.cachePath ?? DEFAULT_RERANKER_CONFIG.cachePath!;
    try {
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      const obj: Record<string, ICacheEntry> = {};
      for (const [k, v] of this.cache) obj[k] = v;
      await fs.writeFile(cachePath, JSON.stringify(obj), 'utf-8');
      this.cacheDirty = false;
    } catch {
      // non-fatal — rerunning will just re-embed
    }
  }
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export type { IFileEntry };
