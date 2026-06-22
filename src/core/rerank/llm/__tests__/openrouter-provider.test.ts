import { OpenRouterProvider } from '@/core/rerank/llm/openrouter-provider';
import { LLMProviderError } from '@/core/rerank/llm/provider';

const okBody = (content: string) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () => ({ choices: [{ message: { content } }] }),
  text: async () => '',
  headers: { get: () => null },
});

const errBody = (status: number, retryAfter?: string) => ({
  ok: false,
  status,
  statusText: 'ERR',
  json: async () => ({}),
  text: async () => 'error body',
  headers: {
    get: (h: string) => (h.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null),
  },
});

const msgs = [{ role: 'user' as const, content: 'hi' }];

describe('OpenRouterProvider — retry/backoff', () => {
  afterEach(() => {
    // @ts-expect-error cleanup test global
    delete global.fetch;
  });

  it('retries a 429 then succeeds', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(errBody(429))
      .mockResolvedValueOnce(okBody('{"relevant":true}'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new OpenRouterProvider({ model: 'm', apiKey: 'k', maxRetries: 3, backoffBaseMs: 0 });
    const out = await p.complete(msgs);
    expect(out).toBe('{"relevant":true}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxRetries on persistent 429 (throws → caller fails open)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(errBody(429));
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new OpenRouterProvider({ model: 'm', apiKey: 'k', maxRetries: 2, backoffBaseMs: 0 });
    await expect(p.complete(msgs)).rejects.toBeInstanceOf(LLMProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does NOT retry a 400 (non-retryable)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(errBody(400));
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new OpenRouterProvider({ model: 'm', apiKey: 'k', maxRetries: 3, backoffBaseMs: 0 });
    await expect(p.complete(msgs)).rejects.toBeInstanceOf(LLMProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient 503 then succeeds', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(errBody(503))
      .mockResolvedValueOnce(okBody('ok'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new OpenRouterProvider({ model: 'm', apiKey: 'k', maxRetries: 1, backoffBaseMs: 0 });
    expect(await p.complete(msgs)).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
