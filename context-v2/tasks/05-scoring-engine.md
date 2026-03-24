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
  weight: number;
  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[];
}

export interface IScorerContext {
  registry: IRegistry;
  config: ISuggestorConfig;
  changedFile: IFileEntry;
  testFile: IFileEntry;
}
```

## Implementation

### 1. Create Scoring Engine

**File:** `src/core/scoring-engine.ts`

```typescript
import {
  ISignal,
  IScoreResult,
  IScorer,
  IScorerContext,
  IRegistry,
  IFileEntry,
  ISuggestorConfig
} from './types';

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
      for (const scorer of this.scorers.values()) {
        if (this.config.scoring.enabledScorers.includes(scorer.name)) {
          const scorerSignals = scorer.evaluate(changedFile, testFilePath, context);
          signals.push(...scorerSignals);
        }
      }

      // Apply ubiquity dampener
      this.applyUbiquityDampener(changedFile, signals);

      // Calculate final score
      const score = this.calculateScore(signals);

      // Calculate confidence
      const confidence = this.calculateConfidence(score);

      // Generate explanation
      const explanation = this.generateExplanation(signals, score);

      results.push({
        testFile: testFilePath,
        score,
        signals,
        confidence,
        explanation
      });
    }

    // Sort by score (descending)
    return results.sort((a, b) => b.score - a.score);
  }

  private calculateScore(signals: ISignal[]): number {
    if (signals.length === 0) {
      return 0;
    }

    // Extract signal weights
    const signalScores = signals.map((s) => s.weight * (s.matched ? 1 : 0));

    // Aggregation formula:
    // finalScore = max(allSignalScores) + min(sum(otherScores) * 0.1, 0.05)
    const maxScore = Math.max(...signalScores);
    const sumOthers = signalScores.reduce((sum, score) => sum + (score < maxScore ? score : 0), 0);
    const tiebreaker = Math.min(sumOthers * 0.1, 0.05);

    const finalScore = maxScore + tiebreaker;

    return Math.min(finalScore, 1.0);
  }

  private calculateConfidence(score: number): 'high' | 'medium' | 'low' {
    const minConfidence = this.config.scoring.minConfidence || 0.4;

    if (score >= 0.8) {
      return 'high';
    } else if (score >= minConfidence) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  private generateExplanation(signals: ISignal[], score: number): string {
    const matchedSignals = signals.filter((s) => s.matched).sort((a, b) => b.weight - a.weight);

    if (matchedSignals.length === 0) {
      return 'No strong signals detected';
    }

    const topSignals = matchedSignals.slice(0, 3);
    const signalDescriptions = topSignals
      .map((s) => `${s.reason || s.type} (${(s.weight * 100).toFixed(0)}%)`)
      .join(', ');

    return `Matched by: ${signalDescriptions}. Score: ${score.toFixed(2)}`;
  }

  private applyUbiquityDampener(changedFile: string, signals: ISignal[]): void {
    const ubiquityThreshold = this.config.scoring.ubiquityThreshold || 0.7;
    const changedFileEntry = this.registry.getFile(changedFile);

    if (!changedFileEntry) return;

    // Calculate ubiquity: how many files import this file?
    const dependents = this.registry.getDependents(changedFile);
    const sourceFiles = this.registry.getFilesByType('source');
    const ubiquity = dependents.length / sourceFiles.length;

    if (ubiquity > ubiquityThreshold) {
      // Dampen all signals by 0.3
      for (const signal of signals) {
        if (signal.matched) {
          signal.weight *= 0.3;
          signal.reason = `${signal.reason || 'Unknown'} (ubiquitous component)`;
        }
      }
    }
  }
}
```

### 2. Create Base Scorer Class

**File:** `src/scorers/base.ts`

```typescript
import { IScorer, IScorerContext, ISignal } from '../core/types';

export abstract class BaseScorer implements IScorer {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly weight: number;

  constructor(config: {
    name: string;
    version: string;
    description: string;
    weight: number;
  }) {
    this.name = config.name;
    this.version = config.version;
    this.description = config.description;
    this.weight = config.weight;
  }

  abstract evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[];

  protected createSignal(
    matched: boolean,
    reason?: string,
    metadata?: any
  ): ISignal {
    return {
      source: this.name,
      type: this.type,
      weight: this.weight,
      matched,
      metadata,
      reason
    };
  }

  protected abstract get type(): string;
}
```

### 3. Create Example Scorer - Direct Import Scorer

**File:** `src/scorers/direct-import-scorer.ts`

```typescript
import { BaseScorer } from './base';
import { IScorerContext, ISignal } from '../core/types';

export class DirectImportScorer extends BaseScorer {
  constructor() {
    super({
      name: 'direct-import',
      version: '1.0.0',
      description: 'Scores based on direct imports between test and source',
      weight: 0.95
    });
  }

  protected get type(): string {
    return 'direct-import';
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, registry } = context;

    // Check if test file directly imports the changed file
    const testImports = testEntry.imports || [];
    const isDirectImport = testImports.includes(changedFile);

    if (isDirectImport) {
      return [
        this.createSignal(
          true,
          `Test directly imports ${changedFile}`,
          { changedFile, testFile, importType: 'direct' }
        )
      ];
    }

