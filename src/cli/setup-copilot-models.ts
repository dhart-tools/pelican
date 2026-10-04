export interface ISetupCopilotModel {
  id: string;
  detail: string;
}

/**
 * Models supported by GitHub Copilot CLI. An organization may restrict which
 * of these models an account can use; Copilot reports that at runtime.
 */
export const SETUP_COPILOT_MODELS: ISetupCopilotModel[] = [
  { id: 'auto', detail: 'Copilot chooses · recommended' },
  { id: 'claude-sonnet-4.6', detail: 'Anthropic · balanced' },
  { id: 'gpt-5.4', detail: 'OpenAI · general purpose' },
  { id: 'gpt-6-astra', detail: 'OpenAI · high capability' },
  { id: 'gpt-6-sol', detail: 'OpenAI · high capability' },
  { id: 'gpt-6-luna', detail: 'OpenAI · efficient' },
  { id: 'claude-opus-5.5', detail: 'Anthropic · highest capability' },
  { id: 'claude-haiku-4.5', detail: 'Anthropic · fast' },
  { id: 'gpt-5.3-codex', detail: 'OpenAI · coding focused' },
  { id: 'gemini-3.7-flash', detail: 'Google · fast' },
];
