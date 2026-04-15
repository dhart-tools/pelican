import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

// We bypass the high-level `pipeline('text-classification', …)` helper because
// it softmaxes across output labels, and bge-reranker has one output class,
// so softmax always returns 1.0. Instead we load tokenizer + model directly
// and apply sigmoid on the raw logit ourselves.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TokenizerFn = (...args: any[]) => Promise<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelFn = (...args: any[]) => Promise<any>;

interface IRerankerHandles {
  tokenizer: TokenizerFn;
  model: ModelFn;
  sigmoid: (x: number) => number;
}

export interface ICrossEncoderConfig {
  /** HF model id. Default bge-reranker-v2-m3 (SOTA open reranker, XLM-R large). */
  model: string;
  /** Use int8 quantized weights (~600MB vs ~2.3GB). Minor accuracy hit. */
  quantized: boolean;
  /** Disk cache path for pair-score cache (sha1(query+candidate) → score). */
  cachePath: string;
  /** Where transformers.js stores downloaded model files. */
  modelCacheDir: string;
  /** Inference batch size (pairs per forward pass). */
  batchSize: number;
  debug?: boolean;
}

export const DEFAULT_CROSS_ENCODER_CONFIG: ICrossEncoderConfig = {
  // The `Xenova/` namespace does not host a v2-m3 ONNX conversion. The
  // `onnx-community/` org is the current home for newer ONNX model exports.
  model: 'onnx-community/bge-reranker-v2-m3-ONNX',
  quantized: true,
  cachePath: '.suggestor/rerank-cache.json',
  modelCacheDir: '.suggestor/models',
  batchSize: 8,
};

interface ICacheEntry {
  score: number;
}

/**
 * Local cross-encoder reranker. Unlike a bi-encoder (embed sides independently,
 * cosine), a cross-encoder feeds `(query, candidate)` through the transformer
 * together and outputs a calibrated relevance score via sigmoid. Much sharper
 * for ranking — the model attends across both sides simultaneously.
 *
 * Runs locally via @huggingface/transformers (ONNX runtime). No daemon, no
 * HTTP. Model weights download once on first use, then fully offline.
 */
export class CrossEncoderReranker {
  private config: ICrossEncoderConfig;
  private pipelinePromise: Promise<IRerankerHandles> | null = null;
  private cache = new Map<string, ICacheEntry>();
  private cacheDirty = false;
  private cacheLoaded = false;

  constructor(config: Partial<ICrossEncoderConfig> = {}) {
    this.config = { ...DEFAULT_CROSS_ENCODER_CONFIG, ...config };
  }

  /**
   * Score many (query, candidate) pairs. Returns scores in input order.
   * Uses a disk cache keyed on sha1(query+candidate), so unchanged pairs
   * never hit the model.
   */
  async scorePairs(
    query: string,
    candidates: string[],
  ): Promise<number[]> {
    if (candidates.length === 0) return [];
    await this.loadCache();

    const scores = new Array<number>(candidates.length);
    const toInfer: { idx: number; key: string; text: string }[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const key = pairKey(query, candidates[i]);
      const hit = this.cache.get(key);
      if (hit) {
        scores[i] = hit.score;
      } else {
        toInfer.push({ idx: i, key, text: candidates[i] });
      }
    }

    if (toInfer.length > 0) {
      const { tokenizer, model, sigmoid } = await this.getPipeline();
      for (let b = 0; b < toInfer.length; b += this.config.batchSize) {
        const batch = toInfer.slice(b, b + this.config.batchSize);
        // bge-reranker expects the pair joined with the model's [SEP] token
        // baked in by the tokenizer's `text_pair` path. Tokenize all pairs
        // together, then run one forward pass — avoids the text-classification
        // pipeline's softmax-over-labels default, which returns 1.0 for
        // single-output-class rerankers. We apply sigmoid manually on the
        // raw logit to get a calibrated relevance score in [0, 1].
        const encoded = await tokenizer(
          batch.map(() => query),
          {
            text_pair: batch.map((p) => p.text),
            padding: true,
            truncation: true,
          },
        );
        const output = await model(encoded);
        // `output.logits` has shape [batchSize, 1]. Grab the one logit per row.
        const logits = output.logits;
        const data = logits.data as Float32Array;
        for (let j = 0; j < batch.length; j++) {
          const logit = data[j];
          const score = sigmoid(logit);
          scores[batch[j].idx] = score;
          this.cache.set(batch[j].key, { score });
          this.cacheDirty = true;
        }
      }
    }

    await this.flushCache();
    return scores;
  }

