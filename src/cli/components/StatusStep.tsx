import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { palette } from '../theme';

interface StatusStepProps {
  status: 'idle' | 'loading' | 'success' | 'error';
  label: string;
  detail?: string;
}

const LABEL_WIDTH = 22;

export function StatusStep({ status, label, detail }: StatusStepProps) {
  let icon: React.ReactNode;
  let iconColor: string;
  let labelColor: string;

  switch (status) {
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
      icon = <Text>✘</Text>;
      iconColor = palette.rose;
      labelColor = palette.rose;
      break;
    case 'idle':
    default:
      icon = <Text>○</Text>;
      iconColor = palette.muted;
      labelColor = palette.dim;
      break;
  }

  const paddedLabel = label.padEnd(LABEL_WIDTH);

  return (
    <Box paddingX={2}>
      <Text color={iconColor}>{icon}</Text>
      <Text>{'  '}</Text>
      <Text color={labelColor}>{paddedLabel}</Text>
      {detail && (
        <Text color={palette.dim}>{detail}</Text>
      )}
    </Box>
  );
}
