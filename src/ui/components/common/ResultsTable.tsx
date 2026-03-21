import React from "react";
import { Box, Text } from "ink";
import { theme } from "../../theme.js";

interface ResultsTableProps {
  results: Array<{
    testFile: string;
    confidence: number;
    reason: string;
    matchedKeywords: string[];
  }>;
  title?: string;
}

export function ResultsTable({ results, title = "Suggested Tests" }: ResultsTableProps) {
  if (results.length === 0) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.dim.toString()}>No relevant tests found.</Text>
      </Box>
    );
  }

  // Simple table-like layout using Box and Text
  // Columns: Test File (flex), Confidence (fixed), Reason (flex)
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.primary.toString()} paddingX={2}>
      <Box marginBottom={1}>
        <Text bold color={theme.primary.toString()}>{title}</Text>
      </Box>

      <Box flexDirection="row" borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} marginBottom={1}>
        <Box width="40%">
          <Text bold>Test File</Text>
        </Box>
        <Box width="15%">
          <Text bold>Conf.</Text>
        </Box>
        <Box width="45%">
          <Text bold>Reason</Text>
        </Box>
      </Box>

      {results.map((result, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row">
            <Box width="40%">
              <Text color={theme.fileName.toString().split(".")[0]}>{result.testFile}</Text>
            </Box>
            <Box width="15%">
              <Text color={theme.score(result.confidence).toString()}>[{result.confidence.toFixed(2)}]</Text>
            </Box>
            <Box width="45%">
              <Text wrap="truncate-end">{result.reason}</Text>
            </Box>
          </Box>
          {result.matchedKeywords.length > 0 && (
            <Box marginLeft={2} marginTop={0}>
              <Text dimColor>
                Keywords: {result.matchedKeywords.map(k => `[${k}]`).join(" ")}
              </Text>
            </Box>
          )}
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>Found {results.length} relevant test files</Text>
      </Box>
    </Box>
  );
}
