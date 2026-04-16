import {
  ISignal,
  IScoreResult,
  IScorer,
  IScorerContext,
  IRegistry,
  ISuggestorConfig,
} from '@/types';
import { EConfidenceLevel } from '@/utils/enums';

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
      const explanation = this.generateExplanation(dampenedSignals);

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
   * Builds a developer-facing explanation of why this test is relevant.
   * Speaks in terms of features and risk, not internal scoring details.
   */
  private generateExplanation(signals: ISignal[]): string {
    const matched = signals.filter((s) => s.matched).sort((a, b) => b.weight - a.weight);

    if (matched.length === 0) {
      return 'Weak connection — consider running manually if this area was affected.';
    }

    const reasons = matched
      .slice(0, 2)
      .map((s) => this.humanizeSignal(s))
      .filter(Boolean);

    return reasons.join('. ') + '.';
  }

  /**
   * Translates a matched signal into a natural-language reason a developer
   * would understand — why should they care about this test?
   */
  private humanizeSignal(signal: ISignal): string {
    const reason = signal.reason || '';

    switch (signal.type) {
      case 'direct-import':
        return 'This test directly imports the changed file, so any breakage will surface here';

      case 'transitive-import':
        return 'This test imports a module that depends on the changed file';

      case 'route-match':
        return reason.includes('visits')
          ? `This test navigates to a route that renders the changed component`
          : 'This test exercises a route connected to the changed file';

      case 'selector-match':
        return 'This test interacts with UI elements defined in the changed file';

      case 'selector-id-match':
        return 'This test targets elements by ID that appear in the changed file';

      case 'filename-match':
        return 'This test file is named after the changed component — likely its dedicated spec';

      case 'translation-match':
        return 'This test asserts on text content that originates from the changed file';

      case 'redux-chain':
        return 'This test covers a feature that shares Redux state with the changed file';

      case 'redux-consumer':
        return 'This test exercises UI that reads from Redux state the changed file writes to';

      case 'api-intercept':
        return reason.includes('intercepts')
          ? `This test mocks an API endpoint that the changed file calls`
          : 'This test intercepts API calls related to the changed file';

      case 'colocation':
        return 'This test lives alongside the changed file — likely tests it directly';

      case 'describe-block':
        return 'This test\'s describe/it blocks reference the changed component by name';

      default:
        return reason || 'This test is connected to the changed file';
    }
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
