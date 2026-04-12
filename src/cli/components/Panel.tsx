import { Box, useStdout } from 'ink';
import React from 'react';

import { palette } from '@/cli/theme';

interface PanelProps {
  children: React.ReactNode;
  borderColor?: string;
}

const MAX_PANEL_WIDTH = 96;

/**
 * The single outer panel for an entire view.
 * All sections live inside with SectionDivider separating them.
 */
export function Panel({ children, borderColor = palette.border }: PanelProps) {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const panelWidth = Math.min(cols - 4, MAX_PANEL_WIDTH);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      marginX={1}
      marginY={1}
      width={panelWidth}
    >
      {children}
    </Box>
  );
}
