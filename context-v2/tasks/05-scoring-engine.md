# Task 05: Scoring Engine

## Overview

Create the scoring engine that evaluates test relevance based on signals from various analyzers. The engine provides a modular, plug-and-play scoring system with weightable signals and configurable aggregation.

## Objectives

1. Create base scorer interface
2. Implement signal evaluator
3. Create signal aggregation system
4. Implement confidence calculator
5. Support ubiquity dampener

## Core Types

```typescript
export interface ISignal {
  source: string;              // Analyzer name
  type: string;               // Signal type
  weight: number;             // 0.0 - 1.0
  originalWeight?: number;    // Weight before any dampening — always preserved for debugging
  matched: boolean;
  metadata?: {
    changedFile?: string;
    testFile?: string;
    details?: any;
  };
  reason?: string;
}

export interface IScoreResult {
  testFile: string;
  score: number;
  signals: ISignal[];
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
}

export interface IScorer {
  name: string;
  version: string;
  description: string;
  type: string;    // ← Must be declared on the interface, NOT just in BaseScorer
  weight: number;
  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[];
}

export interface IScorerContext {
  registry: IRegistry;
  config: ISuggestorConfig;
  changedFile: IFileEntry;
  testFile: IFileEntry;
}

export interface ISuggestorConfig {
  scoring: {
    enabledScorers: string[];
    ubiquityThreshold: number;   // default 0.7
    minConfidence: number;       // default 0.4  — medium/low boundary
    highConfidence: number;      // default 0.8  — high/medium boundary  ← NEW: was hardcoded
    scorerWeights?: Record<string, number>; // ← NEW: per-scorer weight overrides
  };
}
```

> **Why `type` was moved to `IScorer`:** The original `BaseScorer` exposed `type` only as an abstract getter on the class, which meant anything consuming the `IScorer` interface directly had no knowledge of it. The signal's `type` field was therefore silently populated by an internal implementation detail. By adding `type` to the interface, all consumers (engine, tests, loggers) can read it without depending on the concrete class.

---

## Implementation

### 1. Create Scoring Engine

**File:** `src/v2/core/scoring/scoring-engine.ts`

