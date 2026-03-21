import React from "react";
import { Box, Text, Newline } from "ink";
import { theme } from "../theme.js";
import { StatusLine } from "./common/StatusLine.js";
import { ProgressBar } from "./common/ProgressBar.js";

interface SetupViewProps {
  steps: Array<{
    name: string;
    status: "loading" | "success" | "error" | "idle";
    detail?: string;
  }>;
  pullProgress?: {
    status: string;
    completed?: number;
    total?: number;
  };
}

export function SetupView({ steps, pullProgress }: SetupViewProps) {
  const isDone = steps.every(s => s.status === "success");

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>{theme.header("🔧 Suggestor Setup")}</Text>
      <Newline />

      {steps.map((step, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <StatusLine
            status={step.status}
            message={step.name}
            detail={step.detail}
          />
          {step.name === "Pulling model" && step.status === "loading" && pullProgress && (
            <Box marginLeft={4} marginTop={1}>
              <ProgressBar
                value={pullProgress.total ? (pullProgress.completed! / pullProgress.total!) * 100 : 0}
                total={pullProgress.total ? pullProgress.total / (1024 * 1024 * 1024) : undefined}
                label={pullProgress.status}
                width={30}
              />
            </Box>
          )}
        </Box>
      ))}

      {isDone && (
        <Box marginTop={1} borderStyle="round" borderColor={theme.success.toString()} paddingX={2}>
          <Text color={theme.success.toString()} bold>
            {theme.icons.success} Setup complete!
          </Text>
          <Text> You can now run </Text>
          <Text color={theme.primary.toString()} bold>suggestor index</Text>
          <Text> to build your agent map.</Text>
        </Box>
      )}
    </Box>
  );
}
