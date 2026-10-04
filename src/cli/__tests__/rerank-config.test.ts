import { configureCopilotRerank } from '@/cli/rerank-config';

describe('configureCopilotRerank', () => {
  it('removes fields owned by OpenRouter and Ollama while preserving shared controls', () => {
    expect(
      configureCopilotRerank(
        {
          enabled: true,
          provider: 'openrouter',
          model: 'openrouter/model',
          apiKeyEnv: 'OPENROUTER_API_KEY',
          apiKey: 'secret-that-must-not-survive',
          baseUrl: 'https://openrouter.ai/api/v1',
          maxRetries: 3,
          ollamaModel: 'qwen3.5:latest',
          candidateBand: { min: 0.4, max: 0.9 },
          maxCandidates: 40,
          timeoutMs: 30000,
        },
        true,
        'claude-haiku-4.5',
      ),
    ).toEqual({
      enabled: true,
      provider: 'copilot',
      copilotModel: 'claude-haiku-4.5',
      candidateBand: { min: 0.4, max: 0.9 },
      maxCandidates: 40,
      timeoutMs: 30000,
    });
  });
});
