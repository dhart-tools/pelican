import { Box, Text } from 'ink';
import React from 'react';

import { Header } from '@/cli/components/Header';
import { Panel } from '@/cli/components/Panel';
import { SectionDivider } from '@/cli/components/SectionDivider';
import { StatusStep } from '@/cli/components/StatusStep';
import { palette } from '@/cli/theme';
import { ISetupState } from '@/cli/types';

export function SetupView(state: ISetupState) {
  const isDone = state.phase === 'done';
  const isError = state.phase === 'error';

  const borderColor = isError ? palette.rose : isDone ? palette.emerald : palette.border;

  return (
    <Panel borderColor={borderColor}>
      <Header icon="🦅" title="setup" />
      <SectionDivider />

      <Box flexDirection="column" marginTop={1}>
        {state.steps.map((step, i) => (
          <StatusStep key={i} status={step.status} label={step.name} detail={step.detail} />
        ))}
      </Box>

      {isDone && (
        <>
          <SectionDivider label="setup complete" />
          <Box flexDirection="column" paddingLeft={2} marginTop={1}>
            <Box>
              <Text color={palette.dim}>next </Text>
              <Text color={palette.brand} bold>
                pelican registry build
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text color={palette.dim}>then </Text>
              <Text color={palette.cyan}>pelican analyze --files {'<path>'}</Text>
            </Box>
          </Box>
        </>
      )}

      {isError && state.error && (
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
