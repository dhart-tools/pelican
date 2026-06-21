import { ISignal } from '@/types/analyzers';
import { ISuggestorConfig } from '@/types/config';
import { IRepoGitHistory } from '@/types/git';
import { IRegistry, IFileEntry } from '@/types/registry';
import { EConfidenceLevel } from '@/utils/enums';

/**
 * Defines the contract for a scorer module.
 */
export interface IScorer {
  name: string;
  version: string;
  description: string;
  type: string;
  weight: number;
  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[];
}

export interface IScorerContext {
  registry: IRegistry;
  config: ISuggestorConfig;
  changedFile: IFileEntry;
  testFile: IFileEntry;
  /** Per-repo git history, keyed by absolute repo root (path.resolve'd). Mined
   * once and shared across all pairs. Absent when git history wasn't gathered
   * (e.g. cache-only runs) — temporal scorer no-ops, keeping it recall-safe. */
  gitHistories?: Map<string, IRepoGitHistory>;
}

export interface IScoreResult {
  testFile: string;
  score: number;
  signals: ISignal[];
  confidence: EConfidenceLevel;
  /** Human-readable reason. Populated by LLM reranker or pelican scoring engine. */
  explanation: string;
  /** True when this result came from the .pelican.lock cache (no LLM call this run). */
  fromCache?: boolean;
}

export interface IScorerConfig {
  name: string;
  version: string;
  description: string;
  type: string;
  weight: number;
}
