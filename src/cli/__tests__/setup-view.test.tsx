import { render } from 'ink-testing-library';
import React from 'react';

import { SetupView } from '@/cli/views/SetupView';

const base = {
  steps: [],
  detectedConfig: null,
  projectName: 'checkout-app',
};

describe('SetupView provider flow', () => {
  it('shows GitHub Copilot as the selected provider', () => {
    const { lastFrame } = render(
      <SetupView {...base} phase="provider-select" selectedProviderIndex={1} />,
    );
    expect(lastFrame()).toContain('●  GitHub Copilot');
    expect(lastFrame()).toContain('uses your company Copilot access');
  });

  it('shows the global install command and explicit confirmation', () => {
    const { lastFrame } = render(
      <SetupView {...base} phase="copilot-install-confirm" selectedProvider="copilot" />,
    );
    expect(lastFrame()).toContain('npm install -g @github/copilot');
    expect(lastFrame()).toContain('y confirm · n skip');
  });

  it('hands model selection to the Copilot /model command', () => {
    const { lastFrame } = render(
      <SetupView {...base} phase="copilot-model-select" selectedProvider="copilot" />,
    );
    expect(lastFrame()).toContain('/model');
    expect(lastFrame()).toContain('then exit Copilot');
  });

  it('shows --rerank in the next command for the local provider', () => {
    const { lastFrame } = render(<SetupView {...base} phase="done" selectedProvider="ollama" />);
    expect(lastFrame()).toContain('pelican analyze --rerank --files');
  });
});
