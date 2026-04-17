import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import { Ollama } from 'ollama';

/**
 * Bi-encoder prefilter via local Ollama embeddings. Stage 1 of the rerank
 * pipeline: embed source + every candidate test once, rank by cosine, keep a
 * fixed `topK`. Downstream LLM sees at most K candidates regardless of repo
 * size → O(1) LLM calls per source file.
 *
 * Model default: `jina/jina-embeddings-v2-base-code` (161M, code-trained).
 * Swap via config; anything exposing Ollama's `/api/embed` works.
 *
 * Embeddings are cached on disk keyed by sha1(text) so unchanged files never
 * re-embed — warm runs cost only the source-side embed call.
 */
export interface IBiEncoderConfig {
  model: string;
  host: string;
  /**
   * Safety ceiling on how many candidates can survive into LLM scoring.
   * This is NOT a forced fill — the real filter is `minScore`. `topK` only
   * kicks in when the floor is too loose and would otherwise let a massive
   * candidate list through.
   */
  topK: number;
  cachePath: string;
  /**
   * Weight on pelican's structural score when blending with cosine similarity
   * for the final rank. `combined = priorWeight * prior + (1-priorWeight) * cosine`.
   * Higher values favor pelican's deterministic structural signal (imports,
   * selectors, route matches) over pure embedding overlap — this is what
   * keeps token-similar-but-structurally-unrelated pairs (e.g. Jest unit
   * tests vs frontend bundle entries) out of the top-K.
   */
  priorWeight: number;
  /**
   * Drop candidates whose blended score is below this absolute floor, even
   * if they'd otherwise make top-K. Prevents the prefilter from promoting
   * obviously weak pairs just to fill the quota.
   */
  minScore: number;
  debug?: boolean;
}

export const DEFAULT_BI_ENCODER_CONFIG: IBiEncoderConfig = {
  // `mxbai-embed-large` (335M) — strong quality, still light enough for CPU.
  // Swap to `nomic-embed-code` (7B, GPU) for code-specialized ranking,
  // or `nomic-embed-text` (137M) for the fastest option.
  model: 'mxbai-embed-large',
  host: 'http://localhost:11434',
  // `topK` is a SAFETY CEILING, not a forced fill. The real work is done by
  // `minScore`: we drop absolute-NO candidates and let the LLM decide every
  // plausible survivor. 30 is generous enough that a well-scored change will
  // almost never hit it; it exists only to bound worst-case prompt volume
  // when the structural scorer emits a huge candidate list.
  topK: 30,
  cachePath: '.pelican/embeddings.json',
  priorWeight: 0.7,
  minScore: 0.3,
};

export interface IBiEncoderCandidate {
  id: string;
  text: string;
  /**
   * Prior score from the structural scorer, normalised to [0,1]. Used to
   * blend with cosine so the prefilter respects pelican's deterministic
   * structural signal instead of leaning purely on embedding overlap.
   */
  prior?: number;
}

export interface IBiEncoderResult<T extends IBiEncoderCandidate> {
  kept: Array<{ candidate: T; score: number; rank: number }>;
  dropped: Array<{ candidate: T; score: number; rank: number }>;
}

export class BiEncoderPrefilter {
  private ollama: Ollama;
  private config: IBiEncoderConfig;
  private available: boolean | null = null;
  private cache = new Map<string, number[]>();
  private cacheLoaded = false;
  private cacheDirty = false;

  constructor(config: Partial<IBiEncoderConfig> = {}) {
    this.config = { ...DEFAULT_BI_ENCODER_CONFIG, ...config };
    this.ollama = new Ollama({ host: this.config.host });
  }

