import { IFileEntry, IRegistry } from '@/types/registry';

import { CrossEncoderReranker, ICrossEncoderConfig } from './cross-encoder-reranker';
import { extractDiffPayload } from './diff-extractor';
import { buildItBlockPayloads, buildSourcePayload, buildTestPayload } from './test-payload';

export interface IRerankerConfig {
  enabled: boolean;
  /** HF model id for the cross-encoder. */
  model: string;
  /** Use int8 quantized weights (default true). */
  quantized: boolean;
  /** Absolute relevance threshold — candidates below this are dropped. */
  threshold: number;
  /** Always keep at least this many results even if all fall below threshold. */
  minKeep: number;
  /**
   * Additive-boost blend: `combined = pelicanScore + max(0, sim - boostFloor) * boostFactor`.
   *
   * Pelican's structural score is treated as ground truth; the reranker only
   * contributes upward when its similarity is meaningfully high. Sims below
   * `boostFloor` contribute nothing (but candidates below `threshold` are
   * already filtered out upstream). Sims above the floor scale linearly by
   * `boostFactor`.
   *
   * Why not a linear blend? A linear `w*pel + (1-w)*sim` formula actively
   * *drags down* correct matches when the reranker is conservative — which
   * is common for code→test pairs since bge-reranker was trained on natural
   * language, not symbols like `TransactionCreateStepOne`. With additive
   * boost, a modest sim neither hurts nor helps, and a strong sim genuinely
   * lifts confidence. Predictable, never demotes a real match.
   */
  boostFloor: number;
  boostFactor: number;
  debug?: boolean;
  /** Disk path for rerank pair-score cache. */
  cachePath?: string;
  /** Where to cache downloaded model weights. */
  modelCacheDir?: string;
}

export const DEFAULT_RERANKER_CONFIG: IRerankerConfig = {
  enabled: true,
  model: 'onnx-community/bge-reranker-v2-m3-ONNX',
  quantized: true,
  // Lowered from 0.25 — jest test payloads are nearly empty (`buildTestPayload`
  // only populates describe/it/selectors for cypress entries today), which
  // deflates absolute sims even for real matches. 0.15 keeps real matches in
  // while still cutting obvious noise. Raise once jest extraction lands.
  threshold: 0.15,
  // Dropped from 2 — minKeep=2 was force-keeping garbage when only one real
  // match exists (e.g. saleor case: data.test.ts was alone, productVariantCache
  // got pulled in purely by colocation). If cross-encoder is confident, trust
  // it; if nothing matches, return nothing.
  minKeep: 1,
  // Additive boost: only sims above 0.2 lift the score. 0.5 factor scales the
  // excess: a sim of 0.9 adds 0.35 to pelican's score, enough to push a
  // MEDIUM result to HIGH. A sim of 0.25 adds 0.025 — barely moves the needle,
  // which is correct: a borderline sim shouldn't overpromise confidence.
  boostFloor: 0.2,
  boostFactor: 0.5,
  cachePath: '.suggestor/rerank-cache.json',
  modelCacheDir: '.suggestor/models',
};

export interface IRerankCandidate {
  testFile: string;
  pelicanScore: number;
}

export interface IRerankResult {
  testFile: string;
  /** Raw cross-encoder relevance score for this pair (0–1, sigmoid). */
  similarity: number;
  /** Pelican score lifted by the additive rerank boost. */
  combined: number;
  kept: boolean;
}

/**
 * Cross-encoder-based semantic reranker.
 *
 * Pipeline:
 *   1. Build a distilled query payload from the changed source file + diff.
 *   2. For each candidate test, score both its full payload and each `it`-block
 *      payload against the query via the cross-encoder. Final sim =
 *      max(test-level, per-it max). The per-it max-pool catches narrow
 *      matches an aggregate test blob would wash out.
 *   3. Blend with pelican's structural scorer score so strong structural
 *      signals (direct-import, selector-match) are not single-handedly
 *      overridden by the model.
 *   4. Absolute-threshold filter on the cross-encoder score, with `minKeep`
 *      as a safety net.
 *
 * Unlike the previous bi-encoder, there is no per-file embedding cache — the
 * cross-encoder scores PAIRS, so caching is keyed on sha1(query+payload). When
 * the diff changes the query changes, so the whole row is a miss. Acceptable:
 * scoring 20–30 pairs via the ONNX model takes a few seconds.
 */
export class SemanticReranker {
  private config: IRerankerConfig;
  private crossEncoder: CrossEncoderReranker;

  constructor(config: Partial<IRerankerConfig> = {}) {
    this.config = { ...DEFAULT_RERANKER_CONFIG, ...config };
    const xencConfig: Partial<ICrossEncoderConfig> = {
      model: this.config.model,
      quantized: this.config.quantized,
      cachePath: this.config.cachePath,
      modelCacheDir: this.config.modelCacheDir,
      debug: this.config.debug,
    };
    this.crossEncoder = new CrossEncoderReranker(xencConfig);
  }

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

