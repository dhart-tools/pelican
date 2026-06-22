import { render } from 'ink-testing-library';
import React from 'react';

import { EConfidenceLevel } from '@/utils/enums';

import { AnalyzeView } from '../views/AnalyzeView';
import { RegistryBuildView } from '../views/RegistryBuildView';
import { SetupView } from '../views/SetupView';

describe('AnalyzeView', () => {
  it('shows loading steps during loading-config phase', () => {
    const { lastFrame } = render(
      <AnalyzeView phase="loading-config" changedFiles={[]} results={[]} progress={0} />,
    );
    expect(lastFrame()).toContain('configuration');
  });

  it('shows all steps as success when done', () => {
    const { lastFrame } = render(
      <AnalyzeView phase="done" changedFiles={['src/Button.tsx']} results={[]} progress={100} />,
    );
    expect(lastFrame()).toContain('✔');
    expect(lastFrame()).toContain('configuration');
    expect(lastFrame()).toContain('scoring relevance');
  });

  it('displays results table when done with results', () => {
    const { lastFrame } = render(
      <AnalyzeView
        phase="done"
        changedFiles={['src/Button.tsx']}
        results={[
          {
            changedFile: 'src/Button.tsx',
            suggestedTests: [
              {
                testFile: 'cypress/e2e/button.cy.ts',
                score: 0.95,
                signals: [],
                confidence: EConfidenceLevel.HIGH,
                explanation: 'Test directly imports this file',
              },
            ],
          },
        ]}
        progress={100}
      />,
    );
    expect(lastFrame()).toContain('button.cy.ts');
    // Confidence is shown as a tier now (no raw score).
    expect(lastFrame()).toContain('MUST RUN');
  });

  it('shows "no changed files" message when done with empty list', () => {
    const { lastFrame } = render(
      <AnalyzeView phase="done" changedFiles={[]} results={[]} progress={100} />,
    );
    expect(lastFrame()).toContain('No changed files detected');
  });

  it('shows error message when phase is error', () => {
    const { lastFrame } = render(
      <AnalyzeView
        phase="error"
        changedFiles={[]}
        results={[]}
        progress={0}
        error="Registry cache not found"
      />,
    );
    expect(lastFrame()).toContain('✘');
    expect(lastFrame()).toContain('Registry cache not found');
  });

  it('shows current file during scoring phase', () => {
    const { lastFrame } = render(
      <AnalyzeView
        phase="scoring"
        changedFiles={['a.tsx', 'b.tsx']}
        results={[]}
        progress={50}
        currentFile="a.tsx"
      />,
    );
    expect(lastFrame()).toContain('a.tsx');
  });
});

describe('RegistryBuildView', () => {
  it('shows scanning step as loading initially', () => {
    const { lastFrame } = render(
      <RegistryBuildView phase="scanning" totalFiles={0} processedFiles={0} />,
    );
    expect(lastFrame()).toContain('scanning files');
  });

  it('shows extracting-source step label', () => {
    const { lastFrame } = render(
      <RegistryBuildView phase="extracting-source" totalFiles={100} processedFiles={0} />,
    );
    expect(lastFrame()).toContain('extracting source');
  });

  it('shows stats summary when done', () => {
    const { lastFrame } = render(
      <RegistryBuildView
        phase="done"
        totalFiles={970}
        processedFiles={970}
        stats={{
          totalFiles: 970,
          sourceFiles: 847,
          testFiles: 123,
          dependencies: 2341,
          selectors: 456,
          routes: 28,
          duration: 3200,
        }}
      />,
    );
    expect(lastFrame()).toContain('registry built');
    expect(lastFrame()).toContain('847');
    expect(lastFrame()).toContain('123');
    expect(lastFrame()).toContain('3.2s');
  });

  it('shows error message when phase is error', () => {
    const { lastFrame } = render(
      <RegistryBuildView phase="error" totalFiles={0} processedFiles={0} error="Failed to scan" />,
    );
    expect(lastFrame()).toContain('Failed to scan');
  });
});

describe('SetupView', () => {
  it('shows detection steps', () => {
    const { lastFrame } = render(
      <SetupView
        phase="detecting"
        steps={[{ name: 'Scanning project...', status: 'loading', section: 'detected' }]}
        detectedConfig={null}
      />,
    );
    expect(lastFrame()).toContain('Scanning project');
  });

  it('shows all detected steps when saving', () => {
    // Steps must carry a `section` and be non-idle to render (idle steps are
    // intentionally hidden; SetupView groups by detected/installed).
    const { lastFrame } = render(
      <SetupView
        phase="saving"
        steps={[
          {
            name: 'Cypress detected',
            status: 'success',
            detail: 'cypress-extractor enabled',
            section: 'detected',
          },
          { name: 'Redux detected', status: 'success', detail: 'enabled', section: 'detected' },
        ]}
        detectedConfig={null}
      />,
    );
    expect(lastFrame()).toContain('Cypress detected');
    expect(lastFrame()).toContain('Redux detected');
  });

  it('shows completion banner when done', () => {
    const { lastFrame } = render(
      <SetupView
        phase="done"
        steps={[
          { name: 'Cypress detected', status: 'success', detail: 'enabled', section: 'detected' },
          { name: 'Config saved', status: 'success', section: 'installed' },
        ]}
        detectedConfig={null}
      />,
    );
    // Done banner now reads "ready" + the `pelican analyze` next step.
    expect(lastFrame()).toContain('ready');
    expect(lastFrame()).toContain('pelican analyze');
  });

  it('shows error message when phase is error', () => {
    const { lastFrame } = render(
      <SetupView
        phase="error"
        steps={[]}
        detectedConfig={null}
        error="Failed to read package.json"
      />,
    );
    expect(lastFrame()).toContain('✘');
    expect(lastFrame()).toContain('Failed to read package.json');
  });
});