  async checkAvailable(): Promise<boolean> {
    try {
      await this.ollama.show({ model: this.config.model });
      this.available = true;
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }

  isAvailable(): boolean {
    return this.available === true;
  }

  async topK<T extends IBiEncoderCandidate>(
    sourceText: string,
    candidates: T[],
  ): Promise<IBiEncoderResult<T>> {
    if (candidates.length === 0) {
      return { kept: [], dropped: [] };
    }

    const cosines = await this.scoreAll(sourceText, candidates);
    const w = this.config.priorWeight;
    const floor = this.config.minScore;

    // Blend pelican structural prior with cosine so the ranking respects both
    // signals. Candidates with a strong structural match survive even if
    // their raw cosine is modest; pure-cosine token-overlap pairs (e.g.
    // `TransactionDetailContainer` ↔ `TransactionsContainer.cy.tsx`) get
    // pushed down when the structural score is weak.
    const ranked = cosines
      .map((cos, i) => {
        const prior = candidates[i].prior ?? 0;
        const score = w * prior + (1 - w) * cos;
        return { candidate: candidates[i], score, cosine: cos, prior };
      })
      .sort((a, b) => b.score - a.score)
      .map((r, i) => ({ ...r, rank: i }));

    // Enforce floor AND top-K simultaneously — whichever cuts tighter.
    const kept: Array<{ candidate: T; score: number; rank: number }> = [];
    const dropped: Array<{ candidate: T; score: number; rank: number }> = [];
    for (const r of ranked) {
      const below = r.score < floor;
      const overflow = kept.length >= this.config.topK;
      if (below || overflow) {
        dropped.push({ candidate: r.candidate, score: r.score, rank: r.rank });
      } else {
        kept.push({ candidate: r.candidate, score: r.score, rank: r.rank });
      }
    }

    if (this.config.debug) {
      const top = kept[0]?.score.toFixed(3) ?? 'n/a';
      const cut = kept[kept.length - 1]?.score.toFixed(3) ?? 'n/a';
      process.stderr.write(
        `[bi-encoder] kept ${kept.length}/${candidates.length} ` +
          `(topK=${this.config.topK}, floor=${floor}, w=${w}, top=${top}, cutoff=${cut})\n`,
      );
    }
    return { kept, dropped };
  }

  private async scoreAll<T extends IBiEncoderCandidate>(
    sourceText: string,
    candidates: T[],
  ): Promise<number[]> {
    await this.loadCache();

    const sourceVec = await this.embedOne(sourceText);
    const candVecs = await this.embedMany(candidates.map((c) => c.text));

    await this.flushCache();

    return candVecs.map((v) => cosine(sourceVec, v));
  }

  private async embedOne(text: string): Promise<number[]> {
    const key = hashText(text);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const res = await this.ollama.embed({ model: this.config.model, input: text });
    const vec = res.embeddings[0];
    this.cache.set(key, vec);
    this.cacheDirty = true;
    return vec;
  }

  private async embedMany(texts: string[]): Promise<number[][]> {
    const out: number[][] = new Array(texts.length);
    const toEmbed: Array<{ idx: number; key: string; text: string }> = [];
    for (let i = 0; i < texts.length; i++) {
      const key = hashText(texts[i]);
      const hit = this.cache.get(key);
      if (hit) {
        out[i] = hit;
      } else {
        toEmbed.push({ idx: i, key, text: texts[i] });
      }
    }
    if (toEmbed.length === 0) return out;

    // Ollama embed accepts an array — one HTTP round-trip for the whole batch.
    const res = await this.ollama.embed({
      model: this.config.model,
      input: toEmbed.map((e) => e.text),
    });
    for (let i = 0; i < toEmbed.length; i++) {
      const vec = res.embeddings[i];
      out[toEmbed[i].idx] = vec;
      this.cache.set(toEmbed[i].key, vec);
      this.cacheDirty = true;
    }
    return out;
  }

  private async loadCache(): Promise<void> {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    try {
      const raw = await fs.readFile(this.config.cachePath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, number[]>;
      for (const [k, v] of Object.entries(data)) this.cache.set(k, v);
    } catch {
      // missing / malformed — start empty
    }
  }

  private async flushCache(): Promise<void> {
    if (!this.cacheDirty) return;
    try {
      await fs.mkdir(path.dirname(this.config.cachePath), { recursive: true });
      const obj: Record<string, number[]> = {};
      for (const [k, v] of this.cache) obj[k] = v;
      await fs.writeFile(this.config.cachePath, JSON.stringify(obj), 'utf-8');
      this.cacheDirty = false;
    } catch {
      // non-fatal — next run re-embeds
    }
  }
}

function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
