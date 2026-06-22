import { ILLMCompleteOptions, ILLMMessage, ILLMProvider, LLMProviderError } from './provider';

export interface OpenRouterOptions {
  model: string;
  apiKey: string;
  baseUrl?: string;
  /** Optional attribution headers OpenRouter recommends. */
  referer?: string;
  title?: string;
}

/**
 * OpenRouter chat-completions provider. Talks the OpenAI-compatible
 * `/chat/completions` schema OpenRouter exposes, so any model slug on the
 * platform (anthropic/*, z-ai/*, deepseek/*, …) works unchanged.
 */
export class OpenRouterProvider implements ILLMProvider {
  readonly id = 'openrouter';
  private readonly url: string;

  constructor(private readonly opts: OpenRouterOptions) {
    if (!opts.apiKey) throw new LLMProviderError('OpenRouter API key is empty');
    const base = (opts.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    this.url = `${base}/chat/completions`;
  }

  async complete(messages: ILLMMessage[], opts: ILLMCompleteOptions = {}): Promise<string> {
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
        throw new LLMProviderError(
          `OpenRouter HTTP ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ''}`,
        );
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new LLMProviderError('OpenRouter response had no message content');
      }
      return content;
    } catch (err) {
      if (err instanceof LLMProviderError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new LLMProviderError(`OpenRouter request timed out after ${opts.timeoutMs}ms`, err);
      }
      throw new LLMProviderError(`OpenRouter request failed: ${String(err)}`, err);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
