import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React from 'react';

import { Header } from '@/cli/components/Header';
import { ModelDownloadProgress } from '@/cli/components/ModelDownloadProgress';
import { Panel } from '@/cli/components/Panel';
import { SectionDivider } from '@/cli/components/SectionDivider';
import { palette } from '@/cli/theme';
import { ISetupState, ISetupStep } from '@/cli/types';

const LABEL_WIDTH = 12;

function SectionLabel({ label }: { label: string }) {
  return (
    <Box paddingX={2} marginTop={1}>
      <Text color={palette.brandDark} bold>
        ▸{' '}
      </Text>
      <Text color={palette.text} bold>
        {label}
      </Text>
    </Box>
  );
}

function DetectedRow({ step }: { step: ISetupStep }) {
  return (
    <Box paddingX={5}>
      <Text color={palette.cyan} bold>
        {step.name.padEnd(LABEL_WIDTH)}
      </Text>
      <Text color={palette.muted}>{'·  '}</Text>
      {step.detail && <Text color={palette.dim}>{step.detail}</Text>}
    </Box>
  );
}

function InstallingRow({
  step,
  progressBar,
}: {
  step: ISetupStep;
  progressBar?: React.ReactNode;
}) {
  let icon: React.ReactNode;
  let iconColor: string;
  let labelColor: string;

  switch (step.status) {
    case 'loading':
      icon = <Spinner type="dots" />;
      iconColor = palette.brand;
      labelColor = palette.text;
      break;
    case 'success':
      icon = <Text>✔</Text>;
      iconColor = palette.emerald;
      labelColor = palette.sub;
      break;
    case 'error':
      icon = <Text>⚠</Text>;
      iconColor = palette.amber;
      labelColor = palette.amber;
      break;
    default:
      icon = <Text>○</Text>;
      iconColor = palette.muted;
      labelColor = palette.dim;
  }

  return (
    <Box flexDirection="column">
      <Box paddingX={5}>
        <Text color={iconColor}>{icon}</Text>
        <Text>{'  '}</Text>
        <Text color={labelColor} bold>
          {step.name.padEnd(LABEL_WIDTH)}
        </Text>
        {step.detail && <Text color={palette.dim}>{step.detail}</Text>}
      </Box>
      {progressBar && <Box paddingLeft={9}>{progressBar}</Box>}
    </Box>
  );
}

export function SetupView(state: ISetupState) {
  const isDone = state.phase === 'done';
  const isError = state.phase === 'error';

  const borderColor = isError ? palette.rose : isDone ? palette.emerald : palette.border;

  const visibleSteps = state.steps.filter((step) => step.status !== 'idle');
  const detected = visibleSteps.filter((s) => s.section === 'detected');
  const installed = visibleSteps.filter((s) => s.section === 'installed');

  return (
    <Panel borderColor={borderColor}>
      <Header icon="🦅" title="setup" />

      <Box paddingX={2} marginTop={1}>
        <Text color={palette.dim}>configuring </Text>
        <Text color={palette.cyan} bold>
          {state.projectName ?? 'your project'}
        </Text>
      </Box>

      <SectionDivider />

      {detected.length > 0 && (
        <>
          <SectionLabel label="Detected" />
          <Box flexDirection="column" marginTop={1}>
            {detected.map((step, i) => (
              <DetectedRow key={`d-${i}`} step={step} />
            ))}
          </Box>
        </>
      )}

      {installed.length > 0 && (
        <>
          <SectionLabel label="Setup" />
          <Box flexDirection="column" marginTop={1}>
            {installed.map((step, i) => {
              const showBar =
                step.kind === 'model' &&
                step.status === 'loading' &&
                state.modelProgress != null;
              return (
                <InstallingRow
                  key={`i-${i}`}
                  step={step}
                  progressBar={
                    showBar ? (
                      <ModelDownloadProgress progress={state.modelProgress} compact />
                    ) : undefined
                  }
                />
              );
            })}
          </Box>
        </>
      )}

      {isDone && (
        <>
          <Box marginTop={1} />
          <SectionDivider label="ready" />
          <Box paddingX={2} marginTop={1}>
            <Text color={palette.brand} bold>
              ▸{' '}
            </Text>
            <Text color={palette.text} bold>
              pelican analyze
            </Text>
            <Text color={palette.dim}> --files </Text>
            <Text color={palette.cyan}>{'<path>'}</Text>
          </Box>
        </>
      )}

      {isError && state.error && (
        <>
          <SectionDivider />
          <Box paddingX={2} marginTop={1}>
            <Text color={palette.rose} bold>
              ✘ {state.error}
            </Text>
          </Box>
        </>
      )}
    </Panel>
  );
}
