# Task 10: Scorer Modules

## Overview

Create a comprehensive set of scorer modules that implement various scoring signals. These scorers plug into the scoring engine and evaluate test relevance based on different heuristics.

Each scorer takes a **changed source file** and a **candidate test file** and returns one or more `ISignal` objects. The scoring engine collects all signals and aggregates them into a final relevance score that determines whether a test spec should be suggested.

---

## Shared Type Contracts

Before diving into individual scorers, every scorer depends on these shared interfaces. **Any new scorer must conform to these shapes.**

```typescript
// The metadata the registry holds for every file in the project
interface IFileEntry {
  path: string;                    // Absolute or repo-root-relative path
  imports: string[];               // Direct imports (resolved absolute paths)
  selectors: ISelector[];          // data-testid / data-cy / id attrs defined in this file
  translationKeys: string[];       // i18n keys used in this file, e.g. ['auth.login.title']
  jsxTextContent: string[];        // Literal text strings inside JSX, e.g. ['Sign In', 'Cancel']
  cypress?: ICypressEntry;         // Only present for .cy.ts / .spec.ts files
}

interface ICypressEntry {
  visitedRoutes: string[];         // Routes passed to cy.visit(), e.g. ['/login', '/dashboard']
  selectors: ICypressSelector[];   // Selectors used in cy.get(), cy.findByTestId(), etc.
  interceptedAPIs: IAPIIntercept[]; // cy.intercept() calls
  containsText: string[];          // Strings passed to cy.contains()
}

interface ISelector {
  attr: string;   // 'data-testid' | 'data-cy' | 'id' | 'class'
  value: string;  // e.g. 'login-submit-btn'
}

interface ICypressSelector {
  type: 'testid' | 'data-cy' | 'id' | 'class' | 'tag';
  value: string;  // e.g. 'login-submit-btn'
}

interface IAPIIntercept {
  method: string;      // 'GET' | 'POST' | 'PUT' | 'DELETE' | '*'
  urlPattern: string;  // e.g. '/api/auth/login' or '/api/**'
}

// What is passed to every scorer's evaluate() method
interface IScorerContext {
  changedFile: IFileEntry;   // Metadata for the file that was changed
  testFile: IFileEntry;      // Metadata for the candidate test file
  registry: IRegistry;       // Full project registry
}

interface IRegistry {
  getFile(path: string): IFileEntry | undefined;
  getDependencies(path: string): Set<string>;  // Direct imports of a file
  getRouteMap(): Map<string, string>;           // route → component path
  getReduxChains(): Map<string, IReduxChain>;
  getSelectorIndex(): Map<string, string[]>;    // selectorValue → [componentPaths]
  getTranslationIndex(): ITranslationIndex;
}

interface IReduxChain {
  files: { slice?: string; actions?: string; selectors?: string; [key: string]: string | undefined };
  consumers: string[];  // Component paths that import from this chain
}

interface ITranslationIndex {
  textToKeys: Map<string, string[]>;  // 'Sign In' → ['auth.login.button']
  keyToTexts: Map<string, string[]>;  // 'auth.login.button' → ['Sign In']
}

interface ISignal {
  source: string;      // Scorer name, e.g. 'direct-import'
  type: string;        // Signal type identifier
  weight: number;      // Effective weight (may differ from scorer base weight)
  matched: boolean;    // Whether this signal fired
  reason: string;      // Human-readable explanation
  metadata?: Record<string, unknown>;
}
```

---

## Score Aggregation Contract

> **Every scorer must understand how the engine uses its signals.**

The scoring engine collects **all matched signals** for a (changedFile, testFile) pair and computes a final score using the following strategy:

```
finalScore = max(matchedSignal.weight) + bonus
```

Where `bonus` is a small additive reward for each *additional* matched signal beyond the first:
```
bonus = sum(additionalMatchedSignals.map(s => s.weight * 0.05))
```

This means:
- A single `direct-import` match → score of **0.95**
- A `direct-import` (0.95) + `selector-match` (0.80) → score of **0.95 + (0.80 × 0.05) = 0.99**
- Only a `filename-match` → score of **0.60**

**Suggestion threshold:** A spec file is suggested if `finalScore >= 0.50`.

> **Why this matters for scorers:** Scorers should not inflate their own weight trying to compensate for a weak signal. Return the correct weight and let the engine handle aggregation. Never return `matched: true` speculatively.

---

## Negative Signals

Some scorers can emit a **negative signal** to actively suppress a pairing. A negative signal reduces the final score.

```typescript
// Negative signal shape — weight is negative
{
  source: 'route-mismatch',
  type: 'negative',
  weight: -0.30,   // Applied as a penalty
  matched: true,   // true means "penalty fires"
  reason: 'Test visits /settings but changed file is in /auth/',
}
```

The engine applies penalties after computing the positive score:
```
finalScore = positiveScore + sum(negativeSignal.weight)  // weight is already negative
finalScore = Math.max(0, finalScore)                      // clamp to 0
```

Scorers that can emit negative signals are marked with ⚠️ **CAN EMIT NEGATIVE SIGNAL** in their section.

---

## Barrel File / Index Export Resolution

> **All scorers that check imports must handle barrel files.**

A barrel file is an `index.ts` that re-exports from other files:

```typescript
// components/auth/index.ts  ← barrel
export { LoginPage } from './LoginPage';
export { LogoutButton } from './LogoutButton';
```

If a test imports `components/auth/index.ts`, it is effectively importing `LoginPage.tsx` transitively. **The registry is responsible for resolving this**, but scorers must be aware:

- `DirectImportScorer` checks `testEntry.imports.includes(changedFile)` — this will **miss** barrel-mediated imports unless the registry resolves them.
- The registry's `getDependencies()` **must** flatten barrel files recursively.
- If your registry does NOT resolve barrels, the `TransitiveImportScorer` at depth 1 will catch it as a fallback.

> **Action:** Ensure `IRegistry.getDependencies()` documentation explicitly states whether barrel files are resolved. If not, add a `getResolvedDependencies()` variant.

---

## Available Scorers

### 1. Direct Import Scorer (0.95)
**Weight:** 0.95
**Signal Type:** `direct-import`
**Applies To:** Unit / Integration tests

Evaluates if the test file directly imports the changed file. This is the strongest possible signal — if a test imports the file you changed, it almost certainly exercises that file.

```typescript
import { BaseScorer } from '@v2/core/scoring/scorers/base';

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

#### ⚠️ Barrel File Caveat
If your test imports `components/auth/index.ts` and the changed file is `components/auth/LoginPage.tsx`, this scorer will return `matched: false` unless the registry resolves `index.ts` to its re-exported paths. See the **Barrel File / Index Export Resolution** section above.

#### Example: Match
```
changedFile:  src/components/auth/LoginForm.tsx
testFile:     src/components/auth/LoginForm.unit.test.ts

