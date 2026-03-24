# Task 10: Scorer Modules

## Overview

Create a comprehensive set of scorer modules that implement various scoring signals. These scorers plug into the scoring engine and evaluate test relevance based on different heuristics.

## Available Scorers

### 1. Direct Import Scorer (0.95)
**Weight:** 0.95  
**Signal Type:** `direct-import`

Evaluates if the test file directly imports the changed file.

```typescript
import { BaseScorer } from './base';

export class DirectImportScorer extends BaseScorer {
  constructor() {
    super({
      name: 'direct-import',
      version: '1.0.0',
      description: 'Scores based on direct imports between test and source',
      weight: 0.95
    });
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry } = context;
    
    const isDirectImport = (testEntry.imports || []).includes(changedFile);
    
    return [{
      source: this.name,
      type: 'direct-import',
      weight: this.weight,
      matched: isDirectImport,
      reason: isDirectImport ? 'Test directly imports this file' : 'No direct import',
      metadata: { changedFile, testFile }
    }];
  }
}
```

### 2. Route Match Scorer (0.85)
**Weight:** 0.85  
**Signal Type:** `route-match`

Evaluates if the test visits a route that maps to a component containing the changed file.

```typescript
export class RouteMatchScorer extends BaseScorer {
  constructor() {
    super({
      name: 'route-match',
      version: '1.0.0',
      description: 'Scores based on visited routes matching component paths',
      weight: 0.85
    });
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, registry } = context;
    const visitedRoutes = testEntry.cypress?.visitedRoutes || [];
    const routeMap = registry.getRouteMap();

    for (const route of visitedRoutes) {
      const componentPath = routeMap.get(route);
      
      if (componentPath === changedFile) {
        return [{
          source: this.name,
          type: 'route-match',
          weight: this.weight,
          matched: true,
          reason: `Test visits ${route} which renders the changed file`,
          metadata: { changedFile, testFile, route }
        }];
      }

      // Check transitive dependencies
      if (componentPath && this.hasTransitivePath(componentPath, changedFile, registry)) {
        return [{
          source: this.name,
          type: 'route-match',
          weight: this.weight * 0.9, // Slightly lower for transitive
          matched: true,
          reason: `Test visits ${route}, component imports changed file`,
          metadata: { changedFile, testFile, route, componentPath }
        }];
      }
    }

    return [{
      source: this.name,
      type: 'route-match',
      weight: this.weight,
      matched: false,
      reason: 'Test routes do not relate to changed file'
    }];
  }

  private hasTransitivePath(from: string, to: string, registry: IRegistry): boolean {
    // Check if 'from' imports 'to' at any depth
    const checked = new Set<string>();
    const queue: string[] = [from];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (checked.has(current)) continue;
      checked.add(current);

      const deps = registry.getDependencies(current);
      if (deps.has(to)) return true;

      queue.push(...Array.from(deps));
    }

    return false;
  }
}
```

### 3. Selector Match Scorer (0.80)
**Weight:** 0.80  
**Signal Type:** `selector-match`

Evaluates if test selectors (data-testid, data-cy) match source selectors.

```typescript
export class SelectorMatchScorer extends BaseScorer {
  constructor() {
    super({
      name: 'selector-match',
      version: '1.0.0',
      description: 'Scores based on selector matches between test and source',
      weight: 0.80
    });
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, changedFile: changedEntry } = context;
    
    const testSelectors = testEntry.cypress?.selectors || [];
    const sourceSelectors = changedEntry.selectors || [];

    // Build index of source selector values
    const sourceValues = new Set(sourceSelectors.map((s) => s.value));

    // Find matching selectors
    const matches: string[] = [];
    for (const testSel of testSelectors) {
      if ((testSel.type === 'testid' || testSel.type === 'data-cy') && sourceValues.has(testSel.value)) {
        matches.push(testSel.value);
      }
    }

    return [{
      source: this.name,
      type: 'selector-match',
      weight: this.weight,
      matched: matches.length > 0,
      reason: matches.length > 0 
        ? `Matching selectors: ${matches.join(', ')}`
        : 'No matching selectors',
      metadata: { changedFile, testFile, matchedSelectors: matches }
    }];
  }
}
```

### 4. Redux Chain Scorer (0.75)
**Weight:** 0.75  
**Signal Type:** `redux-chain`

Evaluates if changed file and a file tested by the test are in the same Redux chain.