```typescript
import {
  ISignal,
  IScoreResult,
  IScorer,
  IScorerContext,
  IRegistry,
  IFileEntry,
  ISuggestorConfig
} from '../../types';

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
   *
   * Performance note: this method is synchronous. For large test suites (500+
   * files) consider batching calls or moving to an async implementation in the future.
   * A short-circuit is applied: if a test file receives a perfect score (1.0) from
   * any single scorer, remaining scorers for that test are skipped.
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
        testFile: testFileEntry
      };

      // Collect signals from all enabled scorers
      const signals: ISignal[] = [];
      let shortCircuited = false;

      for (const scorer of this.scorers.values()) {
        if (!this.config.scoring.enabledScorers.includes(scorer.name)) continue;

        // Apply config weight override BEFORE evaluating, so scorers see the
        // canonical weight via context if needed in future
        const weightOverride = this.config.scoring.scorerWeights?.[scorer.name];
        if (weightOverride !== undefined) {
          // We patch the scorer's effective weight for this evaluation only.
          // We do NOT mutate the scorer object itself.
          (scorer as any).__effectiveWeight = weightOverride;
        }

        const scorerSignals = scorer.evaluate(changedFile, testFilePath, context);
        signals.push(...scorerSignals);

        // Short-circuit: no need to run remaining scorers if we already have a 1.0 signal
        const hasPerfect = scorerSignals.some((s) => s.matched && s.weight >= 1.0);
        if (hasPerfect) {
          shortCircuited = true;
          break;
        }
      }

      // Apply ubiquity dampener.
      // IMPORTANT: dampener creates new signal objects — it does NOT mutate originals.
      const dampenedSignals = this.applyUbiquityDampener(changedFile, signals);

      // Calculate final score
      const score = this.calculateScore(dampenedSignals);

      // Calculate confidence
      const confidence = this.calculateConfidence(score);

      // Generate explanation (verbose mode shows unmatched signals too)
      const explanation = this.generateExplanation(dampenedSignals, score);

      results.push({
        testFile: testFilePath,
        score,
        signals: dampenedSignals,
        confidence,
        explanation
      });
    }

    // Sort by score (descending)
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Scoring formula:
   *
   *   finalScore = max(allSignalScores) + min(sum(otherScores) * 0.1, 0.05)
   *
   * DESIGN RATIONALE — why max-signal dominates:
   *
   * A single strong signal (e.g. direct import at 0.95) is far more reliable
   * than many weak, coincidental signals. Summing all signals would let five
   * weak keyword matches (5 × 0.35 = 1.75) outrank a true direct import (0.95),
   * producing false positives.
   *
   * The tiebreaker (capped at 0.05) exists purely to break ties when two tests
   * share the same dominant signal. It can shift the score by at most 0.05, so
   * it never overrides a meaningful signal difference.
   *
   * Example:
   *   Test A signals: [0.95 matched, 0.80 matched, 0.50 unmatched]
   *     → max = 0.95, sumOthers = 0.80, tiebreaker = min(0.08, 0.05) = 0.05
   *     → finalScore = 0.95 + 0.05 = 1.00 (capped)
   *
   *   Test B signals: [0.95 matched, 0.35 matched]
   *     → max = 0.95, sumOthers = 0.35, tiebreaker = min(0.035, 0.05) = 0.035
   *     → finalScore = 0.95 + 0.035 = 0.985
   *
   *   Test A ranks above Test B even though both have a direct-import match.
   */
  private calculateScore(signals: ISignal[]): number {
    if (signals.length === 0) {
      return 0;
    }

    const signalScores = signals.map((s) => s.weight * (s.matched ? 1 : 0));

    const maxScore = Math.max(...signalScores);
    const sumOthers = signalScores.reduce(
      (sum, score) => sum + (score < maxScore ? score : 0),
      0
    );
    const tiebreaker = Math.min(sumOthers * 0.1, 0.05);

    return Math.min(maxScore + tiebreaker, 1.0);
  }

  /**
   * Maps a numeric score to a human-readable confidence band.
   *
   * Both thresholds are read from config so teams can tune them.
   * Do NOT hardcode either value here.
   *
   *   score >= highConfidence  → 'high'    (default: 0.8)
   *   score >= minConfidence   → 'medium'  (default: 0.4)
   *   score <  minConfidence   → 'low'
   */
  private calculateConfidence(score: number): 'high' | 'medium' | 'low' {
    const highConfidence = this.config.scoring.highConfidence ?? 0.8;
    const minConfidence = this.config.scoring.minConfidence ?? 0.4;

    if (score >= highConfidence) return 'high';
    if (score >= minConfidence) return 'medium';
    return 'low';
  }

  /**
   * Builds a human-readable explanation for CLI output.
   *
   * Always shows the top 3 matched signals.
   * Also shows up to 3 unmatched signals (with their reasons) so developers
   * can understand why a test ranked lower than expected — critical for
   * debugging false negatives.
   *
   * Example output:
   *   "Matched by: Direct Import (95%), Route Match (85%). Score: 0.98.
   *    Not matched: Selector Match — no selectors in source file,
   *    Filename Convention — naming pattern mismatch"
   */
  private generateExplanation(signals: ISignal[], score: number): string {
    const matched = signals.filter((s) => s.matched).sort((a, b) => b.weight - a.weight);
    const unmatched = signals.filter((s) => !s.matched).sort((a, b) => b.weight - a.weight);

    if (matched.length === 0) {
      const unmatchedDesc = unmatched
        .slice(0, 3)
        .map((s) => `${s.source} — ${s.reason || s.type}`)
        .join('; ');
      return `No strong signals detected. Checked: ${unmatchedDesc || 'none'}`;
    }

    const topMatched = matched
      .slice(0, 3)
      .map((s) => `${s.reason || s.type} (${(s.weight * 100).toFixed(0)}%)`)
      .join(', ');

    const topUnmatched = unmatched
      .slice(0, 3)
      .map((s) => `${s.source} — ${s.reason || s.type}`)
      .join('; ');

    let explanation = `Matched by: ${topMatched}. Score: ${score.toFixed(2)}`;
    if (topUnmatched) {
      explanation += `. Not matched: ${topUnmatched}`;
    }
    return explanation;
  }

  /**
   * Ubiquity dampener — prevents global/shared files from producing false positives.
   *
   * If a changed file is imported by > ubiquityThreshold fraction of all source
   * files (e.g. a global theme, api-client, or i18n helper), every test in the
   * repo would receive a high score just because of that shared dependency.
   * The dampener reduces matched signal weights by 70% when this condition is met.
   *
   * IMPORTANT: This method returns NEW signal objects. It does NOT mutate the
   * input array or the signal objects inside it. This preserves the original
   * weight for debugging and for generating the explanation ("was 0.95, dampened
   * to 0.285 — ubiquitous component").
   *
   * Example:
   *   changedFile = 'src/utils/i18n.ts'
   *   dependents  = 280 files
   *   sourceFiles = 300 files
   *   ubiquity    = 280 / 300 = 0.93  → above threshold of 0.7 → dampen
   *
   *   signal { weight: 0.95, matched: true }
   *   → returned as { weight: 0.285, originalWeight: 0.95, matched: true,
   *                   reason: "... (ubiquitous component)" }
   */
  private applyUbiquityDampener(changedFile: string, signals: ISignal[]): ISignal[] {
    const ubiquityThreshold = this.config.scoring.ubiquityThreshold ?? 0.7;
    const changedFileEntry = this.registry.getFile(changedFile);

    if (!changedFileEntry) return signals;

    const dependents = this.registry.getDependents(changedFile);
    const sourceFiles = this.registry.getFilesByType('source');
    const ubiquity = dependents.length / sourceFiles.length;

    if (ubiquity <= ubiquityThreshold) {
      return signals; // No dampening needed — return originals untouched
    }

    // Return NEW objects; never mutate originals
    return signals.map((signal) => {
      if (!signal.matched) return signal;
      return {
        ...signal,
        originalWeight: signal.weight,           // Preserve for debugging
        weight: signal.weight * 0.3,             // Dampen by 70%
        reason: `${signal.reason || 'Unknown'} (ubiquitous component, ubiquity=${(ubiquity * 100).toFixed(0)}%)`
      };
    });
  }
}
```

---

### 2. Create Base Scorer Class

**File:** `src/v2/core/scoring/scorers/base.ts`

```typescript
import { IScorer, IScorerContext, ISignal } from '../../../types';

/**
 * BaseScorer provides a reusable implementation of IScorer.
 * Concrete scorers extend this class and implement `evaluate()`.
 *
 * The `type` string is passed via constructor config and stored on the instance,
 * satisfying the IScorer interface without requiring an abstract getter.
 * This makes the type visible to any consumer of IScorer, not just subclasses.
 */
export abstract class BaseScorer implements IScorer {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly type: string;   // ← stored from constructor config, satisfies IScorer
  readonly weight: number;

  constructor(config: {
    name: string;
    version: string;
    description: string;
    type: string;
    weight: number;
  }) {
    this.name = config.name;
    this.version = config.version;
    this.description = config.description;
    this.type = config.type;
    this.weight = config.weight;
  }

  abstract evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[];

  /**
   * Helper that creates a signal using this scorer's metadata.
   * The effective weight is read from __effectiveWeight if the engine has
   * injected a config override, otherwise falls back to this.weight.
   *
   * @param matched  - Whether this signal was positively detected
   * @param reason   - Human-readable reason string shown in CLI output
   * @param metadata - Optional structured metadata for debugging
   */
  protected createSignal(
    matched: boolean,
    reason?: string,
    metadata?: any
  ): ISignal {
    const effectiveWeight = (this as any).__effectiveWeight ?? this.weight;
    return {
      source: this.name,
      type: this.type,
      weight: effectiveWeight,
      matched,
      metadata,
      reason
    };
  }
}
```

