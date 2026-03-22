import React from "react";
import { Box, Text, Newline } from "ink";
import { theme } from "../theme.js";
import { StatusLine } from "./common/StatusLine.js";
import { ResultsTable } from "./common/ResultsTable.js";

interface SuggestViewProps {
  status: "detecting" | "analyzing" | "matching" | "ranking" | "done" | "error";
  changedFiles: string[];
  results: Array<{
    testFile: string;
    confidence: number;
    reason: string;
    matchedKeywords: string[];
  }>;
  error?: string;
}

export function SuggestView({ status, changedFiles, results, error }: SuggestViewProps) {
  const getDetail = () => {
    switch (status) {
      case "detecting":
        return "Analyzing current git changes...";
      case "analyzing":
        return "Analyzing changed files with AST/LLM...";
      case "matching":
        return "Matching files against indexed tests...";
      case "ranking":
        return "Ranking test suggestions by relevance...";
      case "done":
        return "Analysis complete.";
      case "error":
        return "Process encountered an error.";
      default:
        return undefined;
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>{theme.header("🔍 Test Suggestions")}</Text>
      <Newline />

      <Box flexDirection="column" marginBottom={1}>
        <StatusLine
          status={status === "done" ? "success" : status === "error" ? "error" : "loading"}
          message={`Phase: ${status}`}
          detail={getDetail()}
        />
      </Box>

      {/* RENDER TABLE UNCONDITIONALLY */}
      <ResultsTable results={results} />

      {changedFiles.length > 0 && (
        <Box
          flexDirection="column"
          marginBottom={1}
          borderStyle="single"
          borderColor={theme.dim.toString()}
          paddingX={1}
        >
          <Text bold color={theme.secondary.toString()}>
            Changes Detected:
          </Text>
          {changedFiles.map((file, i) => (
            <Text key={i} color={theme.dim.toString()}>
              {" "}
              {theme.icons.bullet} {file}
            </Text>
          ))}
        </Box>
      )}

      {status === "done" && changedFiles.length === 0 && (
        <Box marginTop={1}>
          <Text color={theme.dim.toString()}>No file changes detected since last index.</Text>
        </Box>
      )}

      {error && (
        <Box marginTop={1}>
          <Text color={theme.error.toString()} bold>
            {theme.icons.error} Error:{" "}
          </Text>
          <Text color={theme.error.toString()}>{error}</Text>
        </Box>
      )}
    </Box>
  );
}
