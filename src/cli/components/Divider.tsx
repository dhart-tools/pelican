import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { palette } from '../theme';

interface DividerProps {
  color?: string;
  paddingX?: number;
}

export function Divider({ color = palette.muted, paddingX = 1 }: DividerProps) {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const width = Math.max(Math.min(cols - paddingX * 2 - 2, 72), 20);

  return (
    <Box paddingX={paddingX}>
      <Text color={color}>{'─'.repeat(width)}</Text>
    </Box>
  );
}