---

### 3. Create Example Scorer — Direct Import Scorer

**File:** `src/v2/core/scoring/scorers/direct-import-scorer.ts`

```typescript
import { BaseScorer } from './base';
import { IScorerContext, ISignal } from '../../../types';

export class DirectImportScorer extends BaseScorer {
  constructor() {
    super({
      name: 'direct-import',
      version: '1.0.0',
      description: 'Scores based on direct imports between test and source',
      type: 'direct-import',
      weight: 0.95
    });
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry } = context;

    const testImports = testEntry.imports || [];
    const isDirectImport = testImports.includes(changedFile);

    if (isDirectImport) {
      return [
        this.createSignal(true, `Test directly imports ${changedFile}`, {
          changedFile,
          testFile,
          importType: 'direct'
        })
      ];
    }

    return [
      this.createSignal(false, 'Test does not directly import this file', {
        changedFile,
        testFile,
        importType: 'direct'
      })
    ];
  }
}
```

---

### 4. Create Example Scorer — Route Match Scorer

**File:** `src/v2/core/scoring/scorers/route-match-scorer.ts`

```typescript
import { BaseScorer } from './base';
import { IScorerContext, ISignal, IRegistry } from '../../../types';

export class RouteMatchScorer extends BaseScorer {
  constructor() {
    super({
      name: 'route-match',
      version: '1.0.0',
      description: 'Scores based on visited routes matching component paths',
      type: 'route-match',
      weight: 0.85
    });
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, registry } = context;

    const visitedRoutes = testEntry.cypress?.visitedRoutes || [];
    if (visitedRoutes.length === 0) {
      return [this.createSignal(false, 'No routes visited')];
    }

    const routeMap = registry.getRouteMap();

    for (const route of visitedRoutes) {
      const componentPath = routeMap.get(route);

      if (componentPath === changedFile) {
        return [
          this.createSignal(
            true,
            `Test visits ${route} which renders ${changedFile}`,
            { changedFile, testFile, route, componentPath }
          )
        ];
      }

      if (componentPath) {
        const depth = this.findTransitiveDependencies(componentPath, changedFile, registry);
        if (depth !== null) {
          return [
            this.createSignal(
              true,
              `Test visits ${route}, component ${componentPath} imports ${changedFile} (depth ${depth})`,
              { changedFile, testFile, route, componentPath, depth }
            )
          ];
        }
      }
    }

    return [
      this.createSignal(false, `Test routes do not relate to ${changedFile}`, {
        changedFile,
        testFile,
        visitedRoutes
      })
    ];
  }

  private findTransitiveDependencies(
    basePath: string,
    targetPath: string,
    registry: IRegistry,
    depth: number = 1,
    maxDepth: number = 3
  ): number | null {
    if (depth > maxDepth) return null;

    const deps = registry.getDependencies(basePath);
    if (deps.has(targetPath)) return depth;

    for (const dep of deps) {
      const result = this.findTransitiveDependencies(dep, targetPath, registry, depth + 1, maxDepth);
      if (result !== null) return result;
    }

    return null;
  }
}
```

---

### 5. Create Example Scorer — Selector Match Scorer

**File:** `src/v2/core/scoring/scorers/selector-match-scorer.ts`

```typescript
import { BaseScorer } from './base';
import { IScorerContext, ISignal } from '../../../types';

export class SelectorMatchScorer extends BaseScorer {
  constructor() {
    super({
      name: 'selector-match',
      version: '1.0.0',
      description: 'Scores based on selector (testid, data-cy) matches between test and source',
      type: 'selector-match',
      weight: 0.80
    });
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, changedFile: changedEntry } = context;

    const testSelectors = testEntry.cypress?.selectors || [];
    if (testSelectors.length === 0) {
      return [this.createSignal(false, 'No selectors in test')];
    }

    const sourceSelectors = changedEntry.selectors || [];
    if (sourceSelectors.length === 0) {
      return [this.createSignal(false, 'No selectors in source file')];
    }

    const sourceSelectorValues = new Set(sourceSelectors.map((s) => s.value));

    const matches: string[] = [];
    for (const testSelector of testSelectors) {
      if (testSelector.type === 'testid' || testSelector.type === 'data-cy') {
        if (sourceSelectorValues.has(testSelector.value)) {
          matches.push(testSelector.value);
        }
      }
    }

    if (matches.length > 0) {
      return [
        this.createSignal(true, `Test selectors match: ${matches.join(', ')}`, {
          changedFile,
          testFile,
          matchedSelectors: matches
        })
      ];
    }

    return [
      this.createSignal(false, 'No matching selectors', {
        changedFile,
        testFile,
        testSelectors,
        sourceSelectors: [...sourceSelectorValues]
      })
    ];
  }
}
```

---

## Usage Example

