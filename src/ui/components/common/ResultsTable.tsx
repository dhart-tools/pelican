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
  return (
    <Box flexDirection="column" marginTop={1} padding={1}>
      <Text bold color="green">Found {results.length} tests:</Text>
      {results.map((r, i) => (
        <Text key={i}>- {r.testFile} ({r.confidence.toFixed(2)})</Text>
      ))}
    </Box>
  );
}
