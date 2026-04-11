import React from 'react';
import { Box, Text } from 'ink';
import { palette } from '../theme';

interface HeaderProps {
  icon: string;
  title: string;
  subtitle?: string;
}

/**
 * Brand header row — used as the first section inside a Panel.
 * Does NOT render its own border; the outer Panel provides that.
 */
export function Header({ icon, title, subtitle }: HeaderProps) {
  return (
    <Box justifyContent="space-between" marginBottom={0}>
      <Box>
        <Text color={palette.brand} bold>{icon}</Text>
        <Text>{'  '}</Text>
        <Text color={palette.text} bold>PELICAN</Text>
        <Text color={palette.dim}>{'  ·  '}</Text>
        <Text color={palette.sub}>{title}</Text>
      </Box>
      {subtitle && (
        <Text color={palette.dim}>{subtitle}</Text>
      )}
    </Box>
  );
}
