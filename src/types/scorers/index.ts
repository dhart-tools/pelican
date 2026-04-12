import { ISignal } from '@/types/analyzers';
import { ISuggestorConfig } from '@/types/config';
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
}

export interface IScoreResult {
  testFile: string;
  score: number;
  signals: ISignal[];
  confidence: EConfidenceLevel;
  explanation: string;
}

export interface IScorerConfig {
  name: string;
  version: string;
  description: string;
  type: string;
  weight: number;
}
