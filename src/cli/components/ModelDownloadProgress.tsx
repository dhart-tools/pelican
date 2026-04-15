import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React from 'react';

import { palette } from '@/cli/theme';
import { IModelDownloadProgress } from '@/cli/types';

const BAR_WIDTH = 32;
const FILL = '█';
const EMPTY = '░';

interface ModelDownloadProgressProps {
  progress?: IModelDownloadProgress;
  /** Compact layout drops the spinner + title line (for inline use under a step). */
  compact?: boolean;
}

function formatMb(bytes?: number): string {
  if (!bytes) return '';
  return `${(bytes / 1e6).toFixed(0)} MB`;
}

export function ModelDownloadProgress({ progress, compact }: ModelDownloadProgressProps) {
  const pct = progress?.pct ?? 0;
  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((pct / 100) * BAR_WIDTH)));
  const empty = BAR_WIDTH - filled;
  const file = progress?.file ?? 'reranker weights';
  const sizeText =
    progress?.loaded && progress?.total
      ? ` ${formatMb(progress.loaded)} / ${formatMb(progress.total)}`
      : '';

  if (compact) {
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        <Box>
          <Text color={palette.barFill}>{FILL.repeat(filled)}</Text>
          <Text color={palette.barEmpty}>{EMPTY.repeat(empty)}</Text>
          <Text color={palette.sub} bold>
            {' '}
            {pct.toString().padStart(3)}%
          </Text>
          <Text color={palette.dim}>{sizeText}</Text>
        </Box>
        <Box>
          <Text color={palette.muted}>{file}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} marginTop={1}>
      <Box>
        <Text color={palette.brand}>
          <Spinner type="dots" />
        </Text>
        <Text>{'  '}</Text>
        <Text color={palette.text} bold>
          downloading reranker model
        </Text>
        <Text color={palette.dim}> · first run only, ~600 MB</Text>
      </Box>
      <Box marginTop={1} paddingLeft={5}>
        <Text color={palette.barFill}>{FILL.repeat(filled)}</Text>
        <Text color={palette.barEmpty}>{EMPTY.repeat(empty)}</Text>
        <Text color={palette.sub} bold>
          {' '}
          {pct.toString().padStart(3)}%
        </Text>
        <Text color={palette.dim}>{sizeText}</Text>
      </Box>
      <Box paddingLeft={5} marginTop={0}>
        <Text color={palette.muted}>{file}</Text>
      </Box>
    </Box>
  );
}