  /**
   * Lazy-load tokenizer + model. First call downloads ~600MB; subsequent
   * calls reuse the in-process instances. We skip the high-level
   * text-classification pipeline because its default softmax-over-labels
   * returns 1.0 for single-output-class rerankers like bge-reranker.
   */
  private async getPipeline(): Promise<IRerankerHandles> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        const mod = await import('@huggingface/transformers');
        // Tell transformers.js where to cache model weights so we stay
        // inside the project-local .suggestor dir (CI can restore this).
        const absCache = path.resolve(this.config.modelCacheDir);
        await fs.mkdir(absCache, { recursive: true });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const env = (mod as any).env;
        if (env) {
          env.cacheDir = absCache;
          env.localModelPath = absCache;
          env.allowRemoteModels = true;
        }

        // Only log to stderr when debug is on. Ink's TUI owns the terminal
        // during interactive mode; writing to stderr mid-render shreds the
        // frame into ghosted panels. Debug/JSON/headless flows run without
        // Ink, so stderr is safe there.
        const log = (msg: string) => {
          if (this.config.debug) process.stderr.write(msg);
        };
        log(
          `[pelican] loading cross-encoder ${this.config.model} (first run will download ~600MB to ${absCache})\n`,
        );
        const progressState = new Map<string, number>();
        const progressCallback = (data: {
          status: string;
          file?: string;
          progress?: number;
          loaded?: number;
          total?: number;
        }) => {
          if (data.status === 'download' && data.file) {
            log(`[pelican] download start: ${data.file}\n`);
          } else if (data.status === 'progress' && data.file && typeof data.progress === 'number') {
            const pct = Math.floor(data.progress);
            const prev = progressState.get(data.file) ?? -1;
            if (pct >= prev + 10) {
              progressState.set(data.file, pct);
              const mb =
                data.loaded && data.total
                  ? ` (${(data.loaded / 1e6).toFixed(0)}/${(data.total / 1e6).toFixed(0)} MB)`
                  : '';
              log(`[pelican] ${data.file} ${pct}%${mb}\n`);
            }
          } else if (data.status === 'done' && data.file) {
            log(`[pelican] done: ${data.file}\n`);
          } else if (data.status === 'ready') {
            log(`[pelican] cross-encoder ready\n`);
          }
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const AutoTokenizer = (mod as any).AutoTokenizer;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const AutoModelForSequenceClassification = (mod as any)
          .AutoModelForSequenceClassification;

        const loadOpts = {
          dtype: this.config.quantized ? 'q8' : 'fp32',
          progress_callback: progressCallback,
        };
        const tokenizer = await AutoTokenizer.from_pretrained(this.config.model, loadOpts);
        const model = await AutoModelForSequenceClassification.from_pretrained(
          this.config.model,
          loadOpts,
        );
        log(`[pelican] cross-encoder ready\n`);

        const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
        return { tokenizer, model, sigmoid };
      })();
    }
    return this.pipelinePromise;
  }

  private async loadCache(): Promise<void> {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    try {
      const raw = await fs.readFile(this.config.cachePath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, ICacheEntry>;
      for (const [k, v] of Object.entries(data)) this.cache.set(k, v);
    } catch {
      // missing / malformed — start empty
    }
  }

  private async flushCache(): Promise<void> {
    if (!this.cacheDirty) return;
    try {
      await fs.mkdir(path.dirname(this.config.cachePath), { recursive: true });
      const obj: Record<string, ICacheEntry> = {};
      for (const [k, v] of this.cache) obj[k] = v;
      await fs.writeFile(this.config.cachePath, JSON.stringify(obj), 'utf-8');
      this.cacheDirty = false;
    } catch {
      // non-fatal — next run re-infers
    }
  }
}

function pairKey(query: string, candidate: string): string {
  // Separator byte that cannot appear in either side's normal text — lets
  // us hash the concat without ambiguity between (a, bc) and (ab, c).
  return createHash('sha1').update(query).update('\x00').update(candidate).digest('hex');
}