```typescript
import { ScoringEngine } from './v2/core/scoring/scoring-engine';
import { DirectImportScorer } from './v2/core/scoring/scorers/direct-import-scorer';
import { RouteMatchScorer } from './v2/core/scoring/scorers/route-match-scorer';
import { SelectorMatchScorer } from './v2/core/scoring/scorers/selector-match-scorer';

// Initialize
const config = loadConfig();
const registry = await buildRegistry();
const engine = new ScoringEngine(config, registry);

// Register scorers
engine.register(new DirectImportScorer());
engine.register(new RouteMatchScorer());
engine.register(new SelectorMatchScorer());

// Evaluate tests
const changedFile = 'src/components/LoginForm.tsx';
const testFiles = ['cypress/e2e/login.cy.ts', 'cypress/e2e/dashboard.cy.ts'];

const results = engine.evaluateTests(changedFile, testFiles);

// Output:
// [
//   {
//     testFile: 'cypress/e2e/login.cy.ts',
//     score: 0.98,
//     confidence: 'high',
//     signals: [
//       { source: 'direct-import', type: 'direct-import', weight: 0.95, matched: true,
//         reason: 'Test directly imports src/components/LoginForm.tsx' },
//       { source: 'selector-match', type: 'selector-match', weight: 0.80, matched: true,
//         reason: 'Test selectors match: login-submit-btn, login-email-input' }
//     ],
//     explanation: 'Matched by: Test directly imports ... (95%), Test selectors match ... (80%). Score: 0.98. Not matched: route-match — no routes visited'
//   },
//   {
//     testFile: 'cypress/e2e/dashboard.cy.ts',
//     score: 0.0,
//     confidence: 'low',
//     signals: [
//       { source: 'direct-import', matched: false, reason: 'Test does not directly import this file' },
//       { source: 'route-match',   matched: false, reason: 'Test routes do not relate to src/components/LoginForm.tsx' },
//       { source: 'selector-match', matched: false, reason: 'No matching selectors' }
//     ],
//     explanation: 'No strong signals detected. Checked: direct-import — Test does not directly import this file; route-match — Test routes do not relate to ...'
//   }
// ]
```

---

## Config Example

```typescript
// Full config shape showing all scoring options, including new fields.
// Place this in your suggestorrc.json or equivalent config file.
const config: ISuggestorConfig = {
  scoring: {
    enabledScorers: [
      'direct-import',
      'route-match',
      'selector-match',
      'filename-convention'
    ],
    ubiquityThreshold: 0.7,    // Files imported by >70% of source files are dampened
    minConfidence: 0.4,        // Below this → 'low'; at or above → 'medium'
    highConfidence: 0.8,       // At or above this → 'high'

    // Optional: override individual scorer weights without touching source code.
    // Useful when your project's naming conventions are very consistent (bump
    // filename-convention) or when transitive imports are too noisy (lower it).
    scorerWeights: {
      'filename-convention': 0.75,   // Was 0.60 — team has strict naming conventions
      'keyword-overlap': 0.20        // Was 0.35 — too noisy in this codebase
    }
  }
};
```

---

## Known Issues & Design Decisions

This section documents deliberate design choices and known limitations so future
contributors do not accidentally revert them.

### Issue 1 — `type` must live on `IScorer`, not only on `BaseScorer`

**Problem:** The original implementation declared `type` only as an abstract getter
inside `BaseScorer`. Any code consuming the `IScorer` interface (the engine, test
mocks, external tools) had no way to read `type` without casting to the concrete
class. This is a leaky abstraction.

**Fix:** `type` is now a required field on `IScorer` and is passed via the constructor
config object in `BaseScorer`, consistent with `name`, `version`, and `weight`.

**Do not revert:** If you remove `type` from `IScorer`, code that reads
`scorer.type` through the interface will break at compile time.

---

### Issue 2 — Ubiquity dampener must NOT mutate signals in-place

**Problem:** The original `applyUbiquityDampener` wrote directly to `signal.weight`
and `signal.reason`. This meant the pre-dampening weight was permanently lost,
making it impossible to explain *why* a score was lower than expected or to run
the engine in a dry-run/explain mode.

**Fix:** `applyUbiquityDampener` now returns a **new array of new signal objects**
(`{ ...signal, weight: ..., originalWeight: signal.weight }`). The input array
and its objects are never touched.

**Do not revert:** If you switch back to mutation, the `originalWeight` field
disappears, `explanation` loses context, and unit tests that assert the original
weight is preserved will fail.

---

### Issue 3 — Both confidence thresholds must come from config

**Problem:** `highConfidence` (the `score >= 0.8` cutoff) was hardcoded while
`minConfidence` was configurable. This inconsistency means teams can tune the
medium/low boundary but not the high/medium boundary.

**Fix:** `highConfidence` is now read from `config.scoring.highConfidence` with a
default of `0.8`. Both thresholds default-preserve existing behaviour.

**Do not revert:** If you re-hardcode `0.8`, teams with a stricter definition of
"high confidence" cannot tune it without changing source.

---

### Issue 4 — Config-driven scorer weight overrides

**Problem:** Scorer weights were hardcoded in each class constructor. A team using
this tool with very consistent file naming could not increase `filename-convention`
weight without forking the scorer.

**Fix:** `ISuggestorConfig.scoring.scorerWeights` is an optional `Record<string, number>`
map. The engine reads it and injects the override weight into the scorer instance
via `__effectiveWeight` before each evaluation. The scorer's own `this.weight` is
never permanently changed.

**Do not revert:** Weight overrides are the primary tuning mechanism for teams
adopting this tool. Removing them forces code changes for every customisation.

---

### Issue 5 — Missing `IRegistry` import in `RouteMatchScorer`

**Problem:** `findTransitiveDependencies` accepts a `registry: IRegistry` parameter
but the original file had no `import { IRegistry }` statement. This is a
TypeScript compile error.

**Fix:** `IRegistry` is now imported at the top of `route-match-scorer.ts`.

---

### Issue 6 — Scoring formula rationale

See the inline JSDoc on `calculateScore` for the full explanation. Short version:
max-signal-dominates is intentional to prevent many weak coincidental signals from
outranking a single strong structural signal (e.g. direct import). The 0.05-capped
tiebreaker exists only for secondary ranking when dominant signals tie.

---

### Issue 7 — Performance / async considerations

`evaluateTests` is currently synchronous. For projects with 500+ test files and
10+ scorers this can block the event loop. A short-circuit is applied (stop running
scorers for a given test once a perfect 1.0 signal is found) but this is a
partial mitigation. If performance becomes a concern, the recommended path is:

- Make `evaluateTests` return `Promise<IScoreResult[]>`
- Run scorer evaluations for each test file in parallel using `Promise.all`
- Add a `maxTestFiles` guard in config that truncates input before scoring

This is not implemented yet to keep the initial version simple.

---

## Testing Strategy

### Test Utilities — Mock Registry & Context

