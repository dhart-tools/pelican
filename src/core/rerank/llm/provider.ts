/**
 * Provider-agnostic LLM surface. The reranker depends only on this; concrete
 * backends (OpenRouter today, others later) implement it. Keeping it this thin
 * means a new provider is one file + one factory line, with zero reranker churn.
 */
export interface ILLMMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ILLMCompleteOptions {
  /** Abort the request after this many ms (caller enforces fail-open on abort). */
  timeoutMs?: number;
  /** Low for deterministic judgments. */
  temperature?: number;
  /** Cap response size — verdicts are tiny JSON. */
  maxTokens?: number;
}

export interface ILLMProvider {
  /** Stable id for logs/debug (e.g. 'openrouter'). */
  readonly id: string;
  /** Send a chat completion, return the assistant's raw text. Throws on
   * HTTP/timeout/transport error — the caller decides fail-open policy. */
  complete(messages: ILLMMessage[], opts?: ILLMCompleteOptions): Promise<string>;
}

export class LLMProviderError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LLMProviderError';
  }
}