```typescript
export class ReduxChainScorer extends BaseScorer {
  constructor() {
    super({
      name: 'redux-chain',
      version: '1.0.0',
      description: 'Scores based on Redux chain relationships',
      weight: 0.75
    });
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { changedFile: changedEntry, registry } = context;
    const reduxChains = registry.getReduxChains();

    // Find the chain that contains the changed file
    for (const [sliceName, chain] of reduxChains) {
      const isInChain = Object.values(chain.files).includes(changedFile);
      if (!isInChain) continue;

      // Check if test file tests any file in this chain or consumer
      const testImports = this.getTestTestedFiles(testFile, registry);
      
      for (const testedFile of testImports) {
        // Check if tested file is in the same chain
        const testedInChain = Object.values(chain.files).includes(testedFile);
        if (testedInChain) {
          return [{
            source: this.name,
            type: 'redux-chain',
            weight: this.weight,
            matched: true,
            reason: `Both files are in Redux chain "${sliceName}"`,
            metadata: { changedFile, testFile, sliceName, testedFile }
          }];
        }

        // Check if tested file is a consumer of this chain
        if (chain.consumers.includes(testedFile)) {
          return [{
            source: this.name,
            type: 'redux-chain',
            weight: this.weight * 0.85, // Slightly lower for consumer
            matched: true,
            reason: `Tested file uses Redux chain "${sliceName}"`,
            metadata: { changedFile, testFile, sliceName, testedFile }
          }];
        }
      }
    }

    return [{
      source: this.name,
      type: 'redux-chain',
      weight: this.weight,
      matched: false,
      reason: 'No Redux chain relationship'
    }];
  }

  private getTestTestedFiles(testFile: string, registry: IRegistry): string[] {
    // Return files that the test actually tests
    // This could be derived from import graph or test metadata
    return Array.from(registry.getDependencies(testFile));
  }
}
```

### 5. Transitive Import Scorer (0.70)
**Weight:** 0.70  
**Signal Type:** `transitive-import`

Evaluates if test imports a file that imports the changed file (depth 1).

```typescript
export class TransitiveImportScorer extends BaseScorer {
  constructor() {
    super({
      name: 'transitive-import',
      version: '1.0.0',
      description: 'Scores based on transitive imports (depth 1)',
      weight: 0.70
    });
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, registry } = context;
    
    const testImports = testEntry.imports || [];
    
    // Check if any test import imports the changed file
    for (const importPath of testImports) {
      const deps = registry.getDependencies(importPath);
      if (deps.has(changedFile)) {
        return [{
          source: this.name,
          type: 'transitive-import',
          weight: this.weight,
          matched: true,
          reason: `Test imports ${importPath}, which imports ${changedFile}`,
          metadata: { changedFile, testFile, intermediate: importPath }
        }];
      }
    }

    return [{
      source: this.name,
      type: 'transitive-import',
      weight: this.weight,
      matched: false,
      reason: 'No transitive import'
    }];
  }
}
```

### 6. Redux Consumer Scorer (0.65)
**Weight:** 0.65  
**Signal Type:** `redux-consumer`

Evaluates if test covers a component that uses selectors/actions from the changed Redux chain.

```typescript
export class ReduxConsumerScorer extends BaseScorer {
  constructor() {
    super({
      name: 'redux-consumer',
      version: '1.0.0',
      description: 'Scores based on Redux selector/action usage',
      weight: 0.65
    });
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { changedFile: changedEntry, registry } = context;
    const reduxChains = registry.getReduxChains();

    // Find which chain the changed file belongs to
    for (const [sliceName, chain] of reduxChains) {
      const isInChain = Object.values(chain.files).includes(changedFile);
      if (!isInChain) continue;

      // Find consumers of this chain
      const consumers = chain.consumers;

      // Check if test visits routes for any consumer
      const testEntry = registry.getFile(testFile);
      const visitedRoutes = testEntry?.cypress?.visitedRoutes || [];
      const routeMap = registry.getRouteMap();

      for (const route of visitedRoutes) {
        const componentPath = routeMap.get(route);
        if (componentPath && consumers.includes(componentPath)) {
          return [{
            source: this.name,
            type: 'redux-consumer',
            weight: this.weight,
            matched: true,
            reason: `Test visits ${route}, component uses Redux chain "${sliceName}"`,
            metadata: { changedFile, testFile, sliceName, route, consumer: componentPath }
          }];
        }
      }
    }

    return [{
      source: this.name,
      type: 'redux-consumer',
      weight: this.weight,
      matched: false,
      reason: 'No Redux consumer relationship'
    }];
  }
}
```