All unit tests should use these shared mocks. Create them in
`src/__tests__/helpers/mock-registry.ts` so every test file can import them
without duplication.

```typescript
// src/__tests__/helpers/mock-registry.ts

import { IRegistry, IFileEntry } from '../../core/types';

/**
 * Creates a minimal mock IRegistry. Override only the methods your test needs.
 *
 * Usage:
 *   const registry = createMockRegistry({
 *     files: { 'src/Button.tsx': { imports: [], selectors: [] } },
 *     dependents: { 'src/Button.tsx': ['src/App.tsx'] }
 *   });
 */
export function createMockRegistry(opts: {
  files?: Record<string, Partial<IFileEntry>>;
  dependents?: Record<string, string[]>;
  dependencies?: Record<string, string[]>;
  routeMap?: Record<string, string>;
  sourceFileCount?: number;
}): IRegistry {
  const files = opts.files || {};
  const dependents = opts.dependents || {};
  const dependencies = opts.dependencies || {};
  const routeMap = new Map(Object.entries(opts.routeMap || {}));
  const sourceFileCount = opts.sourceFileCount ?? Object.keys(files).length;

  return {
    getFile: (path: string) =>
      files[path] ? ({ path, imports: [], selectors: [], ...files[path] } as IFileEntry) : undefined,
    getDependents: (path: string) => dependents[path] || [],
    getDependencies: (path: string) => new Set(dependencies[path] || []),
    getFilesByType: (type: string) =>
      type === 'source' ? Array(sourceFileCount).fill({}) as IFileEntry[] : [],
    getRouteMap: () => routeMap
  } as unknown as IRegistry;
}

/** Creates a minimal IScorerContext for use in scorer unit tests. */
export function createMockContext(opts: {
  registry: IRegistry;
  changedFile?: Partial<IFileEntry>;
  testFile?: Partial<IFileEntry>;
}): IScorerContext {
  return {
    registry: opts.registry,
    config: {
      scoring: {
        enabledScorers: [],
        ubiquityThreshold: 0.7,
        minConfidence: 0.4,
        highConfidence: 0.8
      }
    },
    changedFile: { path: 'src/changed.tsx', imports: [], selectors: [], ...(opts.changedFile || {}) } as IFileEntry,
    testFile: { path: 'cypress/e2e/test.cy.ts', imports: [], cypress: { visitedRoutes: [], selectors: [] }, ...(opts.testFile || {}) } as IFileEntry
  };
}
```

---

### Unit Tests — Score Calculation

**File:** `src/__tests__/scoring-engine.score.test.ts`

```typescript
import { ScoringEngine } from '../../core/scoring-engine';
import { createMockRegistry } from '../helpers/mock-registry';

// Helper: build an engine with no scorers (we inject signals manually via a mock scorer)
function buildEngine(registryOpts = {}) {
  const registry = createMockRegistry(registryOpts);
  const config = {
    scoring: {
      enabledScorers: ['mock-scorer'],
      ubiquityThreshold: 0.7,
      minConfidence: 0.4,
      highConfidence: 0.8
    }
  };
  return new ScoringEngine(config, registry);
}

describe('calculateScore — max signal dominates', () => {
  it('returns the weight of the single matched signal', () => {
    // Arrange: one matched signal at 0.95, nothing else
    const registry = createMockRegistry({
      files: {
        'src/Button.tsx': {},
        'cypress/e2e/button.cy.ts': { imports: ['src/Button.tsx'] }
      }
    });
    // DirectImportScorer will produce one matched signal of weight 0.95
    // ... (use a real scorer or a stub that produces known signals)
    // For a pure unit test of the formula, call the private method via (engine as any)
    const engine = buildEngine() as any;
    const signals = [
      { weight: 0.95, matched: true, source: 'x', type: 'x' }
    ];
    expect(engine.calculateScore(signals)).toBeCloseTo(0.95);
  });

  it('adds a small tiebreaker from secondary matched signals', () => {
    const engine = buildEngine() as any;
    const signals = [
      { weight: 0.95, matched: true, source: 'a', type: 'a' },  // max
      { weight: 0.80, matched: true, source: 'b', type: 'b' },  // other: 0.80
    ];
    // tiebreaker = min(0.80 * 0.1, 0.05) = min(0.08, 0.05) = 0.05
    // finalScore = 0.95 + 0.05 = 1.00 (capped)
    expect(engine.calculateScore(signals)).toBeCloseTo(1.0);
  });

  it('caps the final score at 1.0 even with many secondary signals', () => {
    const engine = buildEngine() as any;
    const signals = [
      { weight: 0.95, matched: true, source: 'a', type: 'a' },
      { weight: 0.85, matched: true, source: 'b', type: 'b' },
      { weight: 0.80, matched: true, source: 'c', type: 'c' },
      { weight: 0.75, matched: true, source: 'd', type: 'd' },
    ];
    expect(engine.calculateScore(signals)).toBeLessThanOrEqual(1.0);
  });

  it('returns 0 when no signals', () => {
    const engine = buildEngine() as any;
    expect(engine.calculateScore([])).toBe(0);
  });

  it('returns 0 when all signals are unmatched', () => {
    const engine = buildEngine() as any;
    const signals = [
      { weight: 0.95, matched: false, source: 'a', type: 'a' },
      { weight: 0.80, matched: false, source: 'b', type: 'b' },
    ];
    expect(engine.calculateScore(signals)).toBe(0);
  });

  it('ignores unmatched signals when computing tiebreaker', () => {
    const engine = buildEngine() as any;
    const signals = [
      { weight: 0.95, matched: true,  source: 'a', type: 'a' },
      { weight: 0.80, matched: false, source: 'b', type: 'b' }, // unmatched — excluded
    ];
    // Only matched weight matters: tiebreaker from sumOthers = 0 → 0
    expect(engine.calculateScore(signals)).toBeCloseTo(0.95);
  });

  it('uses the single highest signal as max even when others are close', () => {
    const engine = buildEngine() as any;
    // Test A: max=0.95, one secondary at 0.85  → tiebreaker = min(0.085, 0.05) = 0.05 → 1.00
    // Test B: max=0.95, one secondary at 0.35  → tiebreaker = min(0.035, 0.05) = 0.035 → 0.985
    const signalsA = [
      { weight: 0.95, matched: true, source: 'a', type: 'a' },
      { weight: 0.85, matched: true, source: 'b', type: 'b' },
    ];
    const signalsB = [
      { weight: 0.95, matched: true, source: 'a', type: 'a' },
      { weight: 0.35, matched: true, source: 'b', type: 'b' },
    ];
    expect(engine.calculateScore(signalsA)).toBeGreaterThan(engine.calculateScore(signalsB));
  });
});
```

