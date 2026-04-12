import React from 'react';
import { Box, Text } from 'ink';
import { palette, scorerBarColor } from '../theme';
import { SignalBadge } from './SignalBadge';
import { SectionDivider } from './SectionDivider';
import { IScoreResult } from '@/types/scorers';

interface ResultsTableProps {
  results: Array<{
    changedFile: string;
    suggestedTests: IScoreResult[];
  }>;
  maxResults?: number;
}

const BAR_WIDTH = 18;
const LABEL_WIDTH = 20;
const FILL = '█';
const EMPTY = '░';

function ScoreBar({ weight, confidence }: { weight: number; confidence: string }) {
  const filled = Math.round(weight * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const color = scorerBarColor(confidence);
  return (
    <Text>
      <Text color={color}>{FILL.repeat(filled)}</Text>
      <Text color={palette.barEmpty}>{EMPTY.repeat(empty)}</Text>
    </Text>
  );
}

function shortPath(full: string): string {
  const parts = full.replace(/\\/g, '/').split('/');
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : full;
}

interface ResultRowProps {
  testFile: string;
  score: number;
  confidence: string;
  signals: IScoreResult['signals'];
}

function ResultRow({ testFile, score, confidence, signals }: ResultRowProps) {
  const matched = signals.filter((s) => s.matched && s.weight > 0);
  const dotColor = confidence === 'high'
    ? palette.emerald
    : confidence === 'medium'
    ? palette.amber
    : palette.rose;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box justifyContent="space-between">
        <Box>
          <Text color={dotColor} bold>●  </Text>
          <Text color={palette.cyan} bold>{shortPath(testFile)}</Text>
        </Box>
        <Box marginLeft={2}>
          <SignalBadge confidence={confidence as never} score={score} />
        </Box>
      </Box>

      {matched.length > 0 && (
        <Box flexDirection="column" paddingLeft={3}>
          {matched.map((sig, i) => {
            const isLast = i === matched.length - 1;
            const tree = isLast ? '└─' : '├─';
            const label = sig.source.padEnd(LABEL_WIDTH);
            return (
              <Box key={i}>
                <Text color={palette.muted}>{tree} </Text>
                <Text color={palette.dim}>{label}  </Text>
                <ScoreBar weight={sig.weight} confidence={confidence} />
                <Text color={palette.dim}>  {sig.weight.toFixed(2)}</Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

/**
 * Renders results as labeled sections within the parent Panel.
 * Each changed file gets a SectionDivider with its path as the label.
 */
export function ResultsTable({ results, maxResults = 10 }: ResultsTableProps) {
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

  const totalCandidates = results.reduce((n, r) => n + r.suggestedTests.length, 0);

  return (
    <>
      {Array.from(grouped.entries()).map(([changedFile, tests]) => (
        <Box key={changedFile} flexDirection="column">
          <SectionDivider label={changedFile} />
          <Box flexDirection="column" marginTop={1}>
            {tests.map((t) => (
              <ResultRow
                key={t.testFile}
                testFile={t.testFile}
                score={t.score}
                confidence={t.confidence}
                signals={t.signals}
              />
            ))}
          </Box>
        </Box>
      ))}

      <SectionDivider />
      <Box marginTop={0}>
        <Text color={palette.text} bold>{flat.length}</Text>
        {flat.length < totalCandidates
          ? <Text color={palette.dim}> of {totalCandidates} suggestions</Text>
          : <Text color={palette.dim}> suggestion{flat.length !== 1 ? 's' : ''}</Text>
        }
        <Text color={palette.muted}>   ·   </Text>
        <Text color={palette.dim}>sorted by confidence</Text>
      </Box>
    </>
  );
}
