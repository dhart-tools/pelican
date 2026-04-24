import { Box, Text } from 'ink';
import React from 'react';

import { Header } from '@/cli/components/Header';
import { Panel } from '@/cli/components/Panel';
import { ResultsTable } from '@/cli/components/ResultsTable';
import { SectionDivider } from '@/cli/components/SectionDivider';
import { Shimmer } from '@/cli/components/Shimmer';
import { StatusStep } from '@/cli/components/StatusStep';
import { palette } from '@/cli/theme';
import { IAnalyzeState, AnalyzePhase } from '@/cli/types';

const PHASE_LABELS: Record<AnalyzePhase, string> = {
  'loading-config': 'configuration',
  'loading-registry': 'loading registry',
  'building-registry': 'building registry',
  'detecting-changes': 'detecting changes',
  'checking-reranker': 'checking reranker',
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
    'checking-reranker',
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
      case 'checking-reranker':
        return state.rerankerUnavailable ? 'unavailable · using lock cache' : 'ollama ready';
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
        {(state.phase === 'scoring' || state.phase === 'done') && state.changedFiles.length > 0 && (
          <Box flexDirection="column" paddingLeft={6} marginBottom={1}>
            {state.changedFiles.map((file, i) => {
              const isDoneFile = (state.completedFiles ?? []).includes(file);
              const isActive =
                !isDoneFile &&
                ((state.activeFiles ?? []).includes(file) || state.currentFile === file);
              const isLast = i === state.changedFiles.length - 1;
              const branch = isLast ? '╰' : '├';

              if (isDoneFile) {
                return (
                  <Box key={file}>
                    <Text color={palette.muted}>
                      {branch}
                      {'─ '}
                    </Text>
                    <Text color={palette.emerald}>✔</Text>
                    <Text color={palette.muted}>{'  '}</Text>
                    <Text color={palette.sub}>{file}</Text>
                  </Box>
                );
              }

              if (isActive) {
                const prog = state.rerankProgress?.[file];
                const BAR_W = 12;
                let bar: React.ReactNode = null;
                if (prog && prog.total > 0) {
                  const filled = Math.max(
                    0,
                    Math.min(BAR_W, Math.round((prog.scored / prog.total) * BAR_W)),
                  );
                  const bars = '█'.repeat(filled) + '░'.repeat(BAR_W - filled);
                  bar = (
                    <Box>
                      <Text color={palette.brand}>{bars}</Text>
                      <Text color={palette.dim}>
                        {'  '}
                        {prog.scored}/{prog.total}
                      </Text>
                    </Box>
                  );
                }

                return (
                  <Box key={file} justifyContent="space-between" paddingRight={2}>
                    <Box>
                      <Text color={palette.muted}>
                        {branch}
                        {'─ '}
                      </Text>
                      <Shimmer text={file} />
                    </Box>
                    {bar && <Box flexShrink={0}>{bar}</Box>}
                  </Box>
                );
              }

              return (
                <Box key={file}>
                  <Text color={palette.muted}>
                    {branch}
                    {'─ '}
                  </Text>
                  <Text color={palette.muted}>○</Text>
                  <Text color={palette.muted}>{'  '}</Text>
                  <Text color={palette.dim}>{file}</Text>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {state.rerankerUnavailable && (
        <Box marginTop={1} paddingX={2} flexDirection="column">
          <Box>
            <Text color={palette.amber} bold>
              ⚠ Ollama reranker unavailable
            </Text>
          </Box>
          <Box paddingLeft={4}>
            <Text color={palette.dim}>
              using pelican structural scoring + cached mappings.{' '}
              <Text color={palette.brand} bold>
                ollama pull qwen3:3b
              </Text>{' '}
              to enable.
            </Text>
          </Box>
          {state.rerankerError && (
            <Box paddingLeft={4}>
              <Text color={palette.muted}>{state.rerankerError}</Text>
            </Box>
          )}
        </Box>
      )}

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

      {hasResults && (
        <ResultsTable
          results={state.results}
          maxResults={state.maxResults}
          elapsedMs={state.elapsedMs}
          expanded={state.expanded}
        />
      )}

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