### 7. Selector ID Match Scorer (0.65)
**Weight:** 0.65  
**Signal Type:** `selector-id-match`

Evaluates if test selectors match source `id` attributes.

```typescript
export class SelectorIdMatchScorer extends BaseScorer {
  constructor() {
    super({
      name: 'selector-id-match',
      version: '1.0.0',
      description: 'Scores based on ID selector matches',
      weight: 0.65
    });
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, changedFile: changedEntry } = context;
    
    const testSelectors = testEntry.cypress?.selectors || [];
    const sourceSelectors = changedEntry.selectors || [];

    // Find ID selectors in test
    const testIdSelectors = testSelectors.filter((s) => s.type === 'id');
    const sourceIds = sourceSelectors.filter((s) => s.attr === 'id');

    const matches: string[] = [];
    for (const testSel of testIdSelectors) {
      if (sourceIds.some((s) => s.value === testSel.value)) {
        matches.push(testSel.value);
      }
    }

    return [{
      source: this.name,
      type: 'selector-id-match',
      weight: this.weight,
      matched: matches.length > 0,
      reason: matches.length > 0 
        ? `Matching IDs: ${matches.join(', ')}`
        : 'No ID matches',
      metadata: { changedFile, testFile, matchedIds: matches }
    }];
  }
}
```

### 8. Filename Convention Scorer (0.60)
**Weight:** 0.60  
**Signal Type:** `filename-match`

Evaluates naming convention match (e.g., `LoginPage.tsx` ↔ `login.cy.ts`).

```typescript
export class FilenameConventionScorer extends BaseScorer {
  constructor() {
    super({
      name: 'filename-match',
      version: '1.0.0',
      description: 'Scores based on filename naming conventions',
      weight: 0.60
    });
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const changedBasename = path.basename(changedFile)
      .replace(/\.(tsx?|jsx?)$/, '.cy.ts');
    
    const testBasename = path.basename(testFile);

    const matches = changedBasename === testBasename;

    return [{
      source: this.name,
      type: 'filename-match',
      weight: this.weight,
      matched: matches,
      reason: matches 
        ? `Filename convention match: ${changedBasename}`
        : 'No filename match',
      metadata: { changedFile, testFile, changedBasename, testBasename }
    }];
  }
}
```

### 9. API Intercept Scorer (0.55)
**Weight:** 0.55  
**Signal Type:** `api-intercept`

Evaluates if test intercepts an API route served by the changed file.

```typescript
export class APIInterceptScorer extends BaseScorer {
  constructor() {
    super({
      name: 'api-intercept',
      version: '1.0.0',
      description: 'Scores based on API intercept matches',
      weight: 0.55
    });
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, changedFile: changedEntry } = context;
    
    const interceptedAPIs = testEntry.cypress?.interceptedAPIs || [];

    // Check if changed file is an API handler/route
    const isAPIFile = this.isAPIFile(changedFile);
    
    if (!isAPIFile) {
      return [{
        source: this.name,
        type: 'api-intercept',
        weight: this.weight,
        matched: false,
        reason: 'Not an API file'
      }];
    }

    // Check if any intercepted API matches
    for (const api of interceptedAPIs) {
      if (this.apiMatchesFile(api.urlPattern, changedFile, registry)) {
        return [{
          source: this.name,
          type: 'api-intercept',
          weight: this.weight,
          matched: true,
          reason: `Test intercepts ${api.method} ${api.urlPattern}`,
          metadata: { changedFile, testFile, api }
        }];
      }
    }

    return [{
      source: this.name,
      type: 'api-intercept',
      weight: this.weight,
      matched: false,
      reason: 'No API intercept match'
    }];
  }

  private isAPIFile(filePath: string): boolean {
    return filePath.includes('/api/') || 
           filePath.includes('/routes/') || 
           filePath.includes('/handlers/');
  }

  private apiMatchesFile(urlPattern: string, filePath: string, registry: IRegistry): boolean {
    // Implementation would match URL pattern to API file
    return false;
  }
}
```

### 10. Translation Match Scorer (0.50)
**Weight:** 0.50  
**Signal Type:** `translation-match`

Evaluates if test's `cy.contains()` text matches a translation key used in source.

