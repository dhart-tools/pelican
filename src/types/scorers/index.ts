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

/**
 * One reasoning bullet from the LLM rerank — ties a specific changed file to a
 * concrete way it could break (or fails to touch) this test. Rendered as a
 * dash-bulleted line: "<tag> · @<file> — <point>".
 */
export interface IReasonPoint {
  /** Short relationship label, e.g. "Direct Impact", "Could Regress", "Setup Only". */
  tag: string;
  /** Changed file the point refers to (basename; may be empty). */
  file: string;
  /** The concrete causal sentence (what changed → which test step it affects). */
  point: string;
}

export interface IScoreResult {
  testFile: string;
  score: number;
  signals: ISignal[];
  confidence: EConfidenceLevel;
  /** Human-readable reason. Populated by LLM reranker or pelican scoring engine. */
  explanation: string;
  /** Structured rerank reasoning — the model's bullet points. Rendered as the
   * reasoning lines in the results UI when present (richer than `explanation`). */
  reasonPoints?: IReasonPoint[];
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
