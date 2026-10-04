const COPILOT_IRRELEVANT_FIELDS = [
  'model',
  'apiKeyEnv',
  'apiKey',
  'baseUrl',
  'maxRetries',
  'ollamaModel',
] as const;

/** Keep shared rerank controls while replacing fields owned by other providers. */
export function configureCopilotRerank(
  current: Record<string, unknown>,
  enabled: boolean,
  copilotModel?: string,
): Record<string, unknown> {
  const next = { ...current };
  for (const field of COPILOT_IRRELEVANT_FIELDS) delete next[field];

  return {
    ...next,
    enabled,
    provider: 'copilot',
    ...(copilotModel ? { copilotModel } : {}),
  };
}