    return [
      this.createSignal(
        false,
        'Test does not directly import this file',
        { changedFile, testFile, importType: 'direct' }
      )
    ];
  }
}
```

### 4. Create Example Scorer - Route Match Scorer

**File:** `src/scorers/route-match-scorer.ts`

```typescript
import { BaseScorer } from './base';
import { IScorerContext, ISignal } from '../core/types';

export class RouteMatchScorer extends BaseScorer {
  constructor() {
    super({
      name: 'route-match',
      version: '1.0.0',
      description: 'Scores based on visited routes matching component paths',
      weight: 0.85
    });
  }

  protected get type(): string {
    return 'route-match';
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, changedFile: changedEntry, registry } = context;

    // Get visited routes from test file
    const visitedRoutes = testEntry.cypress?.visitedRoutes || [];
    if (visitedRoutes.length === 0) {
      return [this.createSignal(false, 'No routes visited')];
    }

    // Get route map from registry
    const routeMap = registry.getRouteMap();

    for (const route of visitedRoutes) {
      const componentPath = routeMap.get(route);

      // Check if changed file is the route component or imports it
      if (componentPath === changedFile) {
        return [
          this.createSignal(
            true,
            `Test visits ${route} which renders ${changedFile}`,
            { changedFile, testFile, route, componentPath }
          )
        ];
      }

      // Check transitive: does changed file import into the route component?
      if (componentPath) {
        const transitiveDeps = this.findTransitiveDependencies(componentPath, changedFile, registry);
        if (transitiveDeps) {
          return [
            this.createSignal(
              true,
              `Test visits ${route}, component ${componentPath} imports ${changedFile} (depth ${transitiveDeps})`,
              { changedFile, testFile, route, componentPath, depth: transitiveDeps }
            )
          ];
        }
      }
    }

    return [
      this.createSignal(
        false,
        `Test routes do not relate to ${changedFile}`,
        { changedFile, testFile, visitedRoutes }
      )
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
    if (deps.has(targetPath)) {
      return depth;
    }

    for (const dep of deps) {
      const result = this.findTransitiveDependencies(dep, targetPath, registry, depth + 1, maxDepth);
      if (result !== null) {
        return result;
      }
    }

    return null;
  }
}
```

### 5. Create Example Scorer - Selector Match Scorer

**File:** `src/scorers/selector-match-scorer.ts`

```typescript
import { BaseScorer } from './base';
import { IScorerContext, ISignal } from '../core/types';

export class SelectorMatchScorer extends BaseScorer {
  constructor() {
    super({
      name: 'selector-match',
      version: '1.0.0',
      description: 'Scores based on selector (testid, data-cy) matches between test and source',
      weight: 0.80
    });
  }

  protected get type(): string {
    return 'selector-match';
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, changedFile: changedEntry, registry } = context;

    // Get test selectors
    const testSelectors = testEntry.cypress?.selectors || [];
    if (testSelectors.length === 0) {
      return [this.createSignal(false, 'No selectors in test')];
    }

    // Get source selectors from changed file
    const sourceSelectors = changedEntry.selectors || [];
    if (sourceSelectors.length === 0) {
      return [this.createSignal(false, 'No selectors in source file')];
    }

    // Build index of source selectors
    const sourceSelectorValues = new Set(sourceSelectors.map((s) => s.value));

    // Find matching selectors
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
        this.createSignal(
          true,
          `Test selectors match: ${matches.join(', ')}`,
          { changedFile, testFile, matchedSelectors: matches }
        )
      ];
    }

    return [
      this.createSignal(
        false,
        'No matching selectors',
        { changedFile, testFile, testSelectors, sourceSelectors: sourceSelectorValues }
      )
    ];
  }
}
```

## Usage Example

```typescript
import { ScoringEngine } from './core/scoring-engine';
import { DirectImportScorer } from './scorers/direct-import-scorer';
import { RouteMatchScorer } from './scorers/route-match-scorer';
import { SelectorMatchScorer } from './scorers/selector-match-scorer';

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
//     score: 0.92,
//     confidence: 'high',
//     signals: [...],
//     explanation: 'Matched by: Selector Match (80%), Route Match (85%). Score: 0.92'
//   },
//   {
//     testFile: 'cypress/e2e/dashboard.cy.ts',
//     score: 0.0,
//     confidence: 'low',
//     signals: [...],
//     explanation: 'No strong signals detected'
//   }
// ]
```

## Testing Strategy

### Unit Tests

1. **Score Calculation**
   - Test max signal dominates
   - Test tiebreaker calculation
   - Test score capping at 1.0

2. **Confidence Levels**
   - Test high confidence threshold
   - Test medium confidence threshold
   - Test low confidence threshold

3. **Ubiquity Dampener**
   - Test dampener activation
   - Test weight reduction
   - Test threshold configuration

### Integration Tests

1. Test full scoring pipeline
2. Test multiple scorers working together
3. Test scorer registration/deregistration

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

## Dependencies

- Registry system (Task 04)
- Base analyzer system (Task 01)

## Related Tasks

- Task 10: Scorer Modules (complete set of scorers)
- Task 11: CLI Integration (uses scoring engine)

## Notes

- Scoring is the final evaluation step
- Signals are additive with max signal dominating
- Ubiquity dampener prevents false positives from global components
- Scorers can be added/removed without affecting others