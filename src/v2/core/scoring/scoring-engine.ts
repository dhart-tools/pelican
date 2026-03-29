import {
  ISignal,
  IScoreResult,
  IScorer,
  IScorerContext,
  IRegistry,
  ISuggestorConfig,
} from '@v2/types';
import { EConfidenceLevel } from '@v2/utils/enums';

export class ScoringEngine {
  private scorers: Map<string, IScorer> = new Map();
  private config: ISuggestorConfig;
  private registry: IRegistry;

  constructor(config: ISuggestorConfig, registry: IRegistry) {
    this.config = config;
    this.registry = registry;
  }

  register(scorer: IScorer): void {
    this.scorers.set(scorer.name, scorer);
  }

  unregister(name: string): void {
    this.scorers.delete(name);
  }

  /**
   * Evaluates a list of test files against a changed source file and returns
   * scored results sorted by relevance (highest score first).
   */
  evaluateTests(changedFile: string, testFiles: string[]): IScoreResult[] {
    const results: IScoreResult[] = [];

    const changedFileEntry = this.registry.getFile(changedFile);
    if (!changedFileEntry) {
      return results;
    }

    for (const testFilePath of testFiles) {
      const testFileEntry = this.registry.getFile(testFilePath);
      if (!testFileEntry) continue;

      const context: IScorerContext = {
        registry: this.registry,
        config: this.config,
        changedFile: changedFileEntry,
        testFile: testFileEntry,
      };

      // Collect signals from all enabled scorers
      const signals: ISignal[] = [];

      for (const scorer of this.scorers.values()) {
        if (!this.config.scoring.enabledScorers.includes(scorer.name)) continue;

        // Apply config weight override
        const weightOverride = this.config.scoring.scorerWeights?.[scorer.name];
        if (weightOverride !== undefined) {
          (scorer as unknown as { __effectiveWeight?: number }).__effectiveWeight = weightOverride;
        }

        const scorerSignals = scorer.evaluate(changedFile, testFilePath, context);
        signals.push(...scorerSignals);

        // Short-circuit: no need to run remaining scorers if we already have a 1.0 signal
        const hasPerfect = scorerSignals.some((s) => s.matched && s.weight >= 1.0);
        if (hasPerfect) {
          break;
        }
      }

      // Apply ubiquity dampener
      const dampenedSignals = this.applyUbiquityDampener(changedFile, signals);

      // Calculate final score
      const score = this.calculateScore(dampenedSignals);

      // Calculate confidence
      const confidence = this.calculateConfidence(score);

      // Generate explanation
      const explanation = this.generateExplanation(dampenedSignals, score);

      results.push({
        testFile: testFilePath,
        score,
        signals: dampenedSignals,
        confidence,
        explanation,
      });
    }

    // Sort by score (descending)
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Scoring formula:
   * finalScore = max(allSignalScores) + min(sum(otherScores) * 0.1, 0.05)
   */
  private calculateScore(signals: ISignal[]): number {
    if (signals.length === 0) {
      return 0;
    }

    const signalScores = signals.map((s) => s.weight * (s.matched ? 1 : 0));

    const maxScore = Math.max(...signalScores);
    const sumOthers = signalScores.reduce((sum, score) => sum + (score < maxScore ? score : 0), 0);
    const tiebreaker = Math.min(sumOthers * 0.1, 0.05);

    return Math.min(maxScore + tiebreaker, 1.0);
  }

  /**
   * Maps a numeric score to a human-readable confidence band.
   */
  private calculateConfidence(score: number): EConfidenceLevel {
    const highConfidence = this.config.scoring.highConfidence ?? 0.8;
    const minConfidence = this.config.scoring.minConfidence ?? 0.4;

    if (score >= highConfidence) return EConfidenceLevel.HIGH;
    if (score >= minConfidence) return EConfidenceLevel.MEDIUM;
    return EConfidenceLevel.LOW;
  }

  /**
   * Builds a human-readable explanation for CLI output.
   */
  private generateExplanation(signals: ISignal[], score: number): string {
    const matched = signals.filter((s) => s.matched).sort((a, b) => b.weight - a.weight);
    const unmatched = signals.filter((s) => !s.matched).sort((a, b) => b.weight - a.weight);

    if (matched.length === 0) {
      const unmatchedDesc = unmatched
        .slice(0, 3)
        .map((s) => this.formatSignal(s))
        .join('; ');
      return `No strong signals detected. Checked: ${unmatchedDesc || 'none'}`;
    }

    const topMatched = matched
      .slice(0, 3)
      .map((s) => this.formatSignal(s, true))
      .join(', ');

    const topUnmatched = unmatched
      .slice(0, 3)
      .map((s) => this.formatSignal(s))
      .join('; ');

    let explanation = `Matched by: ${topMatched}. Score: ${score.toFixed(2)}`;
    if (topUnmatched) {
      explanation += `. Not matched: ${topUnmatched}`;
    }
    return explanation;
  }

  /**
   * Standardizes the way signals are formatted for human readability.
   */
  private formatSignal(signal: ISignal, includeWeight: boolean = false): string {
    const description = signal.reason || signal.type;
    const sourcePath = signal.source ? `${signal.source} — ` : '';
    const weightSuffix = includeWeight ? ` (${(signal.weight * 100).toFixed(0)}%)` : '';

    if (!includeWeight) {
      return `${sourcePath}${description}`;
    }

    return `${description}${weightSuffix}`;
  }

  /**
   * Ubiquity dampener — prevents global/shared files from producing false positives.
   */
  private applyUbiquityDampener(changedFile: string, signals: ISignal[]): ISignal[] {
    const ubiquityThreshold = this.config.scoring.ubiquityThreshold ?? 0.7;
    const changedFileEntry = this.registry.getFile(changedFile);

    if (!changedFileEntry) return signals;

    const dependents = this.registry.getDependents(changedFile) || new Set();
    const sourceFiles = this.registry.getFilesByType('source') || [];

    if (sourceFiles.length === 0) {
      return signals; // Avoid division by zero
    }

    const ubiquity = dependents.size / sourceFiles.length;

    if (ubiquity <= ubiquityThreshold) {
      return signals;
    }

    return signals.map((signal) => {
      if (!signal.matched) return signal;
      return {
        ...signal,
        originalWeight: signal.weight,
        weight: signal.weight * 0.3,
        reason: `${signal.reason || 'Unknown'} (ubiquitous component, ubiquity=${(ubiquity * 100).toFixed(0)}%)`,
      };
    });
  }
}
