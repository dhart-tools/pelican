/**
 * Represents a signal contributed by an analyzer to the scoring engine.
 * Signals are used to determine the relevance of tests to changed code.
 *
 * @example
 * {
 *   source: "redux-chain",
 *   type: "action-match",
 *   weight: 0.8,
 *   matched: true,
 *   metadata: { action: "USER_LOGIN" }
 * }
 */
export interface ISignal {
  source: string; // Analyzer name
  type: string; // Signal type
  weight: number; // Confidence weight (0-1)
  matched: boolean;
  metadata?: object; // Additional metadata
}

/**
 * Defines the contract for an analyzer module.
 * Analyzers are responsible for extracting semantic information from source code
 * and generating signals for the scoring engine.
 *
 * @template TInput The type of input data the analyzer processes (e.g., file path, AST)
 * @template TOutput The type of structured data the analyzer extracts
 *
 * @example
 * class SourceAnalyzer implements IAnalyzer<string, IASTResult> {
 *   name = "source-extractor";
 *   version = "1.0.0";
 *   dependencies = [];
 *   async extract(path: string): Promise<IASTResult> { ... }
 *   index(data: IASTResult): void { ... }
 * }
 */
export interface IAnalyzer<TInput, TOutput> {
  name: string; // Unique analyzer identifier
  version: string; // Semantic version
  dependencies: string[]; // Required analyzers

  index(output: TOutput): void;
  extract(input: TInput): Promise<TOutput>;
}
