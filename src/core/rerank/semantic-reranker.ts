import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import { Ollama } from 'ollama';

import { IFileEntry, IRegistry } from '@/types/registry';

import { extractDiffPayload } from './diff-extractor';
import { buildSourcePayload, buildTestPayload } from './test-payload';

export interface IRerankerConfig {
  enabled: boolean;
  model: string;
  /** Hard floor — drop anything below this absolute cosine sim. */
  threshold: number;
  /**
   * Adaptive cutoff: drop candidates whose similarity falls more than
   * `gapFromTop` below the top score. Combined with `minKeep` so we never
   * over-prune small candidate sets.
   */
  gapFromTop: number;
  /** Always keep at least this many results, even if all fall in the gap. */
  minKeep: number;
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
  threshold: 0.4,
  gapFromTop: 0.05,
  minKeep: 2,
  cachePath: '.suggestor/embeddings.json',
};

interface ICacheEntry {
  hash: string;
  embedding: number[];
}

interface IRerankResult {
  testFile: string;
  similarity: number;
  kept: boolean;
}

/**
 * Bi-encoder semantic reranker built on top of Ollama's embedding API.
 *
 * Pipeline:
 *   1. Embed the diff payload (what changed in a source file).
 *   2. For each candidate test, build a payload string from its registry
 *      entry (describe/it/selectors/routes/intercepts/imports) and embed it.
 *   3. Cosine similarity → filter below threshold.
 *
 * Test embeddings are cached on disk keyed by a content hash of the payload,
 * so reruns are near-instant. The cache is invalidated automatically when the
 * registry re-extracts a test and its payload changes.
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
   * Core entry point. Given a changed file and the registry, returns a
   * map of test path → cosine similarity, filtered against the threshold.
   * Tests the caller passes in are expected to already be candidate set
   * (e.g. pelican scorer output), not the full test suite.
   */
  async rerank(
    changedFile: string,
    candidates: string[],
    registry: IRegistry,
    options: { base?: string; target?: string } = {},
  ): Promise<IRerankResult[]> {
    if (!this.config.enabled || candidates.length === 0) {
      return candidates.map((testFile) => ({ testFile, similarity: 1, kept: true }));
    }

    await this.loadCache();

    // Symmetric source payload — distilled labels (exports/selectors/routes/imports),
    // same shape as test payload. Avoids lexical noise from raw file content.
    const sourceEntry = registry.getFile(changedFile);
    const sourcePayload = sourceEntry
      ? buildSourcePayload(sourceEntry)
      : `path: ${changedFile}`;

    // Real git diff (changed lines only) layered on top when available — gives
    // the embedder a hint about WHAT specifically changed, not just what file is.
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
    const diffEmbedding = await this.embed(queryText);
    if (this.config.debug) {
      process.stderr.write(
        `[rerank:dump] query vector dim=${diffEmbedding.length} norm=${Math.sqrt(diffEmbedding.reduce((a, b) => a + b * b, 0)).toFixed(3)}\n`,
      );
    }

    // Pass 1: score every candidate.
    const scored: { testFile: string; similarity: number }[] = [];
    for (const testFile of candidates) {
      const entry = registry.getFile(testFile);
      if (!entry) {
        scored.push({ testFile, similarity: 0 });
        continue;
      }

      const payload = buildTestPayload(entry);
      if (this.config.debug) {
        process.stderr.write(
          `\n[rerank:dump] --- TEST PAYLOAD for ${testFile} (${payload.length} chars) ---\n`,
        );
        process.stderr.write(
          payload.slice(0, 500) + (payload.length > 500 ? '\n...[TRUNC]\n' : '\n'),
        );
      }
      const testEmbedding = await this.embedCached(testFile, payload);
      const sim = cosine(diffEmbedding, testEmbedding);

      if (this.config.debug) {
        process.stderr.write(
          `[rerank:dump] test vector dim=${testEmbedding.length} norm=${Math.sqrt(testEmbedding.reduce((a, b) => a + b * b, 0)).toFixed(3)} cos=${sim.toFixed(4)}\n`,
        );
      }

      scored.push({ testFile, similarity: sim });
    }

    await this.flushCache();

    // Pass 2: adaptive filter — gap from top, with minKeep floor.
    const sorted = [...scored].sort((a, b) => b.similarity - a.similarity);
    const topSim = sorted[0]?.similarity ?? 0;
    const gapCutoff = topSim - this.config.gapFromTop;
    const minKeep = this.config.minKeep;

    const keptSet = new Set<string>();
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      const passesAbsolute = r.similarity >= this.config.threshold;
      const passesGap = r.similarity >= gapCutoff;
      const withinMinKeep = i < minKeep;
      if (passesAbsolute && (passesGap || withinMinKeep)) {
        keptSet.add(r.testFile);
      }
    }

    const results: IRerankResult[] = scored.map((s) => {
      const kept = keptSet.has(s.testFile);
      if (this.config.debug) {
        process.stderr.write(
          `[rerank] ${s.similarity.toFixed(3)} ${s.testFile}${kept ? '' : ' (drop)'}\n`,
        );
      }
      return { ...s, kept };
    });

    if (this.config.debug) {
      const dropped = scored.length - keptSet.size;
      process.stderr.write(
        `[rerank:summary] kept ${keptSet.size}/${scored.length} (top=${topSim.toFixed(3)} cutoff=${gapCutoff.toFixed(3)} dropped=${dropped})\n`,
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
   * Embeds a test payload with disk-backed caching. Cache key is (testPath),
   * value is (hash of payload, embedding). If the payload hash changes (the
   * underlying test changed and the registry re-extracted), we re-embed.
   */
  private async embedCached(testPath: string, payload: string): Promise<number[]> {
    const hash = sha1(payload);
    const existing = this.cache.get(testPath);
    if (existing && existing.hash === hash) {
      return existing.embedding;
    }
    const embedding = await this.embed(payload);
    this.cache.set(testPath, { hash, embedding });
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

// Convenience export for unused-import typecheck assurance
export type { IFileEntry };