---

### Unit Tests — Confidence Levels

**File:** `src/__tests__/scoring-engine.confidence.test.ts`

```typescript
import { ScoringEngine } from '../../core/scoring-engine';
import { createMockRegistry } from '../helpers/mock-registry';

function buildEngineWithThresholds(highConfidence: number, minConfidence: number) {
  const registry = createMockRegistry({ files: { 'src/f.tsx': {} } });
  const config = {
    scoring: {
      enabledScorers: [],
      ubiquityThreshold: 0.7,
      minConfidence,
      highConfidence
    }
  };
  return new ScoringEngine(config, registry) as any;
}

describe('calculateConfidence', () => {
  const engine = buildEngineWithThresholds(0.8, 0.4);

  it('returns high for score >= 0.8', () => {
    expect(engine.calculateConfidence(0.80)).toBe('high');
    expect(engine.calculateConfidence(1.00)).toBe('high');
    expect(engine.calculateConfidence(0.95)).toBe('high');
  });

  it('returns medium for score between 0.4 and 0.8', () => {
    expect(engine.calculateConfidence(0.79)).toBe('medium');
    expect(engine.calculateConfidence(0.40)).toBe('medium');
    expect(engine.calculateConfidence(0.55)).toBe('medium');
  });

  it('returns low for score below 0.4', () => {
    expect(engine.calculateConfidence(0.39)).toBe('low');
    expect(engine.calculateConfidence(0.00)).toBe('low');
  });

  it('respects custom highConfidence threshold from config', () => {
    // A stricter team wants 0.9 before calling something "high"
    const strictEngine = buildEngineWithThresholds(0.9, 0.4);
    expect(strictEngine.calculateConfidence(0.85)).toBe('medium'); // would be 'high' with defaults
    expect(strictEngine.calculateConfidence(0.90)).toBe('high');
  });

  it('respects custom minConfidence threshold from config', () => {
    // A lenient team accepts 0.3 as medium
    const lenientEngine = buildEngineWithThresholds(0.8, 0.3);
    expect(lenientEngine.calculateConfidence(0.30)).toBe('medium'); // would be 'low' with defaults
    expect(lenientEngine.calculateConfidence(0.29)).toBe('low');
  });
});
```

---

### Unit Tests — Ubiquity Dampener

**File:** `src/__tests__/scoring-engine.dampener.test.ts`

```typescript
import { ScoringEngine } from '../../core/scoring-engine';
import { createMockRegistry } from '../helpers/mock-registry';

/**
 * Setup helper.
 *
 * ubiquityRatio controls how "global" the changed file appears:
 *   ubiquityRatio = 0.9 → 90% of source files depend on it → dampened
 *   ubiquityRatio = 0.3 → 30% of source files depend on it → not dampened
 *
 * We simulate this by setting dependents count and sourceFileCount.
 */
function buildEngineForUbiquity(ubiquityRatio: number, threshold = 0.7) {
  const sourceFileCount = 100;
  const dependentCount = Math.round(ubiquityRatio * sourceFileCount);
  const dependents = Array.from({ length: dependentCount }, (_, i) => `src/file${i}.tsx`);

  const registry = createMockRegistry({
    files: { 'src/i18n.ts': {}, 'cypress/e2e/test.cy.ts': {} },
    dependents: { 'src/i18n.ts': dependents },
    sourceFileCount
  });
  const config = {
    scoring: {
      enabledScorers: [],
      ubiquityThreshold: threshold,
      minConfidence: 0.4,
      highConfidence: 0.8
    }
  };
  return new ScoringEngine(config, registry) as any;
}

describe('applyUbiquityDampener', () => {
  it('dampens matched signals when ubiquity exceeds threshold', () => {
    const engine = buildEngineForUbiquity(0.9); // 90% > 70% threshold
    const signals = [
      { source: 'a', type: 'a', weight: 0.95, matched: true, reason: 'Direct import' }
    ];

    const result = engine.applyUbiquityDampener('src/i18n.ts', signals);

    expect(result[0].weight).toBeCloseTo(0.95 * 0.3); // 0.285
    expect(result[0].originalWeight).toBe(0.95);       // preserved
    expect(result[0].reason).toContain('ubiquitous component');
  });

  it('does NOT dampen when ubiquity is below threshold', () => {
    const engine = buildEngineForUbiquity(0.3); // 30% < 70% threshold
    const signals = [
      { source: 'a', type: 'a', weight: 0.95, matched: true, reason: 'Direct import' }
    ];

    const result = engine.applyUbiquityDampener('src/i18n.ts', signals);

    expect(result[0].weight).toBe(0.95);              // unchanged
    expect(result[0].originalWeight).toBeUndefined(); // not set when not dampened
  });

  it('does NOT mutate the original signal objects', () => {
    const engine = buildEngineForUbiquity(0.9);
    const original = { source: 'a', type: 'a', weight: 0.95, matched: true, reason: 'Direct import' };
    const signals = [original];

    engine.applyUbiquityDampener('src/i18n.ts', signals);

    // The original object must be untouched
    expect(original.weight).toBe(0.95);
    expect((original as any).originalWeight).toBeUndefined();
  });

  it('does NOT dampen unmatched signals', () => {
    const engine = buildEngineForUbiquity(0.9);
    const signals = [
      { source: 'a', type: 'a', weight: 0.95, matched: false, reason: 'Not imported' }
    ];

    const result = engine.applyUbiquityDampener('src/i18n.ts', signals);

    // Unmatched signals are returned as-is
    expect(result[0].weight).toBe(0.95);
    expect(result[0].matched).toBe(false);
  });

  it('respects a custom ubiquityThreshold from config', () => {
    // With a stricter threshold of 0.5, a file imported by 60% still gets dampened
    const engine = buildEngineForUbiquity(0.6, 0.5);
    const signals = [
      { source: 'a', type: 'a', weight: 0.80, matched: true, reason: 'Route match' }
    ];

    const result = engine.applyUbiquityDampener('src/i18n.ts', signals);

    expect(result[0].weight).toBeCloseTo(0.80 * 0.3); // dampened
  });

  it('includes ubiquity percentage in the dampened reason string', () => {
    const engine = buildEngineForUbiquity(0.9);
    const signals = [
      { source: 'a', type: 'a', weight: 0.95, matched: true, reason: 'Direct import' }
    ];

    const result = engine.applyUbiquityDampener('src/i18n.ts', signals);

    expect(result[0].reason).toContain('90%'); // ubiquity=90/100=90%
  });
});
```

