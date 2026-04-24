import { IScoreResult } from '@/types/scorers';
import { EConfidenceLevel } from '@/utils/enums';

export interface IResultEntry {
  changedFile: string;
  suggestedTests: IScoreResult[];
  totalCandidates?: number;
  preRerankCount?: number;
  postRerankCount?: number;
}

export type TFlatTest = IScoreResult & { changedFile: string };

export const BAND_ORDER: EConfidenceLevel[] = [
  EConfidenceLevel.HIGH,
  EConfidenceLevel.MEDIUM,
  EConfidenceLevel.LOW,
];

export const BAND_RANK: Record<EConfidenceLevel, number> = {
  [EConfidenceLevel.HIGH]: 2,
  [EConfidenceLevel.MEDIUM]: 1,
  [EConfidenceLevel.LOW]: 0,
};

export const DOT_COLOR: Record<EConfidenceLevel, string> = {
  [EConfidenceLevel.HIGH]: '#34D399',
  [EConfidenceLevel.MEDIUM]: '#FBBF24',
  [EConfidenceLevel.LOW]: '#6B7280',
};

export const BADGE_COLOR: Record<EConfidenceLevel, string> = {
  [EConfidenceLevel.HIGH]: '#059669',
  [EConfidenceLevel.MEDIUM]: '#D97706',
  [EConfidenceLevel.LOW]: '#4B5563',
};

export function shortPath(full: string): string {
  const parts = full.replace(/\\/g, '/').split('/');
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : full;
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}

export function flattenAndSort(results: IResultEntry[], maxResults: number): TFlatTest[] {
  return results
    .flatMap((r) => r.suggestedTests.map((t) => ({ changedFile: r.changedFile, ...t })))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

export function summarizeRerank(results: IResultEntry[]): {
  totalCandidates: number;
  totalPreRerank: number;
  totalPostRerank: number;
  rerankActive: boolean;
} {
  const totalCandidates = results.reduce(
    (n, r) => n + (r.totalCandidates ?? r.suggestedTests.length),
    0,
  );
  const totalPreRerank = results.reduce((n, r) => n + (r.preRerankCount ?? 0), 0);
  const totalPostRerank = results.reduce((n, r) => n + (r.postRerankCount ?? 0), 0);
  return {
    totalCandidates,
    totalPreRerank,
    totalPostRerank,
    rerankActive: totalPreRerank > 0 && totalPreRerank !== totalPostRerank,
  };
}
