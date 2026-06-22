import { ILLMCompleteOptions, ILLMMessage, ILLMProvider, LLMProviderError } from './provider';

export interface OpenRouterOptions {
  model: string;
  apiKey: string;
  baseUrl?: string;
  /** Optional attribution headers OpenRouter recommends. */
  referer?: string;
  title?: string;
  /** Retries on 429/5xx before failing. Default 3. */
  maxRetries?: number;
  /** Base backoff (ms); doubles each retry, capped at 8s. Test seam. Default 500. */
  backoffBaseMs?: number;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Internal: a retryable HTTP failure carrying any server-suggested delay. */
class RetryableHttpError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/**
 * OpenRouter chat-completions provider. Talks the OpenAI-compatible
 * `/chat/completions` schema OpenRouter exposes, so any model slug on the
 * platform (anthropic/*, nvidia/*, z-ai/*, deepseek/*, …) works unchanged.
 *
 * Retries rate-limits (429) and transient 5xx with exponential backoff,
 * honouring a `Retry-After` header when present. Once retries are exhausted it
 * throws — the reranker then fails open (keeps the candidate), so rate limits
 * cost coverage, never recall.
 */
export class OpenRouterProvider implements ILLMProvider {
  readonly id = 'openrouter';
  private readonly url: string;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;

  constructor(private readonly opts: OpenRouterOptions) {
    if (!opts.apiKey) throw new LLMProviderError('OpenRouter API key is empty');
    const base = (opts.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    this.url = `${base}/chat/completions`;
    this.maxRetries = opts.maxRetries ?? 3;
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
  }

  async complete(messages: ILLMMessage[], opts: ILLMCompleteOptions = {}): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.once(messages, opts);
      } catch (err) {
        lastErr = err;
        if (!(err instanceof RetryableHttpError) || attempt === this.maxRetries) break;
        const backoff = Math.min(8000, this.backoffBaseMs * 2 ** attempt);
        await sleep(err.retryAfterMs ?? backoff);
      }
    }
    if (lastErr instanceof LLMProviderError) throw lastErr;
    throw new LLMProviderError(
      lastErr instanceof Error ? lastErr.message : `OpenRouter request failed: ${String(lastErr)}`,
      lastErr,
    );
  }

  /** A single attempt. Throws RetryableHttpError on 429/5xx, LLMProviderError otherwise. */
  private async once(messages: ILLMMessage[], opts: ILLMCompleteOptions): Promise<string> {
    const controller = new AbortController();
    const timer = opts.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined;

    try {
      const res = await fetch(this.url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.opts.apiKey}`,
          ...(this.opts.referer ? { 'HTTP-Referer': this.opts.referer } : {}),
          ...(this.opts.title ? { 'X-Title': this.opts.title } : {}),
        },
        body: JSON.stringify({
          model: this.opts.model,
          messages,
          temperature: opts.temperature ?? 0,
          max_tokens: opts.maxTokens ?? 256,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const msg = `OpenRouter HTTP ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ''}`;
        if (RETRYABLE_STATUS.has(res.status)) {
          throw new RetryableHttpError(msg, parseRetryAfter(res.headers.get('retry-after')));
        }
        throw new LLMProviderError(msg);
      }

      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new LLMProviderError('OpenRouter response had no message content');
      }
      return content;
    } catch (err) {
      if (err instanceof RetryableHttpError || err instanceof LLMProviderError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        // A timeout is worth one more shot — treat as retryable.
        throw new RetryableHttpError(`OpenRouter request timed out after ${opts.timeoutMs}ms`);
      }
      // Surface the low-level cause: `fetch failed` hides the real reason
      // (ECONNREFUSED / ENOTFOUND / proxy / self-signed cert). undici nests it
      // on .cause, sometimes one level deeper on .cause.code.
      const cause = err instanceof Error ? (err as { cause?: unknown }).cause : undefined;
      const causeStr =
        cause instanceof Error
          ? `${cause.name}: ${cause.message}${(cause as { code?: string }).code ? ` [${(cause as { code?: string }).code}]` : ''}`
          : cause != null
            ? String(cause)
            : '';
      throw new LLMProviderError(
        `OpenRouter request failed: ${String(err)}${causeStr ? ` — cause: ${causeStr} (host ${this.url})` : ''}`,
        err,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** Parse a Retry-After header (seconds, or HTTP-date) into ms. */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}
