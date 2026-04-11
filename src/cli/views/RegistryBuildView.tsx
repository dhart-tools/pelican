import React from 'react';
import { Box, Text } from 'ink';
import { Header } from '../components/Header';
import { StatusStep } from '../components/StatusStep';
import { Panel } from '../components/Panel';
import { SectionDivider } from '../components/SectionDivider';
import { palette } from '../theme';
import { IRegistryBuildState } from '../types';

const STEPS = [
  'scanning',
  'extracting-source',
  'extracting-tests',
  'building-indexes',
  'saving',
] as const;

const STEP_LABELS: Record<string, string> = {
  'scanning':           'scanning files',
  'extracting-source':  'extracting source',
  'extracting-tests':   'extracting tests',
  'building-indexes':   'building indexes',
  'saving':             'saving registry',
};

function StatCell({ label, value }: { label: string; value: string | number }) {
  return (
    <Box flexDirection="column" marginRight={4}>
      <Text color={palette.dim}>{label}</Text>
      <Text color={palette.text} bold>{String(value)}</Text>
    </Box>
  );
}

export function RegistryBuildView(state: IRegistryBuildState) {
  function stepStatus(step: string): 'idle' | 'loading' | 'success' | 'error' {
    if (state.phase === 'error') return 'error';
    if (state.phase === 'done') return 'success';
    const si = STEPS.indexOf(step as never);
    const ci = STEPS.indexOf(state.phase as never);
    if (si < ci) return 'success';
    if (si === ci) return 'loading';
    return 'idle';
  }

  const borderColor = state.phase === 'error' ? palette.rose
    : state.phase === 'done' ? palette.emerald
    : palette.border;

  return (
    <Panel borderColor={borderColor}>
      <Header icon="🦅" title="registry build" />
      <SectionDivider />

      <Box flexDirection="column" marginTop={1}>
        {STEPS.map((step) => (
          <StatusStep key={step} status={stepStatus(step)} label={STEP_LABELS[step]} />
        ))}
      </Box>

      {state.phase === 'done' && state.stats && (
        <>
          <SectionDivider label="registry built" />
          <Box marginTop={1}>
            <StatCell label="source"       value={state.stats.sourceFiles} />
            <StatCell label="tests"        value={state.stats.testFiles} />
            <StatCell label="dependencies" value={state.stats.dependencies.toLocaleString()} />
            <StatCell label="selectors"    value={state.stats.selectors} />
            <StatCell label="routes"       value={state.stats.routes} />
            <StatCell label="duration"     value={`${(state.stats.duration / 1000).toFixed(1)}s`} />
          </Box>
        </>
      )}

      {state.phase === 'error' && (
        <>
          <SectionDivider />
          <Text color={palette.rose} bold>✘  {state.error}</Text>
        </>
      )}
    </Panel>
  );
}
