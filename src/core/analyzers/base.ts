import { IAnalyzer } from '@/types/analyzers';

/**
 * Base class for all analyzer modules.
 */
export abstract class BaseAnalyzer<TInput, TOutput> implements IAnalyzer<TInput, TOutput> {
  abstract name: string;
  abstract version: string;
  dependencies: string[] = [];

  abstract index(output: TOutput): void;
  abstract extract(input: TInput): Promise<TOutput>;
}
