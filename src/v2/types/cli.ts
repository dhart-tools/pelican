import { IScoreResult } from './scorers';

/**
 * Represents the final aggregated suggestions for a single changed file.
 */
export interface ISuggestionResult {
  /** The path of the source file that was changed */
  changedFile: string;
  /** List of relevant tests with their scores and explanations */
  relevantTests: IScoreResult[];
}
