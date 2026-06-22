import { IRerankConfig } from '@/types/config';

import { OpenRouterProvider } from './openrouter-provider';
import { ILLMProvider, LLMProviderError } from './provider';

/**
 * Builds the LLM provider named in config, reading the API key from the env var
 * the config points at (never from the file). Throws a clear error when the key
 * is missing so callers can fail-open and warn instead of crashing.
 */
export function createProvider(
  config: IRerankConfig,
  env: Record<string, string | undefined> = process.env,
): ILLMProvider {
  switch (config.provider) {
    case 'openrouter': {
      const apiKey = env[config.apiKeyEnv];
      if (!apiKey) {
        throw new LLMProviderError(
          `rerank enabled but ${config.apiKeyEnv} is not set — export your OpenRouter key, ` +
            `or set rerank.enabled=false.`,
        );
      }
      return new OpenRouterProvider({
        model: config.model,
        apiKey,
        baseUrl: config.baseUrl,
        referer: 'https://github.com/pelican',
        title: 'pelican',
        maxRetries: config.maxRetries,
      });
    }
    default:
      throw new LLMProviderError(`unknown rerank provider: ${String(config.provider)}`);
  }
}
