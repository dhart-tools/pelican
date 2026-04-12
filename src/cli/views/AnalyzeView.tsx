import { Box, Text } from 'ink';
import React from 'react';

import { Header } from '@/cli/components/Header';
import { Panel } from '@/cli/components/Panel';
import { ResultsTable } from '@/cli/components/ResultsTable';
import { SectionDivider } from '@/cli/components/SectionDivider';
import { StatusStep } from '@/cli/components/StatusStep';
import { palette } from '@/cli/theme';
import { IAnalyzeState, AnalyzePhase } from '@/cli/types';

const PHASE_LABELS: Record<AnalyzePhase, string> = {
  'loading-config': 'configuration',
  'loading-registry': 'loading registry',
  'building-registry': 'building registry',
  'detecting-changes': 'detecting changes',
  analyzing: 'running analyzers',
  scoring: 'scoring relevance',
  done: 'analysis complete',
  error: 'error',
};

export function AnalyzeView(state: IAnalyzeState) {
  const phases: AnalyzePhase[] = [
    'loading-config',
    state.phase === 'building-registry' ? 'building-registry' : 'loading-registry',
    'detecting-changes',
    'scoring',
  ];

  function stepStatus(step: AnalyzePhase): 'idle' | 'loading' | 'success' | 'error' {
    if (state.phase === 'error') {
      const si = phases.indexOf(step);
      const ci = phases.indexOf('scoring');
      return si < ci ? 'success' : 'error';
    }
    if (state.phase === 'done') return 'success';
    const si = phases.indexOf(step);
    const ci = phases.indexOf(state.phase);
    if (si < ci) return 'success';
    if (si === ci) return 'loading';
    return 'idle';
  }

  function stepDetail(step: AnalyzePhase): string | undefined {
    if (stepStatus(step) !== 'success') return undefined;
    switch (step) {
      case 'loading-registry':
      case 'building-registry':
        if (!state.registryStats) return undefined;
        return `${state.registryStats.sourceFiles} source  ·  ${state.registryStats.testFiles} tests`;
      case 'detecting-changes':
        return `${state.changedFiles.length} file${state.changedFiles.length !== 1 ? 's' : ''}`;
      default:
        return undefined;
    }
  }

  const borderColor =
    state.phase === 'error'
      ? palette.rose
      : state.phase === 'done'
        ? palette.emerald
        : palette.border;

  const isDone = state.phase === 'done';
  const hasResults = isDone && state.results.length > 0;
  const noChanges = isDone && state.changedFiles.length === 0;

  return (
    <Panel borderColor={borderColor}>
      <Header icon="🦅" title="analyze" />
      <SectionDivider />

      <Box flexDirection="column" marginTop={1}>
        {phases.map((phase) => (
          <StatusStep
            key={phase}
            status={stepStatus(phase)}
            label={PHASE_LABELS[phase]}
            detail={stepDetail(phase)}
          />
        ))}
        {state.phase === 'scoring' && state.currentFile && (
          <Box paddingLeft={7} marginTop={1}>
            <Text color={palette.brand} bold>
              ◆{' '}
            </Text>
            <Text color={palette.cyan}>{state.currentFile}</Text>
          </Box>
        )}
      </Box>

      {noChanges && (
        <>
          <SectionDivider />
          <Box marginTop={1}>
            <Text color={palette.dim}>
              No changed files detected. Try{' '}
              <Text color={palette.brand} bold>
                --files
              </Text>{' '}
              to specify files explicitly.
            </Text>
          </Box>
        </>
      )}

      {hasResults && <ResultsTable results={state.results} />}

      {state.phase === 'error' && state.error && (
        <>
          <SectionDivider />
          <Text color={palette.rose} bold>
            ✘ {state.error}
          </Text>
        </>
      )}
    </Panel>
  );
}
