import { LLMProviderError } from '@/core/rerank/llm/provider';
import { createProvider } from '@/core/rerank/llm/provider-factory';
import { IRerankConfig } from '@/types/config';

const base: IRerankConfig = {
  enabled: true,
  provider: 'openrouter',
  model: 'nvidia/nemotron-nano-3-30b-a3b',
  apiKeyEnv: 'OPENROUTER_API_KEY',
  baseUrl: 'https://openrouter.ai/api/v1',
  candidateBand: { min: 0.4, max: 1.0 },
  protectAnchors: true,
  keepThreshold: 0.5,
  dropConfidence: 0.9,
  maxCandidates: 40,
  concurrency: 4,
  timeoutMs: 30000,
  maxRetries: 3,
  highPrecision: false,
};

describe('createProvider — key resolution', () => {
  it('uses the inline apiKey when set', () => {
    const p = createProvider({ ...base, apiKey: 'sk-inline' }, {});
    expect(p.id).toBe('openrouter');
  });

  it('falls back to the named env var', () => {
    const p = createProvider(base, { OPENROUTER_API_KEY: 'sk-env' });
    expect(p.id).toBe('openrouter');
  });

  it('inline key wins over env', () => {
    // both present — should not throw; inline is used
    const p = createProvider({ ...base, apiKey: 'sk-inline' }, { OPENROUTER_API_KEY: 'sk-env' });
    expect(p.id).toBe('openrouter');
  });

  it('throws when neither is set, and the error echoes NO secret value', () => {
    let msg = '';
    try {
      createProvider(base, {});
    } catch (e) {
      msg = (e as LLMProviderError).message;
    }
    expect(msg).toMatch(/no API key found/);
    expect(msg).toContain('OPENROUTER_API_KEY'); // the env var NAME is fine
    expect(msg).not.toContain('sk-'); // never a key value
  });

  it('treats a blank inline key as unset (falls through to env)', () => {
    const p = createProvider({ ...base, apiKey: '   ' }, { OPENROUTER_API_KEY: 'sk-env' });
    expect(p.id).toBe('openrouter');
  });
});
