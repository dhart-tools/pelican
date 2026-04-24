import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React from 'react';

import { Header } from '@/cli/components/Header';
import { ModelDownloadProgress } from '@/cli/components/ModelDownloadProgress';
import { Panel } from '@/cli/components/Panel';
import { SectionDivider } from '@/cli/components/SectionDivider';
import { palette } from '@/cli/theme';
import { ISetupState, ISetupStep } from '@/cli/types';
import { SETUP_MODELS, downloadMinutes } from '@/cli/setup-models';

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

function Stars({ count, active }: { count: number; active: boolean }) {
  const filled = '★'.repeat(count);
  const empty = '☆'.repeat(3 - count);
  return (
    <Text color={active ? palette.brand : palette.muted}>
      {filled}
      <Text color={palette.muted}>{empty}</Text>
    </Text>
  );
}

/** Format bytes/sec as "X Mbps (Y MB/s)" so bits-vs-bytes is unambiguous. */
function formatSpeed(bps: number): string {
  const mbps = (bps * 8) / 1e6;
  const MBps = bps / 1e6;
  const mbpsStr = mbps >= 1 ? `${mbps.toFixed(0)} Mbps` : `${(mbps * 1000).toFixed(0)} Kbps`;
  return `${mbpsStr} · ${MBps.toFixed(1)} MB/s`;
}

function isInstalled(modelName: string, installedModels: string[]): boolean {
  return installedModels.some(
    (m) => m === modelName || m.startsWith(modelName.split(':')[0] + ':'),
  );
}

function ModelSelectMenu({
  selectedIndex,
  internetSpeedBps,
  installedModels = [],
}: {
  selectedIndex: number;
  internetSpeedBps?: number;
  installedModels?: string[];
}) {
  const hasSpeed = (internetSpeedBps ?? 0) > 0;
  const speedLabel = hasSpeed
    ? `your connection · ${formatSpeed(internetSpeedBps!)}`
    : '50 Mbps estimate';

  return (
    <Box flexDirection="column" marginTop={1}>
      <SectionLabel label="Select reranker model" />

      {/* Speed attribution line */}
      <Box paddingX={7} marginTop={1}>
        <Text color={palette.dim}>download times based on </Text>
        <Text color={hasSpeed ? palette.cyan : palette.muted}>{speedLabel}</Text>
      </Box>

      {/* Column header */}
      <Box paddingX={7} marginTop={1} marginBottom={0}>
        <Text color={palette.muted}>{'model'.padEnd(24)}</Text>
        <Text color={palette.muted}>{'size'.padEnd(10)}</Text>
        <Text color={palette.muted}>{'precision'.padEnd(14)}</Text>
        <Text color={palette.muted}>{'est. download'}</Text>
      </Box>

      <Box flexDirection="column" marginTop={0}>
        {SETUP_MODELS.map((model, i) => {
          const active = i === selectedIndex;
          const isSkip = model.skip === true;
          const installed = !isSkip && isInstalled(model.name, installedModels);
          return (
            <Box key={model.name} paddingX={5} marginTop={isSkip ? 1 : 0}>
              <Text color={active ? palette.brand : palette.muted} bold>
                {active ? '●' : '○'}
              </Text>
              <Text>{'  '}</Text>
              {isSkip ? (
                <>
                  <Text color={active ? palette.amber : palette.muted} bold>
                    {'skip for now'.padEnd(24)}
                  </Text>
                  <Text color={palette.dim}>{model.desc}</Text>
                </>
              ) : (
                <>
                  <Text color={active ? palette.cyan : palette.text} bold>
                    {model.name.padEnd(24)}
                  </Text>
                  <Text color={active ? palette.sub : palette.dim}>{model.size.padEnd(10)}</Text>
                  <Box width={14}>
                    <Stars count={model.stars} active={active} />
                    <Text color={active ? palette.sub : palette.muted}>
                      {' '}
                      {model.precision}
                    </Text>
                  </Box>
                  {installed ? (
                    <Text color={palette.emerald} bold>✔ already installed</Text>
                  ) : (
                    <Text color={active ? palette.sub : palette.muted}>
                      {downloadMinutes(model.sizeBytes, internetSpeedBps)}
                    </Text>
                  )}
                </>
              )}
            </Box>
          );
        })}
      </Box>

      <Box paddingX={5} marginTop={1}>
        <Text color={palette.muted}>↑↓ navigate · enter to confirm</Text>
      </Box>

      <Box paddingX={5} marginTop={1}>
        <Text color={palette.dim}>tip: </Text>
        <Text color={palette.muted}>other models → set </Text>
        <Text color={palette.cyan}>rerank.ollamaModel</Text>
        <Text color={palette.muted}> in </Text>
        <Text color={palette.cyan}>.pelicanrc.json</Text>
      </Box>
    </Box>
  );
}

export function SetupView(state: ISetupState) {
  const isDone = state.phase === 'done';
  const isError = state.phase === 'error';
  const isModelSelect = state.phase === 'model-select';

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

      {isModelSelect && (
        <ModelSelectMenu
          selectedIndex={state.selectedModelIndex ?? 1}
          internetSpeedBps={state.internetSpeedBps}
          installedModels={state.installedModels}
        />
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
