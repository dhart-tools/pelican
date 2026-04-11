import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { palette } from '../theme';

interface SectionDividerProps {
  label?: string;
}

const MAX_PANEL_WIDTH = 96;

/**
 * Horizontal rule for use inside a Panel.
 * Matches the inner width of Panel (same formula).
 *
 * Without label:
 *   ─────────────────────────────────────
 *
 * With label:
 *   ── src/components/auth/LoginForm.tsx ─────────────
 */
export function SectionDivider({ label }: SectionDividerProps) {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  // Must match Panel: panelWidth = min(cols-4, 96), innerWidth = panelWidth - 4
  const panelWidth = Math.min(cols - 4, MAX_PANEL_WIDTH);
  const innerWidth = Math.max(panelWidth - 4, 10);

  if (!label) {
    return (
      <Box>
        <Text color={palette.borderSub}>{'─'.repeat(innerWidth)}</Text>
      </Box>
    );
  }

  const labelStr = `  ${label}  `;
  const dashes = Math.max(innerWidth - labelStr.length - 2, 0);

  return (
    <Box>
      <Text color={palette.borderSub}>{'──'}</Text>
      <Text color={palette.sub} bold>{labelStr}</Text>
      <Text color={palette.borderSub}>{'─'.repeat(dashes)}</Text>
    </Box>
  );
}
