import { IRerankConfig } from '@/types/config';

import { OpenRouterProvider } from './openrouter-provider';
import { ILLMProvider, LLMProviderError } from './provider';

/**
 * Builds the LLM provider named in config. Resolves the API key from
 * `config.apiKey` (inline, if set) first, otherwise from the env var named by
 * `config.apiKeyEnv`. Throws a clear error when neither yields a key so callers
 * can fail-open and warn instead of crashing.
 */
export function createProvider(
  config: IRerankConfig,
  env: Record<string, string | undefined> = process.env,
): ILLMProvider {
  switch (config.provider) {
    case 'openrouter': {
      // Inline key wins; else read the named env var. The error never echoes a
      // value — only the env-var NAME — so a misplaced secret can't leak to logs.
      const apiKey = config.apiKey?.trim() || env[config.apiKeyEnv];
      if (!apiKey) {
        throw new LLMProviderError(
          `rerank enabled but no API key found — set rerank.apiKey, or export ` +
            `${config.apiKeyEnv}, or set rerank.enabled=false.`,
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
