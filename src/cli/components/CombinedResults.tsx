import { Box, Text } from 'ink';
import React from 'react';

import { palette } from '@/cli/theme';
import { EConfidenceLevel } from '@/utils/enums';

import {
  BADGE_COLOR,
  BAND_RANK,
  IResultEntry,
  TFlatTest,
  flattenAndSort,
  formatElapsed,
  summarizeRerank,
} from './results-shared';
import { SectionDivider } from './SectionDivider';

interface Props {
  results: IResultEntry[];
  maxResults: number;
  elapsedMs?: number;
}

// Dedup tests across source files — keep the highest band anywhere; break
// ties by score.
function dedupByTest(flat: TFlatTest[]): TFlatTest[] {
  const byTest = new Map<string, TFlatTest>();
  for (const item of flat) {
    const prev = byTest.get(item.testFile);
    if (!prev) {
      byTest.set(item.testFile, item);
      continue;
    }
    const prevRank = BAND_RANK[prev.confidence] ?? 0;
    const curRank = BAND_RANK[item.confidence] ?? 0;
    if (curRank > prevRank || (curRank === prevRank && item.score > prev.score)) {
      byTest.set(item.testFile, item);
    }
  }
  return Array.from(byTest.values()).sort((a, b) => {
    const br = (BAND_RANK[b.confidence] ?? 0) - (BAND_RANK[a.confidence] ?? 0);
    return br !== 0 ? br : b.score - a.score;
  });
}

const BAND_META: Record<EConfidenceLevel, { label: string; icon: string }> = {
  [EConfidenceLevel.HIGH]: { label: 'MUST RUN', icon: '▲' },
  [EConfidenceLevel.MEDIUM]: { label: 'SHOULD CHECK', icon: '●' },
  [EConfidenceLevel.LOW]: { label: 'GOOD TO HAVE', icon: '○' },
};

const PATH_WIDTH = 58;

function trimPath(full: string, width: number): string {
  const norm = full.replace(/\\/g, '/').replace(/^\.\//, '');
  if (norm.length <= width) return norm;
  const parts = norm.split('/');
  const tail = parts.slice(-2).join('/');
  return tail.length < width - 2 ? `…/${tail}` : `…${tail.slice(-(width - 1))}`;
}

interface BandSectionProps {
  band: EConfidenceLevel;
  tests: TFlatTest[];
  startIndex: number;
}

function BandSection({ band, tests, startIndex }: BandSectionProps) {
  if (tests.length === 0) return null;
  const meta = BAND_META[band];
  const color = BADGE_COLOR[band] ?? palette.dim;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={color} bold>
          {'  '}
          {meta.icon} {meta.label}
        </Text>
        <Text color={palette.muted}>
          {'  '}·{'  '}
          {tests.length}
        </Text>
      </Box>
      {tests.map((t, i) => {
        const idx = String(startIndex + i + 1).padStart(2, ' ');
        return (
          <Box key={t.testFile}>
            <Box width={7} flexShrink={0}>
              <Text color={palette.muted}>{`   ${idx}  `}</Text>
            </Box>
            <Box width={PATH_WIDTH + 2} flexShrink={0}>
              <Text color={color}>{trimPath(t.testFile, PATH_WIDTH)}</Text>
            </Box>
            <Box flexShrink={0}>
              <Text color={palette.dim}>{t.score.toFixed(2)}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export function CombinedResults({ results, elapsedMs }: Props) {
  // Combined view shows every unique test — no cap. maxResults only applies
  // to the expanded (per-file) view where same test can repeat across sources
  // and the list can balloon.
  const flat = flattenAndSort(results, Number.POSITIVE_INFINITY);
  const deduped = dedupByTest(flat);
  const { totalPreRerank, totalPostRerank, rerankActive } = summarizeRerank(results);

  const high = deduped.filter((t) => t.confidence === EConfidenceLevel.HIGH);
  const med = deduped.filter((t) => t.confidence === EConfidenceLevel.MEDIUM);
  const low = deduped.filter((t) => t.confidence === EConfidenceLevel.LOW);

  return (
    <>
      <SectionDivider />
      <Box marginTop={1} paddingLeft={2} justifyContent="space-between">
        <Box>
          <Text color={palette.brand} bold>
            {'◆  '}
          </Text>
          <Text color={palette.text} bold>
            {deduped.length}
          </Text>
          <Text color={palette.sub}> test{deduped.length !== 1 ? 's' : ''} to run</Text>
          <Text color={palette.muted}>
            {'  ·  '}across {results.length} changed {results.length === 1 ? 'file' : 'files'}
          </Text>
        </Box>
        {elapsedMs != null && <Text color={palette.muted}>{formatElapsed(elapsedMs)}</Text>}
      </Box>

      <BandSection band={EConfidenceLevel.HIGH} tests={high} startIndex={0} />
      <BandSection band={EConfidenceLevel.MEDIUM} tests={med} startIndex={high.length} />
      <BandSection band={EConfidenceLevel.LOW} tests={low} startIndex={high.length + med.length} />

      <Box marginTop={1}>
        <SectionDivider />
      </Box>
      {rerankActive && (
        <Box paddingLeft={2}>
          <Text color={palette.muted}>
            {totalPreRerank} scored · {totalPostRerank} kept by rerank · {deduped.length} unique
          </Text>
        </Box>
      )}
    </>
  );
}
