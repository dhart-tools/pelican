import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import React, { useEffect, useState } from 'react';

import { Command } from 'commander';
import { render } from 'ink';

import { Header } from '@/cli/components/Header';
import { ModelDownloadProgress } from '@/cli/components/ModelDownloadProgress';
import { Panel } from '@/cli/components/Panel';
import { SectionDivider } from '@/cli/components/SectionDivider';
import { palette } from '@/cli/theme';
import { IModelDownloadProgress } from '@/cli/types';
import { loadTheme } from '@/cli/user-config';
import {
  DEFAULT_CROSS_ENCODER_CONFIG,
  CrossEncoderReranker,
} from '@/core/rerank/cross-encoder-reranker';

interface DownloadState {
  phase: 'starting' | 'downloading' | 'done' | 'error';
  progress?: IModelDownloadProgress;
  error?: string;
}

function ModelDownloadApp() {
  const { exit } = useApp();
  const [state, setState] = useState<DownloadState>({ phase: 'starting' });

  useEffect(() => {
    async function run() {
      const reranker = new CrossEncoderReranker({
        onProgress: (info) => {
          if (info.status === 'progress' && info.file) {
            setState({
              phase: 'downloading',
              progress: {
                file: info.file,
                pct: info.pct ?? 0,
                loaded: info.loaded,
                total: info.total,
              },
            });
          } else if (info.status === 'ready') {
            setState({ phase: 'done' });
          }
        },
      });
      try {
        await reranker.ensureModel();
        setState({ phase: 'done' });
        setTimeout(() => exit(), 200);
      } catch (err) {
        setState({
          phase: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
        setTimeout(() => exit(), 200);
      }
    }
    run();
  }, [exit]);

  const borderColor =
    state.phase === 'error'
      ? palette.amber
      : state.phase === 'done'
        ? palette.emerald
        : palette.border;

  return (
    <Panel borderColor={borderColor}>
      <Header icon="🦅" title="model:download" />
      <SectionDivider />

      <Box flexDirection="column" marginTop={1} paddingX={2}>
        <Text color={palette.dim}>
          model: <Text color={palette.sub}>{DEFAULT_CROSS_ENCODER_CONFIG.model}</Text>
        </Text>
        <Text color={palette.dim}>
          cache: <Text color={palette.sub}>{DEFAULT_CROSS_ENCODER_CONFIG.modelCacheDir}</Text>
        </Text>
      </Box>

      {state.phase === 'starting' && (
        <Box paddingX={2} marginTop={1}>
          <Text color={palette.brand}>
            <Spinner type="dots" />
          </Text>
          <Text>{'  '}</Text>
          <Text color={palette.text}>initializing…</Text>
        </Box>
      )}

      {state.phase === 'downloading' && <ModelDownloadProgress progress={state.progress} />}

      {state.phase === 'done' && (
        <>
          <SectionDivider />
          <Box paddingX={2} marginTop={1}>
            <Text color={palette.emerald} bold>
              ✔ reranker model ready
            </Text>
          </Box>
          <Box paddingX={2}>
            <Text color={palette.dim}>
              pelican analyze will now use semantic reranking.
            </Text>
          </Box>
        </>
      )}

      {state.phase === 'error' && (
        <>
          <SectionDivider />
          <Box paddingX={2} marginTop={1} flexDirection="column">
            <Text color={palette.amber} bold>
              ⚠ download failed
            </Text>
            {state.error && (
              <Box paddingLeft={2} marginTop={1}>
                <Text color={palette.muted}>{state.error}</Text>
              </Box>
            )}
            <Box paddingLeft={2} marginTop={1}>
              <Text color={palette.dim}>
                pelican will still work without the reranker — structural
                scorers alone will produce suggestions.
              </Text>
            </Box>
          </Box>
        </>
      )}
    </Panel>
  );
}

export async function runModelDownloadHeadless(): Promise<number> {
  const progressState = new Map<string, number>();
  const reranker = new CrossEncoderReranker({
    onProgress: (info) => {
      if (info.status === 'progress' && info.file && typeof info.pct === 'number') {
        const prev = progressState.get(info.file) ?? -1;
        if (info.pct < prev + 5) return;
        progressState.set(info.file, info.pct);
        const mb =
          info.loaded && info.total
            ? ` ${(info.loaded / 1e6).toFixed(0)}/${(info.total / 1e6).toFixed(0)} MB`
            : '';
        process.stderr.write(`[pelican] ${info.file} ${info.pct}%${mb}\n`);
      } else if (info.status === 'ready') {
        process.stderr.write('[pelican] reranker ready\n');
      }
    },
  });
  try {
    await reranker.ensureModel();
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[pelican] model download failed: ${msg}\n`);
    return 1;
  }
}

export const modelCommand = new Command('model')
  .description('Manage the local reranker model')
  .addCommand(
    new Command('download')
      .description('Download the cross-encoder reranker model (~600 MB, first run only)')
      .option('--ci', 'Non-interactive mode (stderr logs instead of TUI)')
      .action(async (opts: { ci?: boolean }) => {
        if (opts.ci) {
          const code = await runModelDownloadHeadless();
          process.exit(code);
        }
        await loadTheme();
        const { waitUntilExit } = render(<ModelDownloadApp />);
        await waitUntilExit();
      }),
  );