testEntry.imports = [
  'src/components/auth/LoginForm.tsx',   // ← direct match
  'react',
  '@testing-library/react'
]

→ matched: true, weight: 0.95
→ reason: 'Test directly imports this file'
```

#### Example: No Match
```
changedFile:  src/utils/formatDate.ts
testFile:     src/components/auth/LoginForm.unit.test.ts

testEntry.imports = [
  'src/components/auth/LoginForm.tsx',
  'react'
]

→ matched: false, weight: 0.95
→ reason: 'No direct import'
```

#### Test Cases
```typescript
describe('DirectImportScorer', () => {
  const scorer = new DirectImportScorer();

  it('returns matched=true when test imports the changed file directly', () => {
    const context = makeContext({
      testImports: ['src/components/auth/LoginForm.tsx'],
    });
    const signals = scorer.evaluate(
      'src/components/auth/LoginForm.tsx',
      'src/components/auth/LoginForm.unit.test.ts',
      context
    );
    expect(signals[0].matched).toBe(true);
    expect(signals[0].weight).toBe(0.95);
  });

  it('returns matched=false when test does not import the changed file', () => {
    const context = makeContext({
      testImports: ['src/components/dashboard/Dashboard.tsx'],
    });
    const signals = scorer.evaluate(
      'src/components/auth/LoginForm.tsx',
      'src/components/dashboard/Dashboard.unit.test.ts',
      context
    );
    expect(signals[0].matched).toBe(false);
  });

  it('returns matched=false when testEntry.imports is empty', () => {
    const context = makeContext({ testImports: [] });
    const signals = scorer.evaluate(
      'src/components/auth/LoginForm.tsx',
      'src/components/auth/LoginForm.unit.test.ts',
      context
    );
    expect(signals[0].matched).toBe(false);
  });
});
```

---

### 2. Route Match Scorer (0.85)
**Weight:** 0.85
**Signal Type:** `route-match`
**Applies To:** E2E (Cypress) tests
⚠️ **CAN EMIT NEGATIVE SIGNAL**

Evaluates if the test visits a route that maps to a component containing the changed file. A direct component match scores at full weight (0.85); a transitive match (the visited component imports the changed file) scores at 90% of that (0.765).

The BFS depth in `hasTransitivePath` is **capped at 5** to prevent runaway traversal on large dependency graphs.

```typescript
export class RouteMatchScorer extends BaseScorer {
  private static readonly MAX_DEPTH = 5;

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