    // Build the query: source payload + optional diff snippet.
    const sourceEntry = registry.getFile(changedFile);
    const sourcePayload = sourceEntry
      ? buildSourcePayload(sourceEntry)
      : `path: ${changedFile}`;
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

    // Flatten all (query, payload) pairs into one list so the cross-encoder
    // can batch-infer. We remember which slot belongs to which candidate so
    // we can collapse back to per-candidate max at the end.
    const payloads: string[] = [];
    const perCand: {
      testFile: string;
      pelicanScore: number;
      testLevelSlot: number;
      itSlotStart: number;
      itSlotEnd: number;
      itTexts: string[];
    }[] = [];

    for (let ci = 0; ci < candidates.length; ci++) {
      const cand = candidates[ci];
      const entry = registry.getFile(cand.testFile);
      if (!entry) {
        perCand.push({
          testFile: cand.testFile,
          pelicanScore: cand.pelicanScore,
          testLevelSlot: -1,
          itSlotStart: 0,
          itSlotEnd: 0,
          itTexts: [],
        });
        continue;
      }

      const testLevelPayload = buildTestPayload(entry);
      const testLevelSlot = payloads.length;
      payloads.push(testLevelPayload);

      const itPayloads = buildItBlockPayloads(entry);
      const itStart = payloads.length;
      for (const p of itPayloads) payloads.push(p);
      const itEnd = payloads.length;

      perCand.push({
        testFile: cand.testFile,
        pelicanScore: cand.pelicanScore,
        testLevelSlot,
        itSlotStart: itStart,
        itSlotEnd: itEnd,
        itTexts: itPayloads.map((p) => p.split('\n').pop() ?? ''),
      });
    }

    if (this.config.debug) {
      process.stderr.write(
        `[rerank:xenc] scoring ${payloads.length} pairs for ${candidates.length} candidates\n`,
      );
    }

    const rawScores = await this.crossEncoder.scorePairs(queryText, payloads);

    // Collapse pair scores back to per-candidate final sim.
    const scored: {
      testFile: string;
      similarity: number;
      pelicanScore: number;
    }[] = [];
    for (const pc of perCand) {
      if (pc.testLevelSlot === -1) {
        scored.push({ testFile: pc.testFile, similarity: 0, pelicanScore: pc.pelicanScore });
        continue;
      }
      const testLevelSim = rawScores[pc.testLevelSlot] ?? 0;
      let perItMax = 0;
      let perItBest = '';
      for (let k = pc.itSlotStart; k < pc.itSlotEnd; k++) {
        const s = rawScores[k] ?? 0;
        if (s > perItMax) {
          perItMax = s;
          perItBest = pc.itTexts[k - pc.itSlotStart] ?? '';
        }
      }
      const finalSim = Math.max(testLevelSim, perItMax);

      if (this.config.debug) {
        process.stderr.write(
          `[rerank:dump] ${pc.testFile} testLevel=${testLevelSim.toFixed(3)} perItMax=${perItMax.toFixed(3)} (best: ${perItBest.slice(0, 60)}) → final=${finalSim.toFixed(3)}\n`,
        );
      }

      scored.push({
        testFile: pc.testFile,
        similarity: finalSim,
        pelicanScore: pc.pelicanScore,
      });
    }

    // Hybrid blend + absolute-threshold filter. Threshold is on raw
    // cross-encoder similarity (calibrated via sigmoid), not combined, so
    // pelican's colocation/weak signals cannot float garbage above the line.
    //
    // minKeep is a safety net, but only when at least one candidate actually
    // passes the reranker threshold. If every candidate is below threshold we
    // trust the model and return nothing — that's the honest answer for a
    // file with no real test coverage (e.g. saleor's LanguageSwitch).
    const floor = this.config.boostFloor;
    const factor = this.config.boostFactor;
    const withCombined = scored.map((s) => {
      const boost = Math.max(0, s.similarity - floor) * factor;
      return {
        ...s,
        combined: Math.min(1, s.pelicanScore + boost),
      };
    });
    const sorted = [...withCombined].sort((a, b) => b.combined - a.combined);
    const anyPasses = sorted.some((r) => r.similarity >= this.config.threshold);
    const keptSet = new Set<string>();
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      const passesThreshold = r.similarity >= this.config.threshold;
      const withinMinKeep = anyPasses && i < this.config.minKeep;
      if (passesThreshold || withinMinKeep) {
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
        `[rerank:summary] kept ${keptSet.size}/${scored.length} (threshold=${this.config.threshold}, dropped=${dropped}, boost floor=${floor} factor=${factor})\n`,
      );
    }

    return results;
  }
}

export type { IFileEntry };