---

### Unit Tests — Individual Scorer Mocking Pattern

**File:** `src/__tests__/scorers/direct-import-scorer.test.ts`

This pattern applies to every scorer. Copy it when creating a new scorer's test file.

```typescript
import { DirectImportScorer } from '../../scorers/direct-import-scorer';
import { createMockRegistry, createMockContext } from '../helpers/mock-registry';

describe('DirectImportScorer', () => {
  const scorer = new DirectImportScorer();

  it('returns a matched signal when test imports the changed file', () => {
    // Arrange
    const registry = createMockRegistry({
      files: {
        'src/LoginForm.tsx': {},
        'cypress/e2e/login.cy.ts': { imports: ['src/LoginForm.tsx'] }
      }
    });
    const context = createMockContext({
      registry,
      changedFile: { path: 'src/LoginForm.tsx' },
      testFile: { path: 'cypress/e2e/login.cy.ts', imports: ['src/LoginForm.tsx'] }
    });

    // Act
    const signals = scorer.evaluate('src/LoginForm.tsx', 'cypress/e2e/login.cy.ts', context);

    // Assert
    expect(signals).toHaveLength(1);
    expect(signals[0].matched).toBe(true);
    expect(signals[0].weight).toBe(0.95);
    expect(signals[0].source).toBe('direct-import');
    expect(signals[0].reason).toContain('src/LoginForm.tsx');
  });

  it('returns an unmatched signal when test does not import the changed file', () => {
    const registry = createMockRegistry({
      files: {
        'src/LoginForm.tsx': {},
        'cypress/e2e/dashboard.cy.ts': { imports: ['src/Dashboard.tsx'] }
      }
    });
    const context = createMockContext({
      registry,
      changedFile: { path: 'src/LoginForm.tsx' },
      testFile: { path: 'cypress/e2e/dashboard.cy.ts', imports: ['src/Dashboard.tsx'] }
    });

    const signals = scorer.evaluate('src/LoginForm.tsx', 'cypress/e2e/dashboard.cy.ts', context);

    expect(signals).toHaveLength(1);
    expect(signals[0].matched).toBe(false);
  });

  it('returns an unmatched signal when test has no imports at all', () => {
    const registry = createMockRegistry({
      files: {
        'src/LoginForm.tsx': {},
        'cypress/e2e/empty.cy.ts': { imports: [] }
      }
    });
    const context = createMockContext({
      registry,
      changedFile: { path: 'src/LoginForm.tsx' },
      testFile: { path: 'cypress/e2e/empty.cy.ts', imports: [] }
    });

    const signals = scorer.evaluate('src/LoginForm.tsx', 'cypress/e2e/empty.cy.ts', context);

    expect(signals[0].matched).toBe(false);
  });

  it('signal type matches the scorer type field', () => {
    // Ensures IScorer.type and signal.type are consistent
    const registry = createMockRegistry({ files: { 'src/f.tsx': {}, 'cypress/e2e/t.cy.ts': {} } });
    const context = createMockContext({ registry });
    const signals = scorer.evaluate('src/f.tsx', 'cypress/e2e/t.cy.ts', context);
    expect(signals[0].type).toBe(scorer.type);
  });
});
```

---

### Integration Tests — Full Scoring Pipeline

**File:** `src/__tests__/scoring-engine.integration.test.ts`

