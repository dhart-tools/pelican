import React from "react";
import { Box, Text } from "ink";
import { theme } from "../../theme.js";

interface ProgressBarProps {
  value: number;      // 0-100
  total?: number;     // Optional total for "X/Y" display
  label?: string;     // Label text
  width?: number;     // Bar width in chars, default 20
}

export function ProgressBar({ value, total, label, width = 20 }: ProgressBarProps) {
  const percent = Math.min(Math.max(value, 0), 100);
  const filledWidth = Math.round((width * percent) / 100);
  const emptyWidth = width - filledWidth;

  const filledBar = "▓".repeat(filledWidth);
  const emptyBar = "░".repeat(emptyWidth);

  return (
    <Box flexDirection="row">
      {label && (
        <Box marginRight={2}>
          <Text>{label}</Text>
        </Box>
      )}
      <Text color={theme.primary.toString()}>
        {filledBar}
      </Text>
      <Text color={theme.dim.toString()}>
        {emptyBar}
      </Text>
      <Box marginLeft={2}>
        <Text bold>{Math.round(percent)}%</Text>
        {total && (
          <Text dimColor> ({value.toFixed(1)}/{total.toFixed(1)})</Text>
        )}
      </Box>
    </Box>
  );
}
