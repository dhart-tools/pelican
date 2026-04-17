import { Text } from "ink";
import React from "react";

import { palette } from "@/cli/theme";

import { CombinedResults } from "./CombinedResults";
import { ExpandedResults } from "./ExpandedResults";
import { SectionDivider } from "./SectionDivider";
import { IResultEntry } from "./results-shared";

interface ResultsTableProps {
  results: IResultEntry[];
  maxResults?: number;
  elapsedMs?: number;
  /** When true, show per-source-file sections. Default (false) = dedup'd combined list. */
  expanded?: boolean;
}

export function ResultsTable({
  results,
  maxResults = 10,
  elapsedMs,
  expanded = false,
}: ResultsTableProps) {
  if (results.length === 0) {
    return (
      <>
        <SectionDivider />
        <Text color={palette.dim}>No test suggestions found for the changed files.</Text>
      </>
    );
  }

  return expanded ? (
    <ExpandedResults results={results} maxResults={maxResults} elapsedMs={elapsedMs} />
  ) : (
    <CombinedResults results={results} maxResults={maxResults} elapsedMs={elapsedMs} />
  );
}
