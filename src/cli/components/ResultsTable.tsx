import { Box, Text } from "ink";
import React from "react";

import { palette } from "@/cli/theme";
import { IScoreResult } from "@/types/scorers";
import { EConfidenceLevel } from "@/utils/enums";

import { SectionDivider } from "./SectionDivider";
import { SignalBadge } from "./SignalBadge";

const BAND_ORDER: EConfidenceLevel[] = [
  EConfidenceLevel.HIGH,
  EConfidenceLevel.MEDIUM,
  EConfidenceLevel.LOW,
];

interface ResultsTableProps {
  results: Array<{
    changedFile: string;
    suggestedTests: IScoreResult[];
    totalCandidates?: number;
    preRerankCount?: number;
    postRerankCount?: number;
  }>;
  maxResults?: number;
  elapsedMs?: number;
}

const DESC_WIDTH = 68;

function shortPath(full: string): string {
  const parts = full.replace(/\\/g, "/").split("/");
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : full;
}

function wordWrap(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function justifyLine(line: string, width: number, isLast: boolean): string {
  if (isLast) return line;
  const words = line.split(" ");
  if (words.length === 1) return line;
  const totalChars = words.reduce((n, w) => n + w.length, 0);
  const totalSpaces = width - totalChars;
  const gaps = words.length - 1;
  const base = Math.floor(totalSpaces / gaps);
  const extra = totalSpaces % gaps;
  return words.map((w, i) => (i < gaps ? w + " ".repeat(base + (i < extra ? 1 : 0)) : w)).join("");
}

const DOT_COLOR: Record<EConfidenceLevel, string> = {
  [EConfidenceLevel.HIGH]: "#34D399",
  [EConfidenceLevel.MEDIUM]: "#FBBF24",
  [EConfidenceLevel.LOW]: "#6B7280",
};

const BADGE_COLOR: Record<EConfidenceLevel, string> = {
  [EConfidenceLevel.HIGH]: "#059669", // emerald — matches badge bg
  [EConfidenceLevel.MEDIUM]: "#D97706", // amber
  [EConfidenceLevel.LOW]: "#4B5563", // gray
};

interface TestRowProps {
  testFile: string;
  confidence: EConfidenceLevel;
  explanation: string;
  fromCache?: boolean;
  isLast: boolean;
}

function TestRow({ testFile, confidence, explanation, fromCache, isLast }: TestRowProps) {
  const dotColor = DOT_COLOR[confidence] ?? palette.dim;
  const cleanExplanation =
    explanation && explanation.trim() !== "No reason provided." ? explanation : "";
  const lines = cleanExplanation ? wordWrap(cleanExplanation, DESC_WIDTH) : [];
  const hasExplanation = lines.length > 0;
  const branch = isLast ? "╰" : "├";
  const continuation = isLast ? " " : "│";

  return (
    <Box flexDirection="column">
      {/* Test file name row */}
      <Box justifyContent="space-between">
        <Box flexShrink={1}>
          <Text color={palette.muted}>
            {branch}
            {"─ "}
          </Text>
          <Text color={dotColor}>● </Text>
          <Text color={BADGE_COLOR[confidence] ?? palette.dim} bold>
            {shortPath(testFile)}
          </Text>
          {fromCache && <Text color={palette.muted}> ↩ cached</Text>}
        </Box>
      </Box>

      {/* Explanation lines — connected to tree */}
      {hasExplanation && (
        <Box flexDirection="column">
          {lines.map((line, i) => (
            <Box key={i}>
              <Text color={palette.muted}>
                {continuation}
                {"  "}
              </Text>
              <Text color={palette.dim}>
                {"  "}
                {justifyLine(line, DESC_WIDTH, i === lines.length - 1)}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Spacing between entries only when explanations are present.
          Without explanations rows sit flush for a compact file list. */}
      {!isLast && hasExplanation && (
        <Box>
          <Text color={palette.muted}>{"│"}</Text>
        </Box>
      )}
    </Box>
  );
}

function formatElapsed(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}

export function ResultsTable({ results, maxResults = 10, elapsedMs }: ResultsTableProps) {
  if (results.length === 0) {
    return (
      <>
        <SectionDivider />
        <Text color={palette.dim}>No test suggestions found for the changed files.</Text>
      </>
    );
  }

  const flat = results
    .flatMap((r) => r.suggestedTests.map((t) => ({ changedFile: r.changedFile, ...t })))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  const grouped = new Map<string, typeof flat>();
  for (const item of flat) {
    const group = grouped.get(item.changedFile) ?? [];
    group.push(item);
    grouped.set(item.changedFile, group);
  }

  const totalSuggestions = flat.length;
  const totalCandidates = results.reduce(
    (n, r) => n + (r.totalCandidates ?? r.suggestedTests.length),
    0,
  );
  const totalPreRerank = results.reduce((n, r) => n + (r.preRerankCount ?? 0), 0);
  const totalPostRerank = results.reduce((n, r) => n + (r.postRerankCount ?? 0), 0);
  const rerankActive = totalPreRerank > 0 && totalPreRerank !== totalPostRerank;

  return (
    <>
      {Array.from(grouped.entries()).map(([changedFile, tests]) => (
        <Box key={changedFile} flexDirection="column" marginBottom={1}>
          <SectionDivider />

          {/* Source file header */}
          <Box marginTop={1}>
            <Text color={palette.brand}>{"  ◆ "}</Text>
            <Text color={palette.cyan} bold>
              {changedFile}
            </Text>
          </Box>

          {/* Tests grouped by confidence band — badge shown once per band. */}
          <Box flexDirection="column" paddingLeft={3}>
            {BAND_ORDER.map((band) => {
              const bandTests = tests.filter((t) => t.confidence === band);
              if (bandTests.length === 0) return null;
              return (
                <Box key={band} flexDirection="column" marginTop={1}>
                  <Box justifyContent="space-between">
                    <Text color={palette.dim}>
                      {bandTests.length} {bandTests.length === 1 ? "test" : "tests"}
                    </Text>
                    <Box flexShrink={0}>
                      <SignalBadge confidence={band} />
                    </Box>
                  </Box>
                  {bandTests.map((t, i) => (
                    <TestRow
                      key={t.testFile}
                      testFile={t.testFile}
                      confidence={t.confidence}
                      explanation={t.explanation}
                      fromCache={t.fromCache}
                      isLast={i === bandTests.length - 1}
                    />
                  ))}
                </Box>
              );
            })}
          </Box>
        </Box>
      ))}

      <SectionDivider />
      <Box marginTop={0} justifyContent="space-between">
        <Box>
          <Text color={palette.text} bold>
            {totalSuggestions}
          </Text>
          {totalSuggestions < totalCandidates ? (
            <Text color={palette.dim}> of {totalCandidates} suggestions</Text>
          ) : (
            <Text color={palette.dim}> suggestion{totalSuggestions !== 1 ? "s" : ""}</Text>
          )}
          {rerankActive && (
            <>
              <Text color={palette.muted}> · </Text>
              <Text color={palette.dim}>
                filtered {totalPreRerank} → {totalPostRerank}
              </Text>
            </>
          )}
        </Box>
        {elapsedMs != null && (
          <Text color={palette.muted}>
            Suggested in{" "}
            <Text color={palette.text} bold>
              {formatElapsed(elapsedMs)}
            </Text>
          </Text>
        )}
      </Box>
    </>
  );
}