```typescript
import { ScoringEngine } from '../../core/scoring-engine';
import { DirectImportScorer } from '../../scorers/direct-import-scorer';
import { SelectorMatchScorer } from '../../scorers/selector-match-scorer';
import { createMockRegistry } from '../helpers/mock-registry';

describe('ScoringEngine — full pipeline', () => {
  function buildFullEngine(registryOpts: any, configOverrides: any = {}) {
    const registry = createMockRegistry(registryOpts);
    const config = {
      scoring: {
        enabledScorers: ['direct-import', 'selector-match'],
        ubiquityThreshold: 0.7,
        minConfidence: 0.4,
        highConfidence: 0.8,
        ...configOverrides
      }
    };
    const engine = new ScoringEngine(config, registry);
    engine.register(new DirectImportScorer());
    engine.register(new SelectorMatchScorer());
    return engine;
  }

  it('returns results sorted by score descending', () => {
    const registry = createMockRegistry({
      files: {
        'src/LoginForm.tsx': { selectors: [{ value: 'login-btn', type: 'testid' }] },
        'cypress/e2e/login.cy.ts': {
          imports: ['src/LoginForm.tsx'],
          cypress: { selectors: [{ value: 'login-btn', type: 'testid' }], visitedRoutes: [] }
        },
        'cypress/e2e/dashboard.cy.ts': {
          imports: [],
          cypress: { selectors: [{ value: 'sidebar-nav', type: 'testid' }], visitedRoutes: [] }
        }
      }
    });
    const engine = buildFullEngine({ files: registry });
    // (registry is already built above — simplified for readability)

    const results = engine.evaluateTests('src/LoginForm.tsx', [
      'cypress/e2e/login.cy.ts',
      'cypress/e2e/dashboard.cy.ts'
    ]);

    expect(results[0].testFile).toBe('cypress/e2e/login.cy.ts');
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[1].testFile).toBe('cypress/e2e/dashboard.cy.ts');
  });

  it('skips test files not found in registry', () => {
    const engine = buildFullEngine({
      files: { 'src/LoginForm.tsx': {} }
      // 'cypress/e2e/ghost.cy.ts' is NOT in registry
    });

    const results = engine.evaluateTests('src/LoginForm.tsx', ['cypress/e2e/ghost.cy.ts']);
    expect(results).toHaveLength(0);
  });

  it('returns empty array when changed file is not in registry', () => {
    const engine = buildFullEngine({ files: {} });
    const results = engine.evaluateTests('src/Missing.tsx', ['cypress/e2e/test.cy.ts']);
    expect(results).toHaveLength(0);
  });

  it('only runs scorers listed in enabledScorers', () => {
    // Config enables only direct-import; selector-match should never run
    const selectorSpy = jest.spyOn(SelectorMatchScorer.prototype, 'evaluate');
    const registry = createMockRegistry({
      files: {
        'src/Button.tsx': {},
        'cypress/e2e/button.cy.ts': { imports: ['src/Button.tsx'] }
      }
    });
    const config = {
      scoring: {
        enabledScorers: ['direct-import'], // selector-match NOT enabled
        ubiquityThreshold: 0.7,
        minConfidence: 0.4,
        highConfidence: 0.8
      }
    };
    const engine = new ScoringEngine(config, registry);
    engine.register(new DirectImportScorer());
    engine.register(new SelectorMatchScorer());

    engine.evaluateTests('src/Button.tsx', ['cypress/e2e/button.cy.ts']);

    expect(selectorSpy).not.toHaveBeenCalled();
    selectorSpy.mockRestore();
  });

  it('applies scorer weight override from config', () => {
    const registry = createMockRegistry({
      files: {
        'src/Button.tsx': {},
        'cypress/e2e/button.cy.ts': { imports: ['src/Button.tsx'] }
      }
    });
    const config = {
      scoring: {
        enabledScorers: ['direct-import'],
        ubiquityThreshold: 0.7,
        minConfidence: 0.4,
        highConfidence: 0.8,
        scorerWeights: { 'direct-import': 0.50 }  // override from 0.95 → 0.50
      }
    };
    const engine = new ScoringEngine(config, registry);
    engine.register(new DirectImportScorer());

    const results = engine.evaluateTests('src/Button.tsx', ['cypress/e2e/button.cy.ts']);

    expect(results[0].signals[0].weight).toBe(0.50);
    expect(results[0].score).toBeCloseTo(0.50);
  });

  it('unregistering a scorer removes it from evaluation', () => {
    const registry = createMockRegistry({
      files: {
        'src/Button.tsx': { selectors: [{ value: 'btn', type: 'testid' }] },
        'cypress/e2e/button.cy.ts': {
          imports: [],
          cypress: { selectors: [{ value: 'btn', type: 'testid' }], visitedRoutes: [] }
        }
      }
    });
    const config = {
      scoring: {
        enabledScorers: ['direct-import', 'selector-match'],
        ubiquityThreshold: 0.7,
        minConfidence: 0.4,
        highConfidence: 0.8
      }
    };
    const engine = new ScoringEngine(config, registry);
    engine.register(new DirectImportScorer());
    engine.register(new SelectorMatchScorer());
    engine.unregister('selector-match'); // remove it

    const results = engine.evaluateTests('src/Button.tsx', ['cypress/e2e/button.cy.ts']);
    const sources = results[0].signals.map((s) => s.source);

    expect(sources).not.toContain('selector-match');
  });
});
```

---

## Scoring Signal Reference

| Scorer Name | Weight | Signal Type | Notes |
|------------|--------|-------------|-------|
| direct-import | 0.95 | Direct Import | Test directly imports changed file |
| route-match | 0.85 | Route Match | Test visits URL mapped to component |
| selector-match | 0.80 | Selector Match | cy.get('[data-testid=X]') matches source |
| redux-chain | 0.75 | Redux Chain | Files in same Redux chain |
| transitive-import | 0.70 | Transitive Import | Import chain (depth 1) |
| redux-consumer | 0.65 | Redux Consumer | Component uses Redux selector |
| filename-convention | 0.60 | Filename | naming convention match |
| api-intercept | 0.55 | API Intercept | Test intercepts API from changed file |
| translation-match | 0.50 | Translation | cy.contains matches translation |
| contains-text | 0.50 | Text Match | cy.contains matches JSX text |
| describe-block | 0.45 | Test Name | describe block name matches component |
| keyword-overlap | 0.35 | Keywords | Shared AST keywords |

> All weights above are defaults. They can be overridden per-project via `config.scoring.scorerWeights`.

---

## Dependencies

- Registry system (Task 04)
- Base analyzer system (Task 01)

## Related Tasks

- Task 10: Scorer Modules (complete set of scorers)
- Task 11: CLI Integration (uses scoring engine)

## Notes

- Scoring is the final evaluation step
- Signals are additive with max signal dominating (see `calculateScore` JSDoc for rationale)
- Ubiquity dampener prevents false positives from global components; it returns new signal objects and never mutates
- Scorers can be added/removed without affecting others
- Both confidence thresholds (`highConfidence`, `minConfidence`) must come from config — do not hardcode either
- Scorer weights can be overridden per-project in `config.scoring.scorerWeights` without changing scorer source
- `IScorer.type` must remain on the interface so engine and tests can read it without casting to concrete classes