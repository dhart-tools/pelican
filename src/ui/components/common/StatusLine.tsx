import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { theme } from "../../theme.js";

interface StatusLineProps {
  status: "loading" | "success" | "error" | "warning" | "idle";
  message: string;
  detail?: string;    // Dimmed secondary text
}

export function StatusLine({ status, message, detail }: StatusLineProps) {
  let icon: React.ReactNode;
  let color: string = "";

  switch (status) {
    case "loading":
      icon = <Text color={theme.primary.toString()}><Spinner type="dots" /></Text>;
      break;
    case "success":
      icon = <Text color={theme.success.toString()}>{theme.icons.success}</Text>;
      break;
    case "error":
      icon = <Text color={theme.error.toString()}>{theme.icons.error}</Text>;
      break;
    case "warning":
      icon = <Text color={theme.warning.toString()}>{theme.icons.warning}</Text>;
      break;
    case "idle":
    default:
      icon = <Text color={theme.dim.toString()}>{theme.icons.circle}</Text>;
      break;
  }

  return (
    <Box flexDirection="row">
      <Box marginRight={2}>
        {icon}
      </Box>
      <Text>{message}</Text>
      {detail && (
        <Box marginLeft={1}>
          <Text color={theme.dim.toString()}>— {detail}</Text>
        </Box>
      )}
    </Box>
  );
}
