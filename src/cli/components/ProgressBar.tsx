import React from 'react';
import { Box, Text } from 'ink';
import { palette } from '../theme';

interface ProgressBarProps {
  value: number;
  width?: number;
  label?: string;
  showCount?: { current: number; total: number };
  color?: string;
}

const FILL = '█';
const EMPTY = '░';

export function ProgressBar({
  value,
  width = 28,
  label,
  showCount,
  color = palette.brand,
}: ProgressBarProps) {
  const pct = Math.min(Math.max(value, 0), 100);
  const filled = Math.round((width * pct) / 100);
  const empty = width - filled;

  return (
    <Box>
      {label && (
        <Box marginRight={2} minWidth={16}>
          <Text color={palette.dim}>{label}</Text>
        </Box>
      )}
      <Text color={color}>{FILL.repeat(filled)}</Text>
      <Text color={palette.muted}>{EMPTY.repeat(empty)}</Text>
      <Box marginLeft={1}>
        <Text color={palette.text} bold>{Math.round(pct)}%</Text>
        {showCount && (
          <Text color={palette.dim}> ({showCount.current}/{showCount.total})</Text>
        )}
      </Box>
    </Box>
  );
}
