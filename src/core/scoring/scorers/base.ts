import { IScorer, IScorerContext, ISignal, IScorerConfig } from '@/types';

/**
 * BaseScorer provides a reusable implementation of IScorer.
 * Concrete scorers extend this class and implement `evaluate()`.
 */
export abstract class BaseScorer implements IScorer {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly type: string;
  readonly weight: number;

  constructor(config: IScorerConfig) {
    this.name = config.name;
    this.version = config.version;
    this.description = config.description;
    this.type = config.type;
    this.weight = config.weight;
  }

  abstract evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[];

  /**
   * Helper that creates a signal using this scorer's metadata.
   *
   * @param matched  - Whether this signal was positively detected
   * @param reason   - Human-readable reason string shown in CLI output
   * @param metadata - Optional structured metadata for debugging
   */
  protected createSignal(matched: boolean, reason?: string, metadata?: object): ISignal {
    const effectiveWeight =
      (this as unknown as { __effectiveWeight?: number }).__effectiveWeight ?? this.weight;
    return {
      source: this.name,
      type: this.type,
      weight: effectiveWeight,
      matched,
      metadata,
      reason,
    };
  }
}
