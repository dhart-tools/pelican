import {
  ISignal,
  IScoreResult,
  IScorer,
  IScorerContext,
  IRegistry,
  ISuggestorConfig,
} from '@/types';
import { IRepoGitHistory } from '@/types/git';
import { EConfidenceLevel } from '@/utils/enums';

import { applyAnchorGate } from './anchor-gate';
import { isHubFile } from './hub-file';

export class ScoringEngine {
  private scorers: Map<string, IScorer> = new Map();
  private config: ISuggestorConfig;
  private registry: IRegistry;
  private gitHistories: Map<string, IRepoGitHistory>;

  constructor(
    config: ISuggestorConfig,
    registry: IRegistry,
    gitHistories: Map<string, IRepoGitHistory> = new Map(),
  ) {
    this.config = config;
    this.registry = registry;
    this.gitHistories = gitHistories;
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

    // Hub status depends only on the changed file, so compute it once here
    // rather than per-candidate. Used by the anchor gate to demote a hub's
    // broad (medium-tier) signals.
    const requireAnchor = this.config.scoring.requireAnchor ?? true;
    const changedIsHub = isHubFile(changedFileEntry);

    for (const testFilePath of testFiles) {
      const testFileEntry = this.registry.getFile(testFilePath);
      if (!testFileEntry) continue;

      const context: IScorerContext = {
        registry: this.registry,
        config: this.config,
        changedFile: changedFileEntry,
        testFile: testFileEntry,
        gitHistories: this.gitHistories,
      };

      // Collect signals from every registered scorer (all scorers are always on).
      const signals: ISignal[] = [];

      for (const scorer of this.scorers.values()) {
        const scorerSignals = scorer.evaluate(changedFile, testFilePath, context);
        signals.push(...scorerSignals);

        // Short-circuit: no need to run remaining scorers if we already have a 1.0 signal
        const hasPerfect = scorerSignals.some((s) => s.matched && s.weight >= 1.0);
        if (hasPerfect) {
          break;
        }
      }

      // Describe-block co-signal gate. A spec whose describe/it blocks
      // happen to mention a source token should not be selected *solely*
      // on that evidence — generic domain words (user, order, cart) appear
      // across unrelated specs by coincidence often enough that describe-
      // alone matches drive S3-style false positives (type-only edits that
      // share a noun with the spec). Keep the signal lit only when some
      // structural scorer (import, route, redux, selector, etc.) also
      // backs the pair.
      // Temporal coherence is a corroborator, not structural evidence, so it
      // does not by itself rescue a describe-only match here (the anchor gate
      // would suppress such a pair anyway — this just keeps the intent clear).
      const hasStructuralMatch = signals.some(
        (s) => s.matched && s.type !== 'describe-block' && s.type !== 'temporal-coherence',
      );
      if (!hasStructuralMatch) {
        for (const s of signals) {
          if (s.matched && s.type === 'describe-block') {
            s.matched = false;
            s.reason = `${s.reason} — suppressed: no co-signal (describe-only match)`;
          }
        }
      }

      // Anchor gate — require at least one file-identity signal (direct-import,
      // filename, colocation; plus route/selector/transitive when the changed
      // file isn't a hub). Candidates matched only by broad domain signals
      // (redux, describe-block) are suppressed here. This is the main precision
      // lever against hub-file floods; recall is preserved because every true
      // positive carries a narrow anchor.
      const gatedSignals = requireAnchor ? applyAnchorGate(signals, { changedIsHub }) : signals;

      // Apply ubiquity dampener
      const dampenedSignals = this.applyUbiquityDampener(changedFile, gatedSignals);

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
   * Scoring formula — noisy-or over matched signal weights:
   *   finalScore = 1 - ∏(1 - w_i) for every matched signal i
   *
   * Each signal is an independent evidence channel; noisy-or combines them
   * the way a probabilistic union does. Unlike the prior `max + tiebreaker`
   * formula, scores genuinely spread across the 0..1 band:
   *   - single direct-import (w=0.95)           → 0.95
   *   - direct-import + filename (both ~0.95)   → 0.9975
   *   - filename only (w=0.95)                  → 0.95
   *   - colocation alone (w=0.5)                → 0.50
   *   - two weak signals (w=0.3 each)           → 0.51
   *
   * This lets minConfidence actually partition: 0.6 keeps anchor-grade
   * signals only; 0.99 keeps tests with overlapping evidence; 0.4 lets
   * weaker signals through.
   */
  private calculateScore(signals: ISignal[]): number {
    if (signals.length === 0) return 0;

    let complement = 1;
    for (const s of signals) {
      if (!s.matched) continue;
      const w = Math.max(0, Math.min(1, s.weight));
      complement *= 1 - w;
    }
    return 1 - complement;
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
        return "This test's describe/it blocks reference the changed component by name";

      case 'temporal-coherence':
        return 'This test was created/changed alongside the changed file in git history';

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
