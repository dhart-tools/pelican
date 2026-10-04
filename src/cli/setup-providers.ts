export type SetupProvider = 'ollama' | 'copilot' | 'skip';

export interface ISetupProviderOption {
  id: SetupProvider;
  name: string;
  detail: string;
}

export const SETUP_PROVIDERS: ISetupProviderOption[] = [
  {
    id: 'ollama',
    name: 'Local model',
    detail: 'Ollama · private · uses local compute',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    detail: 'uses your Copilot access',
  },
  {
    id: 'skip',
    name: 'Skip AI reranking',
    detail: 'use static analysis only',
  },
];
