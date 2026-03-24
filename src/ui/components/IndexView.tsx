import React from "react";
import { Box, Text, Newline } from "ink";
import { theme } from "../theme.js";
import { ProgressBar } from "./common/ProgressBar.js";

interface IndexViewProps {
  status: "scanning" | "analyzing" | "saving" | "done" | "error";
  totalFiles: number;
  processedFiles: number;
  currentFile?: string;
  thoughtOutput?: string;
  newFiles: number;
  updatedFiles: number;
  error?: string;
}

export function IndexView({
  status,
  totalFiles,
  processedFiles,
  currentFile,
  thoughtOutput,
  newFiles,
  updatedFiles,
  error
}: IndexViewProps) {
  const percent = totalFiles > 0 ? (processedFiles / totalFiles) * 100 : 0;

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>{theme.header("📇 Indexing Files")}</Text>
      <Newline />

      <Box flexDirection="column" marginBottom={1}>
        <Box marginBottom={1}>
          <Text>
            {status === "done" ? "✅ Indexing complete" : `🚀 Status: ${status}...`}
          </Text>
        </Box>

        <ProgressBar
          value={percent}
          label="Overall Progress"
          width={40}
        />

        {currentFile && status !== "done" && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Analyzing: {currentFile}</Text>
            {thoughtOutput && (
                <Box marginTop={1} borderStyle="single" borderColor="dim">
                    <Text dimColor>{thoughtOutput.slice(-500)}</Text>
                </Box>
            )}
          </Box>
        )}
      </Box>

      {status === "done" && (
        <Box borderStyle="double" borderColor={theme.success.toString()} paddingX={2} flexDirection="column" marginTop={1}>
          <Box>
            <Text color={theme.success.toString()} bold>{theme.icons.success} Indexing Summary</Text>
          </Box>
          <Box marginLeft={2}>
            <Text>New files:     </Text>
            <Text color={theme.success.toString()}>{newFiles}</Text>
          </Box>
          <Box marginLeft={2}>
            <Text>Updated files: </Text>
            <Text color={theme.warning.toString()}>{updatedFiles}</Text>
          </Box>
          <Box marginLeft={2}>
            <Text>Total indexed: </Text>
            <Text bold>{totalFiles}</Text>
          </Box>
        </Box>
      )}

      {error && (
        <Box marginTop={1}>
          <Text color={theme.error.toString()} bold>{theme.icons.error} Error: </Text>
          <Text color={theme.error.toString()}>{error}</Text>
        </Box>
      )}
    </Box>
  );
}