```typescript
export class TranslationMatchScorer extends BaseScorer {
  constructor() {
    super({
      name: 'translation-match',
      version: '1.0.0',
      description: 'Scores based on translation text matches',
      weight: 0.50
    });
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, changedFile: changedEntry, registry } = context;
    
    const containsText = testEntry.cypress?.containsText || [];
    const translationKeys = changedEntry.translationKeys || [];
    const translationIndex = registry.getTranslationIndex();

    for (const text of containsText) {
      const keys = translationIndex.textToKeys.get(text) || [];
      
      for (const key of keys) {
        if (translationKeys.includes(key)) {
          return [{
            source: this.name,
            type: 'translation-match',
            weight: this.weight,
            matched: true,
            reason: `Test contains "${text}" which maps to "${key}"`,
            metadata: { changedFile, testFile, text, key }
          }];
        }
      }
    }

    return [{
      source: this.name,
      type: 'translation-match',
      weight: this.weight,
      matched: false,
      reason: 'No translation matches'
    }];
  }
}
```

### 11. Contains Text Scorer (0.50)
**Weight:** 0.50  
**Signal Type:** `contains-text-match`

Evaluates if test's `cy.contains()` text matches JSX text in source.

```typescript
export class ContainsTextScorer extends BaseScorer {
  constructor() {
    super({
      name: 'contains-text-match',
      version: '1.0.0',
      description: 'Scores based on text content matches',
      weight: 0.50
    });
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, changedFile: changedEntry } = context;
    
    const containsText = testEntry.cypress?.containsText || [];
    const jsxTextContent = changedEntry.jsxTextContent || [];

    const matches: string[] = [];
    for (const text of containsText) {
      if (jsxTextContent.some((jsx) => this.textMatches(jsx, text))) {
        matches.push(text);
      }
    }

    return [{
      source: this.name,
      type: 'contains-text-match',
      weight: this.weight,
      matched: matches.length > 0,
      reason: matches.length > 0 
        ? `Matching text: ${matches.join(', ')}`
        : 'No text matches',
      metadata: { changedFile, testFile, matchedText: matches }
    }];
  }

  private textMatches(jsxText: string, containsText: string): boolean {
    // Simple exact match or substring match
    return jsxText.toLowerCase().includes(containsText.toLowerCase());
  }
}
```

## Scorer Registration

```typescript
import { ScoringEngine } from './core/scoring-engine';
import * as scorers from './scorers';

export function registerAllScorers(engine: ScoringEngine): void {
  engine.register(new scorers.DirectImportScorer());
  engine.register(new scorers.RouteMatchScorer());
  engine.register(new scorers.SelectorMatchScorer());
  engine.register(new scorers.ReduxChainScorer());
  engine.register(new scorers.TransitiveImportScorer());
  engine.register(new scorers.ReduxConsumerScorer());
  engine.register(new scorers.SelectorIdMatchScorer());
  engine.register(new scorers.FilenameConventionScorer());
  engine.register(new scorers.APIInterceptScorer());
  engine.register(new scorers.TranslationMatchScorer());
  engine.register(new scorers.ContainsTextScorer());
}
```

## Scoring Weights Summary

| Scorer | Weight | Signal Type | Applies To |
|--------|--------|-------------|------------|
| Direct Import | 0.95 | direct-import | Unit/Integration |
| Route Match | 0.85 | route-match | E2E |
| Selector Match | 0.80 | selector-match | E2E |
| Redux Chain | 0.75 | redux-chain | All |
| Transitive Import | 0.70 | transitive-import | Unit/Integration |
| Redux Consumer | 0.65 | redux-consumer | E2E |
| Selector ID Match | 0.65 | selector-id-match | E2E |
| Filename Match | 0.60 | filename-match | E2E |
| API Intercept | 0.55 | api-intercept | E2E |
| Translation Match | 0.50 | translation-match | E2E |
| Contains Text | 0.50 | contains-text-match | E2E |

## Dependencies

- BaseScorer class (Task 05)
- Registry system (Task 04)
- Analyzer results (Tasks 02, 03, 06, 07, 08, 09)

## Related Tasks

- Task 05: Scoring Engine
- Task 02: Source Extractor Analyzer
- Task 03: Cypress Extractor Analyzer

## Notes

- Scorers are fully plug-and-play
- Each scorer operates independently
- Scoring engine aggregates signals from all enabled scorers
- New scorers can be added without modifying existing code