      if (componentPath && this.hasTransitivePath(componentPath, changedFile, registry)) {
        return [{
          source: this.name,
          type: 'route-match',
          weight: this.weight * 0.9,
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

  // BFS with depth cap to avoid unbounded traversal on large graphs.
  // Circular deps are handled by the `checked` set.
  private hasTransitivePath(
    from: string,
    to: string,
    registry: IRegistry,
    maxDepth = RouteMatchScorer.MAX_DEPTH
  ): boolean {
    const checked = new Set<string>();
    // Queue entries are [path, currentDepth]
    const queue: [string, number][] = [[from, 0]];

    while (queue.length > 0) {
      const [current, depth] = queue.shift()!;
      if (checked.has(current)) continue;
      if (depth > maxDepth) continue;
      checked.add(current);

      const deps = registry.getDependencies(current);
      if (deps.has(to)) return true;

      for (const dep of Array.from(deps)) {
        queue.push([dep, depth + 1]);
      }
    }

    return false;
  }
}
```

#### Example: Direct Route Match
```
routeMap:
  '/login'     → 'src/pages/LoginPage.tsx'
  '/dashboard' → 'src/pages/DashboardPage.tsx'

changedFile:  src/pages/LoginPage.tsx
testFile:     cypress/e2e/auth/login.cy.ts

testEntry.cypress.visitedRoutes = ['/login']

routeMap.get('/login') === 'src/pages/LoginPage.tsx' === changedFile

→ matched: true, weight: 0.85
→ reason: 'Test visits /login which renders the changed file'
```

#### Example: Transitive Route Match
```
routeMap:
  '/login' → 'src/pages/LoginPage.tsx'

LoginPage.tsx imports LoginForm.tsx (depth 1)
LoginForm.tsx imports PasswordInput.tsx (depth 2)

changedFile:  src/components/auth/PasswordInput.tsx
testFile:     cypress/e2e/auth/login.cy.ts

testEntry.cypress.visitedRoutes = ['/login']

hasTransitivePath('src/pages/LoginPage.tsx', 'src/components/auth/PasswordInput.tsx')
  → depth 0: check LoginPage.tsx deps → [LoginForm.tsx, Header.tsx]
  → depth 1: check LoginForm.tsx deps → [PasswordInput.tsx ✓]
  → returns true

→ matched: true, weight: 0.85 * 0.9 = 0.765
→ reason: 'Test visits /login, component imports changed file'
```

#### Example: Depth Cap Hit
```
changedFile:  src/utils/deepUtil.ts  (imported at depth 8 from LoginPage)
testFile:     cypress/e2e/auth/login.cy.ts

hasTransitivePath traverses up to depth 5, never reaches deepUtil.ts

→ matched: false
→ reason: 'Test routes do not relate to changed file'
```

#### Example: No Match (Different Route Domain)
```
changedFile:  src/pages/SettingsPage.tsx
testFile:     cypress/e2e/auth/login.cy.ts

testEntry.cypress.visitedRoutes = ['/login']
routeMap.get('/login') → 'src/pages/LoginPage.tsx' ≠ changedFile
hasTransitivePath('LoginPage.tsx', 'SettingsPage.tsx') → false (different subtree)

→ matched: false
→ reason: 'Test routes do not relate to changed file'
```

#### Test Cases
```typescript
describe('RouteMatchScorer', () => {
  const scorer = new RouteMatchScorer();

  it('matches at full weight when visited route maps directly to changed file', () => {
    const registry = makeRegistry({
      routeMap: new Map([['/login', 'src/pages/LoginPage.tsx']]),
      dependencies: new Map(),
    });
    const context = makeContext({
      visitedRoutes: ['/login'],
      registry,
    });
    const signals = scorer.evaluate(
      'src/pages/LoginPage.tsx',
      'cypress/e2e/auth/login.cy.ts',
      context
    );
    expect(signals[0].matched).toBe(true);
    expect(signals[0].weight).toBe(0.85);
  });

  it('matches at 90% weight for transitive component import at depth 1', () => {
    const registry = makeRegistry({
      routeMap: new Map([['/login', 'src/pages/LoginPage.tsx']]),
      dependencies: new Map([
        ['src/pages/LoginPage.tsx', new Set(['src/components/auth/LoginForm.tsx'])],
        ['src/components/auth/LoginForm.tsx', new Set(['src/components/auth/PasswordInput.tsx'])],
      ]),
    });
    const context = makeContext({ visitedRoutes: ['/login'], registry });
    const signals = scorer.evaluate(
      'src/components/auth/LoginForm.tsx',
      'cypress/e2e/auth/login.cy.ts',
      context
    );
    expect(signals[0].matched).toBe(true);
    expect(signals[0].weight).toBeCloseTo(0.765);
  });

  it('does not match files beyond MAX_DEPTH=5', () => {
    // Build a chain: LoginPage → A → B → C → D → E → DeepUtil (depth 6)
    const registry = makeRegistry({
      routeMap: new Map([['/login', 'src/pages/LoginPage.tsx']]),
      dependencies: new Map([
        ['src/pages/LoginPage.tsx', new Set(['A'])],
        ['A', new Set(['B'])],
        ['B', new Set(['C'])],
        ['C', new Set(['D'])],
        ['D', new Set(['E'])],
        ['E', new Set(['src/utils/deepUtil.ts'])],
      ]),
    });
    const context = makeContext({ visitedRoutes: ['/login'], registry });
    const signals = scorer.evaluate(
      'src/utils/deepUtil.ts',
      'cypress/e2e/auth/login.cy.ts',
      context
    );
    expect(signals[0].matched).toBe(false);
  });

  it('handles circular dependencies without infinite loop', () => {
    const registry = makeRegistry({
      routeMap: new Map([['/login', 'A']]),
      dependencies: new Map([
        ['A', new Set(['B'])],
        ['B', new Set(['A'])], // circular
      ]),
    });
    const context = makeContext({ visitedRoutes: ['/login'], registry });
    // Should complete without hanging
    const signals = scorer.evaluate('C', 'test.cy.ts', context);
    expect(signals[0].matched).toBe(false);
  });

  it('returns no match when test has no visited routes', () => {
    const context = makeContext({ visitedRoutes: [] });
    const signals = scorer.evaluate(
      'src/pages/LoginPage.tsx',
      'cypress/e2e/auth/login.cy.ts',
      context
    );
    expect(signals[0].matched).toBe(false);
  });
});
```

---

### 3. Selector Match Scorer (0.80)
**Weight:** 0.80
**Signal Type:** `selector-match`
**Applies To:** E2E (Cypress) tests

Evaluates if test selectors (`data-testid`, `data-cy`) match selectors defined in the source file. These are the most reliable CSS selector signals because `data-testid` / `data-cy` attributes are intentionally authored for testing purposes.

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

    // Build index of source selector values (testid and data-cy only)
    const sourceValues = new Set(
      sourceSelectors
        .filter((s) => s.attr === 'data-testid' || s.attr === 'data-cy')
        .map((s) => s.value)
    );

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

#### ⚠️ Overlap with SelectorIdMatchScorer
This scorer handles `data-testid` / `data-cy`. `SelectorIdMatchScorer` handles `id`. They intentionally split responsibilities. The engine ensures deduplication by selector value at the aggregation layer so neither scorer double-counts a match.

#### Example: Match
```
changedFile:  src/components/auth/LoginForm.tsx

changedEntry.selectors = [
  { attr: 'data-testid', value: 'login-email-input' },
  { attr: 'data-testid', value: 'login-submit-btn' },
  { attr: 'class',       value: 'login-form' },         // ← not considered
]

testEntry.cypress.selectors = [
  { type: 'testid', value: 'login-email-input' },       // ← match
  { type: 'testid', value: 'login-submit-btn' },        // ← match
  { type: 'testid', value: 'forgot-password-link' },    // ← no match
]

→ matched: true, weight: 0.80
→ reason: 'Matching selectors: login-email-input, login-submit-btn'
→ metadata.matchedSelectors: ['login-email-input', 'login-submit-btn']
```

#### Example: No Match (Only Class Selectors)
```
changedFile:  src/components/ui/Button.tsx

changedEntry.selectors = [
  { attr: 'class', value: 'btn-primary' }   // ← class selectors ignored by this scorer
]

testEntry.cypress.selectors = [
  { type: 'class', value: 'btn-primary' }   // ← type 'class' is not 'testid' or 'data-cy'
]

→ matched: false
→ reason: 'No matching selectors'
```

#### Test Cases
```typescript
describe('SelectorMatchScorer', () => {
  const scorer = new SelectorMatchScorer();

  it('matches when data-testid values are shared between test and source', () => {
    const context = makeContext({
      sourceSelectors: [
        { attr: 'data-testid', value: 'login-submit-btn' },
      ],
      cypressSelectors: [
        { type: 'testid', value: 'login-submit-btn' },
      ],
    });
    const signals = scorer.evaluate('LoginForm.tsx', 'login.cy.ts', context);
    expect(signals[0].matched).toBe(true);
    expect(signals[0].metadata?.matchedSelectors).toEqual(['login-submit-btn']);
  });

  it('does not match on class selectors', () => {
    const context = makeContext({
      sourceSelectors: [{ attr: 'class', value: 'btn-primary' }],
      cypressSelectors: [{ type: 'class', value: 'btn-primary' }],
    });
    const signals = scorer.evaluate('Button.tsx', 'button.cy.ts', context);
    expect(signals[0].matched).toBe(false);
  });

  it('returns all matched selector values in metadata', () => {
    const context = makeContext({
      sourceSelectors: [
        { attr: 'data-testid', value: 'email-input' },
        { attr: 'data-testid', value: 'password-input' },
        { attr: 'data-testid', value: 'submit-btn' },
      ],
      cypressSelectors: [
        { type: 'testid', value: 'email-input' },
        { type: 'testid', value: 'submit-btn' },
      ],
    });
    const signals = scorer.evaluate('LoginForm.tsx', 'login.cy.ts', context);
    expect(signals[0].matched).toBe(true);
    expect(signals[0].metadata?.matchedSelectors).toHaveLength(2);
  });

  it('returns matched=false when source has no selectors', () => {
    const context = makeContext({
      sourceSelectors: [],
      cypressSelectors: [{ type: 'testid', value: 'login-submit-btn' }],
    });
    const signals = scorer.evaluate('LoginForm.tsx', 'login.cy.ts', context);
    expect(signals[0].matched).toBe(false);
  });
});
```

---

### 4. Redux Chain Scorer (0.75)
**Weight:** 0.75
**Signal Type:** `redux-chain`
**Applies To:** All test types

Evaluates if the changed file and a file tested by the test are in the same Redux chain. A Redux chain is a group of related files: the slice, selectors, actions, and consumer components.

Three match tiers:
1. **Same chain, direct import** → weight 0.75 (tested file is in the same chain)
2. **Consumer, direct import** → weight 0.75 × 0.85 = 0.6375 (tested file is a consumer)
3. **E2E fallback via selector** → weight 0.75 × 0.90 = 0.675 (component linked via testid)

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

    for (const [sliceName, chain] of reduxChains) {
      const isInChain = Object.values(chain.files).includes(changedFile);
      if (!isInChain) continue;

      const testImports = this.getTestTestedFiles(testFile, registry);

      for (const testedFile of testImports) {
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

        if (chain.consumers.includes(testedFile)) {
          return [{
            source: this.name,
            type: 'redux-chain',
            weight: this.weight * 0.85,
            matched: true,
            reason: `Tested file uses Redux chain "${sliceName}"`,
            metadata: { changedFile, testFile, sliceName, testedFile }
          }];
        }
      }

      // E2E fallback: use selectors to find consumers
      const testEntry = registry.getFile(testFile);
      const testSelectors = testEntry?.cypress?.selectors || [];
      const selectorIndex = registry.getSelectorIndex();

      for (const testSel of testSelectors) {
        if (testSel.type !== 'testid' && testSel.type !== 'data-cy') continue;

        const componentPaths = selectorIndex.get(testSel.value);
        if (!componentPaths) continue;

        for (const compPath of componentPaths) {
          if (chain.consumers.includes(compPath)) {
            return [{
              source: this.name,
              type: 'redux-chain',
              weight: this.weight * 0.90,
              matched: true,
              reason: `E2E test uses selector '${testSel.value}' found in Redux consumer "${compPath}"`,
              metadata: { changedFile, testFile, sliceName, testedFile: compPath, selector: testSel.value }
            }];
          }
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
    return Array.from(registry.getDependencies(testFile));
  }
}
```

#### Example: Same Chain Match (Unit Test)
```
Redux chain "auth":
  files: {
    slice:     'src/store/auth/authSlice.ts',
    selectors: 'src/store/auth/authSelectors.ts',
    actions:   'src/store/auth/authActions.ts',
  }
  consumers: ['src/pages/LoginPage.tsx', 'src/components/UserMenu.tsx']

changedFile:  src/store/auth/authSlice.ts      ← in chain "auth"
testFile:     src/store/auth/authSelectors.test.ts

testImports (getDependencies of testFile):
  ['src/store/auth/authSelectors.ts']           ← also in chain "auth"

→ matched: true, weight: 0.75
→ reason: 'Both files are in Redux chain "auth"'
```

#### Example: Consumer Match (Unit Test)
```
changedFile:  src/store/auth/authSlice.ts      ← in chain "auth"
testFile:     src/pages/LoginPage.test.ts

testImports: ['src/pages/LoginPage.tsx']

chain.consumers.includes('src/pages/LoginPage.tsx') → true

→ matched: true, weight: 0.75 * 0.85 = 0.6375
→ reason: 'Tested file uses Redux chain "auth"'
```

#### Example: E2E Fallback via Selector
```
changedFile:  src/store/auth/authSlice.ts       ← in chain "auth"
testFile:     cypress/e2e/auth/login.cy.ts      ← E2E, no direct imports

testEntry.cypress.selectors = [{ type: 'testid', value: 'login-submit-btn' }]

selectorIndex.get('login-submit-btn') → ['src/pages/LoginPage.tsx']
chain.consumers.includes('src/pages/LoginPage.tsx') → true

→ matched: true, weight: 0.75 * 0.90 = 0.675
→ reason: "E2E test uses selector 'login-submit-btn' found in Redux consumer 'src/pages/LoginPage.tsx'"
```

#### Test Cases
```typescript
describe('ReduxChainScorer', () => {
  const scorer = new ReduxChainScorer();

  it('matches at full weight when both changed and tested files are in the same chain', () => {
    const registry = makeRegistry({
      reduxChains: new Map([['auth', {
        files: {
          slice: 'src/store/auth/authSlice.ts',
          selectors: 'src/store/auth/authSelectors.ts',
        },
        consumers: [],
      }]]),
      dependencies: new Map([
        ['src/store/auth/authSelectors.test.ts', new Set(['src/store/auth/authSelectors.ts'])],
      ]),
    });
    const context = makeContext({ registry });
    const signals = scorer.evaluate(
      'src/store/auth/authSlice.ts',
      'src/store/auth/authSelectors.test.ts',
      context
    );
    expect(signals[0].matched).toBe(true);
    expect(signals[0].weight).toBe(0.75);
  });

  it('matches at 85% weight when tested file is a chain consumer', () => {
    const registry = makeRegistry({
      reduxChains: new Map([['auth', {
        files: { slice: 'src/store/auth/authSlice.ts' },
        consumers: ['src/pages/LoginPage.tsx'],
      }]]),
      dependencies: new Map([
        ['src/pages/LoginPage.test.ts', new Set(['src/pages/LoginPage.tsx'])],
      ]),
    });
    const context = makeContext({ registry });
    const signals = scorer.evaluate(
      'src/store/auth/authSlice.ts',
      'src/pages/LoginPage.test.ts',
      context
    );
    expect(signals[0].matched).toBe(true);
    expect(signals[0].weight).toBeCloseTo(0.6375);
  });

  it('matches via E2E selector fallback when test has no direct imports', () => {
    const registry = makeRegistry({
      reduxChains: new Map([['auth', {
        files: { slice: 'src/store/auth/authSlice.ts' },
        consumers: ['src/pages/LoginPage.tsx'],
      }]]),
      selectorIndex: new Map([['login-submit-btn', ['src/pages/LoginPage.tsx']]]),
      dependencies: new Map(),
    });
    const context = makeContext({
      registry,
      cypressSelectors: [{ type: 'testid', value: 'login-submit-btn' }],
    });
    const signals = scorer.evaluate(
      'src/store/auth/authSlice.ts',
      'cypress/e2e/auth/login.cy.ts',
      context
    );
    expect(signals[0].matched).toBe(true);
    expect(signals[0].weight).toBeCloseTo(0.675);
  });

  it('returns no match when changed file is not in any chain', () => {
    const registry = makeRegistry({
      reduxChains: new Map([['auth', {
        files: { slice: 'src/store/auth/authSlice.ts' },
        consumers: [],
      }]]),
      dependencies: new Map(),
    });
    const context = makeContext({ registry });
    const signals = scorer.evaluate(
      'src/utils/formatDate.ts',   // Not in any chain
      'cypress/e2e/auth/login.cy.ts',
      context
    );
    expect(signals[0].matched).toBe(false);
  });
});
```

---

### 5. Transitive Import Scorer (0.70)
**Weight:** 0.70
**Signal Type:** `transitive-import`
**Applies To:** Unit / Integration tests

Evaluates if the test imports a file that directly imports the changed file (depth exactly 1). This catches the case where a test exercises a parent component that uses the changed file.

**Depth is intentionally limited to 1.** Going deeper risks surfacing low-confidence matches (e.g., a shared utility used everywhere). For depth > 1, the RouteMatchScorer or ReduxChainScorer are better fits.

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

#### Example: Depth-1 Match
```
changedFile:  src/components/auth/PasswordInput.tsx
testFile:     src/components/auth/LoginForm.test.ts

testEntry.imports = ['src/components/auth/LoginForm.tsx']

registry.getDependencies('src/components/auth/LoginForm.tsx') =
  Set { 'src/components/auth/PasswordInput.tsx', 'src/components/ui/Button.tsx' }

'src/components/auth/PasswordInput.tsx' ∈ deps → true

→ matched: true, weight: 0.70
→ reason: 'Test imports src/components/auth/LoginForm.tsx, which imports src/components/auth/PasswordInput.tsx'
→ metadata.intermediate: 'src/components/auth/LoginForm.tsx'
```

#### Example: Only Depth-2 Exists (No Match)
```
changedFile:  src/hooks/useAuth.ts
testFile:     src/pages/LoginPage.test.ts

testEntry.imports = ['src/pages/LoginPage.tsx']

registry.getDependencies('src/pages/LoginPage.tsx') =
  Set { 'src/components/auth/LoginForm.tsx' }
  (LoginForm.tsx imports useAuth.ts, but that's depth 2 — not checked here)

→ matched: false
→ reason: 'No transitive import'
```

#### Test Cases
```typescript
describe('TransitiveImportScorer', () => {
  const scorer = new TransitiveImportScorer();

  it('matches at depth 1 (test → intermediate → changed)', () => {
    const registry = makeRegistry({
      dependencies: new Map([
        ['src/components/auth/LoginForm.tsx', new Set(['src/components/auth/PasswordInput.tsx'])],
      ]),
    });
    const context = makeContext({
      testImports: ['src/components/auth/LoginForm.tsx'],
      registry,
    });
    const signals = scorer.evaluate(
      'src/components/auth/PasswordInput.tsx',
      'src/components/auth/LoginForm.test.ts',
      context
    );
    expect(signals[0].matched).toBe(true);
    expect(signals[0].weight).toBe(0.70);
    expect(signals[0].metadata?.intermediate).toBe('src/components/auth/LoginForm.tsx');
  });

  it('does NOT match at depth 2', () => {
    const registry = makeRegistry({
      dependencies: new Map([
        // LoginPage → LoginForm → useAuth (depth 2 from testFile)
        ['src/pages/LoginPage.tsx', new Set(['src/components/auth/LoginForm.tsx'])],
        ['src/components/auth/LoginForm.tsx', new Set(['src/hooks/useAuth.ts'])],
      ]),
    });
    const context = makeContext({
      testImports: ['src/pages/LoginPage.tsx'],
      registry,
    });
    const signals = scorer.evaluate(
      'src/hooks/useAuth.ts',
      'src/pages/LoginPage.test.ts',
      context
    );
    expect(signals[0].matched).toBe(false);
  });

  it('returns matched=false when test has no imports', () => {
    const registry = makeRegistry({ dependencies: new Map() });
    const context = makeContext({ testImports: [], registry });
    const signals = scorer.evaluate('src/hooks/useAuth.ts', 'test.ts', context);
    expect(signals[0].matched).toBe(false);
  });

  it('stops at first match and returns immediately', () => {
    const registry = makeRegistry({
      dependencies: new Map([
        ['src/components/A.tsx', new Set(['src/utils/target.ts'])],
        ['src/components/B.tsx', new Set(['src/utils/target.ts'])],
      ]),
    });
    const context = makeContext({
      testImports: ['src/components/A.tsx', 'src/components/B.tsx'],
      registry,
    });
    const signals = scorer.evaluate('src/utils/target.ts', 'test.ts', context);
    expect(signals).toHaveLength(1);
    expect(signals[0].matched).toBe(true);
    expect(signals[0].metadata?.intermediate).toBe('src/components/A.tsx');
  });
});
```

---

### 6. Redux Consumer Scorer (0.65)
**Weight:** 0.65
**Signal Type:** `redux-consumer`
**Applies To:** E2E (Cypress) tests

Evaluates if the test visits a route that renders a component that consumes the Redux chain the changed file belongs to. This is a pure E2E-layer signal complementary to ReduxChainScorer's E2E fallback.

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
    const { registry } = context;
    const reduxChains = registry.getReduxChains();

    for (const [sliceName, chain] of reduxChains) {
      const isInChain = Object.values(chain.files).includes(changedFile);
      if (!isInChain) continue;

      const consumers = chain.consumers;
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

#### Example: Match
```
Redux chain "cart":
  files: { slice: 'src/store/cart/cartSlice.ts' }
  consumers: ['src/pages/CheckoutPage.tsx', 'src/components/CartSummary.tsx']

routeMap:
  '/checkout' → 'src/pages/CheckoutPage.tsx'

changedFile:  src/store/cart/cartSlice.ts   ← in chain "cart"
testFile:     cypress/e2e/checkout/checkout.cy.ts

testEntry.cypress.visitedRoutes = ['/checkout']

routeMap.get('/checkout') → 'src/pages/CheckoutPage.tsx'
consumers.includes('src/pages/CheckoutPage.tsx') → true

→ matched: true, weight: 0.65
→ reason: 'Test visits /checkout, component uses Redux chain "cart"'
```

#### Example: No Match (Route Not a Consumer)
```
changedFile:  src/store/cart/cartSlice.ts
testFile:     cypress/e2e/auth/login.cy.ts

testEntry.cypress.visitedRoutes = ['/login']
routeMap.get('/login') → 'src/pages/LoginPage.tsx'
consumers = ['src/pages/CheckoutPage.tsx', ...]  // LoginPage not in consumers

→ matched: false
```

#### Test Cases
```typescript
describe('ReduxConsumerScorer', () => {
  const scorer = new ReduxConsumerScorer();

  it('matches when visited route renders a Redux consumer component', () => {
    const registry = makeRegistry({
      reduxChains: new Map([['cart', {
        files: { slice: 'src/store/cart/cartSlice.ts' },
        consumers: ['src/pages/CheckoutPage.tsx'],
      }]]),
      routeMap: new Map([['/checkout', 'src/pages/CheckoutPage.tsx']]),
    });
    const context = makeContext({ registry, visitedRoutes: ['/checkout'] });
    const signals = scorer.evaluate(
      'src/store/cart/cartSlice.ts',
      'cypress/e2e/checkout/checkout.cy.ts',
      context
    );
    expect(signals[0].matched).toBe(true);
    expect(signals[0].weight).toBe(0.65);
    expect(signals[0].metadata?.consumer).toBe('src/pages/CheckoutPage.tsx');
  });

  it('returns no match when route component is not a consumer', () => {
    const registry = makeRegistry({
      reduxChains: new Map([['cart', {
        files: { slice: 'src/store/cart/cartSlice.ts' },
        consumers: ['src/pages/CheckoutPage.tsx'],
      }]]),
      routeMap: new Map([['/login', 'src/pages/LoginPage.tsx']]),
    });
    const context = makeContext({ registry, visitedRoutes: ['/login'] });
    const signals = scorer.evaluate(
      'src/store/cart/cartSlice.ts',
      'cypress/e2e/auth/login.cy.ts',
      context
    );
    expect(signals[0].matched).toBe(false);
  });
});
```

---

### 7. Selector ID Match Scorer (0.65)
**Weight:** 0.65
**Signal Type:** `selector-id-match`
**Applies To:** E2E (Cypress) tests

Evaluates if test selectors of type `id` match `id` attributes in the source file. Lower weight than `SelectorMatchScorer` because `id` attributes are general-purpose HTML attributes not specifically meant for testing, so accidental matches are more likely.

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

#### ⚠️ No Double-Count with SelectorMatchScorer
`SelectorMatchScorer` covers `data-testid` / `data-cy`. This scorer covers `id`. They operate on disjoint selector sets. However, if the engine aggregates both signals for the same file pair, the bonus scoring applies to the combined score. This is intentional — two different selector types matching gives higher confidence.

#### Example: Match
```
changedFile:  src/components/ui/Modal.tsx

changedEntry.selectors = [
  { attr: 'id', value: 'confirm-modal' },
  { attr: 'id', value: 'modal-close-btn' },
]

testEntry.cypress.selectors = [
  { type: 'id', value: 'confirm-modal' },       // ← match
  { type: 'testid', value: 'modal-overlay' },   // ← not considered by this scorer
]

→ matched: true, weight: 0.65
→ reason: 'Matching IDs: confirm-modal'
```

#### Test Cases
```typescript
describe('SelectorIdMatchScorer', () => {
  const scorer = new SelectorIdMatchScorer();

  it('matches when test id selector matches source id attribute', () => {
    const context = makeContext({
      sourceSelectors: [{ attr: 'id', value: 'confirm-modal' }],
      cypressSelectors: [{ type: 'id', value: 'confirm-modal' }],
    });
    const signals = scorer.evaluate('Modal.tsx', 'modal.cy.ts', context);
    expect(signals[0].matched).toBe(true);
    expect(signals[0].metadata?.matchedIds).toEqual(['confirm-modal']);
  });

  it('does not consider data-testid type selectors', () => {
    const context = makeContext({
      sourceSelectors: [{ attr: 'data-testid', value: 'confirm-modal' }],
      cypressSelectors: [{ type: 'id', value: 'confirm-modal' }],
    });
    // source has data-testid, not id — no match in sourceIds filter
    const signals = scorer.evaluate('Modal.tsx', 'modal.cy.ts', context);
    expect(signals[0].matched).toBe(false);
  });
});
```

---

### 8. Filename Convention Scorer (0.60)
**Weight:** 0.60
**Signal Type:** `filename-match`
**Applies To:** E2E (Cypress) tests

Evaluates naming convention match (e.g., `LoginPage.tsx` ↔ `login.cy.ts`). This scorer normalizes both filenames before comparing to handle common casing and separator variations.

**Supported conventions:**
- `LoginPage.tsx` → `loginpage.cy.ts` or `login-page.cy.ts`
- `LoginPage.tsx` → `loginpage.spec.ts` (also accepts `.spec.`)
- `useAuthHook.ts` → `useauthhook.cy.ts`

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
    const changedBasename = path.basename(changedFile).replace(/\.(tsx?|jsx?)$/, '');
    const testBasename = path.basename(testFile).replace(/\.(cy|spec)\.(ts|js)x?$/, '');

    // Normalize: lowercase and strip all non-alphanumeric characters (-, _, spaces)
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

    const normalizedChanged = normalize(changedBasename);
    const normalizedTest = normalize(testBasename);

    const matches = normalizedChanged === normalizedTest;

    return [{
      source: this.name,
      type: 'filename-match',
      weight: this.weight,
      matched: matches,
      reason: matches
        ? `Filename convention match: ${changedBasename} ↔ ${testBasename}`
        : 'No filename match',
      metadata: { changedFile, testFile, changedBasename, testBasename, normalizedChanged, normalizedTest }
    }];
  }
}
```

#### Example: Exact Normalized Match
```
changedFile:  src/pages/LoginPage.tsx
testFile:     cypress/e2e/auth/login-page.cy.ts

changedBasename = 'LoginPage'   → normalize → 'loginpage'
testBasename    = 'login-page'  → normalize → 'loginpage'

'loginpage' === 'loginpage' → true

→ matched: true, weight: 0.60
→ reason: 'Filename convention match: LoginPage ↔ login-page'
```

#### Example: .spec. Suffix
```
changedFile:  src/components/auth/LoginForm.tsx
testFile:     src/components/auth/loginform.spec.ts

changedBasename = 'LoginForm'  → normalize → 'loginform'
testBasename    = 'loginform'  → normalize → 'loginform'

→ matched: true, weight: 0.60
```

#### Example: No Match
```
changedFile:  src/components/auth/PasswordInput.tsx
testFile:     cypress/e2e/auth/login.cy.ts

changedBasename = 'PasswordInput' → normalize → 'passwordinput'
testBasename    = 'login'         → normalize → 'login'

'passwordinput' ≠ 'login'

→ matched: false
```

#### Test Cases
```typescript
describe('FilenameConventionScorer', () => {
  const scorer = new FilenameConventionScorer();

  it('matches PascalCase source to kebab-case .cy.ts test', () => {
    const context = makeContext({});
    const signals = scorer.evaluate(
      'src/pages/LoginPage.tsx',
      'cypress/e2e/login-page.cy.ts',
      context
    );
    expect(signals[0].matched).toBe(true);
  });

  it('matches PascalCase source to lowercase .spec.ts test', () => {
    const context = makeContext({});
    const signals = scorer.evaluate(
      'src/components/auth/LoginForm.tsx',
      'src/components/auth/loginform.spec.ts',
      context
    );
    expect(signals[0].matched).toBe(true);
  });

  it('does not match unrelated filenames', () => {
    const context = makeContext({});
    const signals = scorer.evaluate(
      'src/components/auth/PasswordInput.tsx',
      'cypress/e2e/auth/login.cy.ts',
      context
    );
    expect(signals[0].matched).toBe(false);
  });

  it('matches case-insensitively regardless of separator style', () => {
    // LoginPage → login_page, login-page, loginpage should all match
    for (const testName of ['login_page.cy.ts', 'login-page.cy.ts', 'loginPage.cy.ts', 'loginpage.cy.ts']) {
      const signals = scorer.evaluate(
        'src/pages/LoginPage.tsx',
        `cypress/e2e/${testName}`,
        makeContext({})
      );
      expect(signals[0].matched).toBe(true);
    }
  });
});
```

---

### 9. API Intercept Scorer (0.55)
**Weight:** 0.55
**Signal Type:** `api-intercept`
**Applies To:** E2E (Cypress) tests

Evaluates if the test intercepts an API route that is handled by the changed file. This scorer requires a functioning `apiMatchesFile` implementation — the stub must be replaced before this scorer is production-ready.

> **⚠️ Implementation Note:** The `registry` parameter was missing from the original `apiMatchesFile` call. Fixed below. The `apiMatchesFile` stub always returns `false` — you must implement URL pattern → file path resolution before enabling this scorer.

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
    const { testFile: testEntry, registry } = context;  // registry now in scope

    const interceptedAPIs = testEntry.cypress?.interceptedAPIs || [];

    if (!this.isAPIFile(changedFile)) {
      return [{
        source: this.name,
        type: 'api-intercept',
        weight: this.weight,
        matched: false,
        reason: 'Not an API file'
      }];
    }

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

  // TODO: Implement real URL pattern → file resolution.
  // Strategy: Extract route segment from urlPattern (e.g. '/api/auth/login' → 'auth/login'),
  // then check if filePath ends with that segment (e.g. 'src/api/auth/login.ts').
  private apiMatchesFile(urlPattern: string, filePath: string, registry: IRegistry): boolean {
    const routeSegment = urlPattern.replace(/^\/api\//, '').replace(/\*/g, '');
    return filePath.replace(/\.[jt]sx?$/, '').endsWith(routeSegment);
  }
}
```

#### Example: Match
```
changedFile:  src/api/auth/login.ts

interceptedAPIs = [
  { method: 'POST', urlPattern: '/api/auth/login' }
]

isAPIFile('src/api/auth/login.ts') → true (contains '/api/')

apiMatchesFile('/api/auth/login', 'src/api/auth/login.ts')
  → routeSegment = 'auth/login'
  → filePath without ext = 'src/api/auth/login'
  → endsWith('auth/login') → true

→ matched: true, weight: 0.55
→ reason: 'Test intercepts POST /api/auth/login'
```

#### Example: Not an API File
```
changedFile:  src/components/auth/LoginForm.tsx

isAPIFile('src/components/auth/LoginForm.tsx')
  → does not contain '/api/', '/routes/', '/handlers/'
  → false

→ matched: false
→ reason: 'Not an API file'
```

#### Test Cases
```typescript
describe('APIInterceptScorer', () => {
  const scorer = new APIInterceptScorer();

  it('returns matched=false immediately for non-API files', () => {
    const context = makeContext({
      cypressInterceptedAPIs: [{ method: 'POST', urlPattern: '/api/auth/login' }],
    });
    const signals = scorer.evaluate(
      'src/components/auth/LoginForm.tsx',  // Not an API file
      'cypress/e2e/auth/login.cy.ts',
      context
    );
    expect(signals[0].matched).toBe(false);
    expect(signals[0].reason).toBe('Not an API file');
  });

  it('matches when intercepted URL pattern corresponds to the changed API file', () => {
    const context = makeContext({
      cypressInterceptedAPIs: [{ method: 'POST', urlPattern: '/api/auth/login' }],
    });
    const signals = scorer.evaluate(
      'src/api/auth/login.ts',
      'cypress/e2e/auth/login.cy.ts',
      context
    );
    expect(signals[0].matched).toBe(true);
    expect(signals[0].weight).toBe(0.55);
  });

  it('returns matched=false when no intercepted APIs match the file', () => {
    const context = makeContext({
      cypressInterceptedAPIs: [{ method: 'GET', urlPattern: '/api/users/profile' }],
    });
    const signals = scorer.evaluate(
      'src/api/auth/login.ts',
      'cypress/e2e/auth/login.cy.ts',
      context
    );
    expect(signals[0].matched).toBe(false);
  });

  it('returns matched=false when test has no intercepts', () => {
    const context = makeContext({ cypressInterceptedAPIs: [] });
    const signals = scorer.evaluate(
      'src/api/auth/login.ts',
      'cypress/e2e/auth/login.cy.ts',
      context
    );
    expect(signals[0].matched).toBe(false);
  });
});
```

---

### 10. Translation Match Scorer (0.50)
**Weight:** 0.50
**Signal Type:** `translation-match`
**Applies To:** E2E (Cypress) tests

Evaluates if the test's `cy.contains()` text matches a translation key used in the source file. Text comparison is **case-insensitive and punctuation-normalized** to account for minor discrepancies between translation values and hardcoded strings.

> If a translation key is resolved, this scorer **supersedes** `ContainsTextScorer` — the engine should not apply both signals to the same (text, file) pair. See **Scorer Interaction** note below.

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
      const normalizedText = this.normalize(text);
      const keys = translationIndex.textToKeys.get(normalizedText) ||
                   translationIndex.textToKeys.get(text) || // try raw fallback
                   [];

      for (const key of keys) {
        if (translationKeys.includes(key)) {
          return [{
            source: this.name,
            type: 'translation-match',
            weight: this.weight,
            matched: true,
            reason: `Test contains "${text}" which maps to translation key "${key}"`,
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

  // Normalize for fuzzy comparison: lowercase, collapse whitespace, strip punctuation
  private normalize(text: string): string {
    return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  }
}
```

#### Example: Match
```
changedEntry.translationKeys = ['auth.login.button', 'auth.login.title']

translationIndex.textToKeys:
  'sign in'  → ['auth.login.button']
  'log in'   → ['auth.login.button']
  'welcome'  → ['common.welcome']

testEntry.cypress.containsText = ['Sign In', 'Cancel']

Iteration:
  text = 'Sign In' → normalize → 'sign in'
  textToKeys.get('sign in') → ['auth.login.button']
  translationKeys.includes('auth.login.button') → true  ← MATCH

→ matched: true, weight: 0.50
→ reason: 'Test contains "Sign In" which maps to translation key "auth.login.button"'
```

#### Example: No Match (Key Not Used in Changed File)
```
changedEntry.translationKeys = ['cart.total', 'cart.empty']

testEntry.cypress.containsText = ['Sign In']

textToKeys.get('sign in') → ['auth.login.button']
translationKeys.includes('auth.login.button') → false (cart slice, not auth)

→ matched: false
```

#### Test Cases
```typescript
describe('TranslationMatchScorer', () => {
  const scorer = new TranslationMatchScorer();

  it('matches when cy.contains text resolves to a key used in source', () => {
    const registry = makeRegistry({
      translationIndex: {
        textToKeys: new Map([['sign in', ['auth.login.button']]]),
        keyToTexts: new Map([['auth.login.button', ['Sign In']]]),
      },
    });
    const context = makeContext({
      registry,
      sourceTranslationKeys: ['auth.login.button'],
      cypressContainsText: ['Sign In'],
    });
    const signals = scorer.evaluate('LoginForm.tsx', 'login.cy.ts', context);
    expect(signals[0].matched).toBe(true);
    expect(signals[0].metadata?.key).toBe('auth.login.button');
  });

  it('matches case-insensitively ("SIGN IN" matches "sign in" key)', () => {
    const registry = makeRegistry({
      translationIndex: {
        textToKeys: new Map([['sign in', ['auth.login.button']]]),
        keyToTexts: new Map(),
      },
    });
    const context = makeContext({
      registry,
      sourceTranslationKeys: ['auth.login.button'],
      cypressContainsText: ['SIGN IN'],
    });
    const signals = scorer.evaluate('LoginForm.tsx', 'login.cy.ts', context);
    expect(signals[0].matched).toBe(true);
  });

  it('returns no match when text resolves to key not used in source', () => {
    const registry = makeRegistry({
      translationIndex: {
        textToKeys: new Map([['sign in', ['auth.login.button']]]),
        keyToTexts: new Map(),
      },
    });
    const context = makeContext({
      registry,
      sourceTranslationKeys: ['cart.total'],
      cypressContainsText: ['Sign In'],
    });
    const signals = scorer.evaluate('CartSummary.tsx', 'login.cy.ts', context);
    expect(signals[0].matched).toBe(false);
  });
});
```

---

### 11. Contains Text Scorer (0.50)
**Weight:** 0.50
**Signal Type:** `contains-text-match`
**Applies To:** E2E (Cypress) tests

Evaluates if the test's `cy.contains()` text matches literal JSX text in the source file. This is the most heuristic scorer — use it as a last resort when no translation key is found.

> **Scorer Interaction:** If `TranslationMatchScorer` fires for a given text, the engine should mark that text as "resolved" and skip it in `ContainsTextScorer`. This prevents both scorers from adding signal for the same text string.

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

  // Case-insensitive substring match
  private textMatches(jsxText: string, containsText: string): boolean {
    return jsxText.toLowerCase().includes(containsText.toLowerCase());
  }
}
```

#### Example: Match
```
changedEntry.jsxTextContent = [
  'Sign In',
  'Forgot your password?',
  'Don\'t have an account?'
]

testEntry.cypress.containsText = ['Sign In', 'submit']

Iteration:
  text = 'Sign In'
  jsxTextContent.some(jsx => jsx.toLowerCase().includes('sign in'))
    → 'Sign In'.toLowerCase() = 'sign in' includes 'sign in' → true  ← MATCH

→ matched: true, weight: 0.50
→ reason: 'Matching text: Sign In'
```

#### Example: Partial / Substring Match
```
changedEntry.jsxTextContent = ['Forgot your password?']
testEntry.cypress.containsText = ['Forgot your']

'forgot your password?'.includes('forgot your') → true

→ matched: true
```

#### Example: No Match
```
changedEntry.jsxTextContent = ['Sign In', 'Cancel']
testEntry.cypress.containsText = ['Dashboard', 'Settings']

→ matched: false
```

#### Test Cases
```typescript
describe('ContainsTextScorer', () => {
  const scorer = new ContainsTextScorer();

  it('matches when cy.contains text is found in JSX text content', () => {
    const context = makeContext({
      sourceJsxTextContent: ['Sign In', 'Cancel'],
      cypressContainsText: ['Sign In'],
    });
    const signals = scorer.evaluate('LoginForm.tsx', 'login.cy.ts', context);
    expect(signals[0].matched).toBe(true);
    expect(signals[0].metadata?.matchedText).toEqual(['Sign In']);
  });

  it('matches case-insensitively', () => {
    const context = makeContext({
      sourceJsxTextContent: ['Sign In'],
      cypressContainsText: ['sign in'],
    });
    const signals = scorer.evaluate('LoginForm.tsx', 'login.cy.ts', context);
    expect(signals[0].matched).toBe(true);
  });

  it('matches as substring (cy.contains can be partial)', () => {
    const context = makeContext({
      sourceJsxTextContent: ['Forgot your password?'],
      cypressContainsText: ['Forgot your'],
    });
    const signals = scorer.evaluate('LoginForm.tsx', 'login.cy.ts', context);
    expect(signals[0].matched).toBe(true);
  });

  it('returns all matched texts in metadata', () => {
    const context = makeContext({
      sourceJsxTextContent: ['Sign In', 'Cancel', 'Forgot your password?'],
      cypressContainsText: ['Sign In', 'Cancel', 'Dashboard'],
    });
    const signals = scorer.evaluate('LoginForm.tsx', 'login.cy.ts', context);
    expect(signals[0].matched).toBe(true);
    expect(signals[0].metadata?.matchedText).toEqual(['Sign In', 'Cancel']);
  });

  it('returns matched=false when no text overlaps', () => {
    const context = makeContext({
      sourceJsxTextContent: ['Sign In'],
      cypressContainsText: ['Dashboard'],
    });
    const signals = scorer.evaluate('LoginForm.tsx', 'login.cy.ts', context);
    expect(signals[0].matched).toBe(false);
  });
});
```

---

## Scorer Registration

```typescript
import { ScoringEngine } from '@v2/core/scoring/scoring-engine';
import * as scorers from '@v2/core/scoring/scorers';

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

---

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

**Suggestion threshold: 0.50** — spec files with a final score below this are not suggested.

---

## Known Limitations and Future Work

| Issue | Affected Scorers | Severity | Recommended Fix |
|-------|-----------------|----------|-----------------|
| Barrel file resolution | DirectImportScorer, TransitiveImportScorer | High | Registry must flatten barrel exports in `getDependencies()` |
| `apiMatchesFile` is a stub | APIInterceptScorer | High | Implement URL pattern → file path resolution |
| BFS depth cap (5) may miss deep but real dependencies | RouteMatchScorer | Medium | Make MAX_DEPTH configurable per project |
| No negative signals emitted yet | RouteMatchScorer | Medium | Add penalty when routes are clearly from a different domain |
| TranslationMatch and ContainsText can double-count | Both | Low | Engine should mark text as "resolved" once TranslationMatch fires |
| SelectorMatch weight (0.80) same for 1 or 100 matches | SelectorMatchScorer | Low | Consider scaling weight by match count up to a cap |

---

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
- Scoring engine aggregates signals from all enabled scorers using max-plus-bonus strategy
- New scorers can be added without modifying existing code
- All scorers must conform to the shared `IFileEntry` / `IScorerContext` interfaces defined at the top of this document
