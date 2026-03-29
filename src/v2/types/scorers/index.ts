import { ISignal } from "@v2/types/analyzers";
import { IRegistry, IFileEntry } from "@v2/types/registry";
import { ISuggestorConfig } from "@v2/types/config";

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
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
}
