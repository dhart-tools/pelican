import { Box, Text } from "ink";
import React from "react";

import { palette } from "@/cli/theme";
import { EConfidenceLevel } from "@/utils/enums";

import { SectionDivider } from "./SectionDivider";
import { SignalBadge } from "./SignalBadge";
import {
  BADGE_COLOR,
  BAND_ORDER,
  DOT_COLOR,
  IResultEntry,
  TFlatTest,
  flattenAndSort,
  formatElapsed,
  shortPath,
  summarizeRerank,
} from "./results-shared";

const DESC_WIDTH = 68;

interface Props {
  results: IResultEntry[];
  maxResults: number;
  elapsedMs?: number;
}

function wordWrap(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (current.length + 1 + word.length <= maxWidth) current += " " + word;
    else {
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
  return words
    .map((w, i) => (i < gaps ? w + " ".repeat(base + (i < extra ? 1 : 0)) : w))
    .join("");
}

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

      {!isLast && hasExplanation && (
        <Box>
          <Text color={palette.muted}>{"│"}</Text>
        </Box>
      )}
    </Box>
  );
}

export function ExpandedResults({ results, maxResults, elapsedMs }: Props) {
  const flat = flattenAndSort(results, maxResults);
  const grouped = new Map<string, TFlatTest[]>();
  for (const item of flat) {
    const group = grouped.get(item.changedFile) ?? [];
    group.push(item);
    grouped.set(item.changedFile, group);
  }

  const totalSuggestions = flat.length;
  const { totalCandidates, totalPreRerank, totalPostRerank, rerankActive } =
    summarizeRerank(results);

  return (
    <>
      {Array.from(grouped.entries()).map(([changedFile, tests]) => (
        <Box key={changedFile} flexDirection="column" marginBottom={1}>
          <SectionDivider />

          <Box marginTop={1}>
            <Text color={palette.brand}>{"  ◆ "}</Text>
            <Text color={palette.cyan} bold>
              {changedFile}
            </Text>
          </Box>

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
            <Text color={palette.dim}>
              {" "}
              suggestion{totalSuggestions !== 1 ? "s" : ""}
            </Text>
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
