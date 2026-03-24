## Test Suggestor v2 — Final Architecture Plan

**Scope:** React + Redux + Redux Saga + Cypress. Single repo. Optional LLM for explanation only.

---

### What We're Building

A CLI tool that, given a `git diff`, deterministically identifies which Cypress E2E tests (and unit/integration tests) need to run. Zero LLM dependency for core logic. Near-instant results.


---

### System Architecture


## 1. Executive Summary
This document defines the architecture, implementation strategy, and technical specification for the Test Suggestor v2. This system replaces the existing LLM-based suggestion mechanism—which suffered from latency, non-determinism, and fragile JSON parsing—with a **native, deterministic, and high-performance heuristic engine**.

The system utilizes TypeScript's Compiler API for deep AST mining, linking source code semantic changes to relevant Cypress E2E tests, unit tests, and integration tests using a multi-layered heuristic scoring engine.

---

## 2. The Native Philosophy: Why AST Mining?
Cypress E2E tests are imperative DOM-based flows, while React components are declarative structures. The existing LLM solution attempted to bridge this semantic gap via brute-force inference, which is unreliable.

**The New Strategy:** We bridge this gap using **Structural Semantics** and **Flow Tracing**:
- **Source Mining:** Extract component identifiers (`data-testid`, `id`, `aria-label`), route definitions, Redux state dependencies, and i18n keys.
- **Test Mining:** Extract `cy.visit()` URLs, `cy.get()`/`cy.find()` selectors, `cy.contains()` text content, and `describe`/`it` block names.
- **Flow Tracing:** Map `cy.visit('/path')` → `RouteMap` → `Component Tree` → `Imports` → `Redux Slice` → `Source File Change`.

---

## 3. System Architecture Layers

### 3.1 Layer 1: Extractors (The Mining Engine)
Crawls the AST to build semantic understanding.
- **Source Extractor (`*.tsx`):** Extracts exports, class/function signatures, JSX attributes (`data-testid`, etc.), i18n keys (`t('key')`), and Redux usage (`useSelector`, `dispatch`).
- **Cypress Extractor (`*.cy.ts`):** Parses `cy.visit()`, `cy.get()`, `cy.contains()`, and `intercept()` calls into a structured format.
- **Redux Chain Detector:** Identifies slice boundaries (actions, reducers, sagas, selectors).

### 3.2 Layer 2: Registry (The Engine Room)
A persistent, indexed database (`descriptor.json` + in-memory maps).
- **Import Graph:** Bidirectional mapping (`dependencies`/`dependents`) tracing cross-file impact.
- **Route Map:** `Map<URLPattern, ComponentFilePath>`.
- **Selector Index:** `Map<SelectorValue, Set<SourceFilePath>>` (e.g., `submit-btn` → `LoginForm.tsx`).
- **Translation Index:** `Map<Key, TranslatedString>`.
- **Redux Chain Map:** Groupings of related Redux files (e.g., the `user` slice).

### 3.3 Layer 3: Scoring Engine (The Heuristic Core)
Calculates confidence for `(changedFile, candidateTestFile)`.
- **Aggregation Formula:**
  `finalScore = max(allSignalScores) + min(sum(otherScores) * 0.1, 0.05)`
- This ensures the strongest signal dominates, while others act as tiebreakers.
- **Ubiquity Dampener:** If a component is imported by >70% of routes, its impact signals are dampened ($weight \times 0.3$) to avoid flooding the user with false-positive suggestions.

---

## 4. Addressing Complex Real-World Bridges

### 4.1 Internationalization (i18n)
`cy.contains('Sign In')` (test side) vs `t('login.submit')` (source side).
- **Resolver:** Locales JSON (`login.submit` → `"Sign In"`) is loaded at registry build time.
- **Match:** `cy.contains` → `Sign In` → `TranslationIndex` maps to `login.submit` → `LoginPage.tsx`.

### 4.2 Redux & Saga Chains (The Propagation Chain)
- **Problem:** Actions/reducers/selectors are decoupled via imports but coupled via state.
- **Solution:** `ReduxChain` groups related files. Any change to a file in a chain propagates impact to all other files in that chain (actions → reducer → selector → container → component).
- **Cypress Link:** `Cypress Test` → `cy.visit('/profile')` → `RouteMap` → `UserProfilePage` → `ReduxChain` → `Changed File` (e.g., `reducer.ts`).



```
┌─────────────────────────────────────────────────┐
│                  Setup Wizard                    │
│         (one-time interactive config)            │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│               Extractors (AST)                   │
│  ┌──────────┐ ┌───────────┐ ┌────────────────┐  │
│  │ Source    │ │ Cypress   │ │ Redux Chain    │  │
│  │ Extractor│ │ Extractor │ │ Detector       │  │
│  └────┬─────┘ └─────┬─────┘ └──────┬─────────┘  │
│       └──────────────┼──────────────┘            │
└──────────────────────┼──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│                  Registry                        │
│  ┌────────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ Import     │ │ Route    │ │ Selector      │  │
│  │ Graph      │ │ Map      │ │ Index         │  │
│  ├────────────┤ ├──────────┤ ├───────────────┤  │
│  │ Redux      │ │ i18n     │ │ Custom Cmd    │  │
│  │ Chain Map  │ │ Index    │ │ Registry      │  │
│  └────────────┘ └──────────┘ └───────────────┘  │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│              Scoring Engine                      │
│         (weighted heuristic signals)             │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│          Explanation Layer (Optional LLM)         │
│  "SubmitButton.tsx changed → LoginPage uses it   │
│   → Cypress test visits /login and clicks        │
│   [data-testid=submit-btn] → RUN THIS TEST"      │
└──────────────────────────────────────────────────┘
```

---

### The Setup Wizard

The wizard runs once via `suggestor setup`. It auto-detects what it can, then asks the user to confirm or fill gaps.

#### Auto-Detection Phase (Silent)

The wizard scans  `package.json`,  `tsconfig.json`, and the filesystem before asking anything:

| Detection | Method |
|---|---|
| React version | `dependencies.react` |
| Cypress presence + location | `devDependencies.cypress` + glob `**/*.cy.{ts,tsx}` |
| Redux / RTK | `dependencies.redux` or `dependencies.@reduxjs/toolkit` |
| Redux Saga | `dependencies.redux-saga` |
| react-router-dom | `dependencies.react-router-dom` |
| i18n library | `dependencies.react-i18next` or `dependencies.react-intl` |
| Path aliases |  `tsconfig.json` → `compilerOptions.paths` |
| Cypress custom commands | `cypress/support/commands.ts` existence |
| Store directory | Glob for `**/store/`, `**/redux/`, `**/slices/` |
| Translation files | Glob for `**/locales/**/*.json`, `**/i18n/**/*.json` |

#### Interactive Phase (Questions)

After detection, the wizard presents findings and asks targeted questions:

```
─── Project Detected ──────────────────────

  React 19.2.4 • Cypress 15.12.0
  Redux Toolkit + Redux Saga
  react-router-dom • react-i18next
  Path alias: @/ → src/

─── Testing ───────────────────────────────

  Found Cypress tests in: cypress/e2e/

  ? Any additional test directories?
    [Enter to confirm]

─── Routing ───────────────────────────────

  Found route definitions in: src/App.tsx

  ? Is this the main router file? (Y/n)
  ? Do you use nested/layout routes? (y/N)

─── Redux ─────────────────────────────────

  Found store at: src/store/

  ? How are your slices organized?
    ● By feature — src/store/user/, src/store/cart/
    ○ By type — src/actions/, src/reducers/
    ○ RTK createSlice (single file per slice)

  ? Do your sagas trigger navigation? (y/N)

─── Internationalization ──────────────────

  Found react-i18next
  Found translation files: public/locales/en/translation.json

  ? Is this the default locale file? (Y/n)
  ? File structure:
    ○ Single file
    ● Namespaced (common.json, login.json, etc.)

─── Cypress ───────────────────────────────

  Found custom commands: cypress/support/commands.ts

  ? Selector strategy used (select all):
    ☑ data-testid
    ☑ data-cy
    ☐ CSS classes
    ☐ Element IDs
    ☐ aria-label

─── Optional: LLM Explanations ────────────

  ? Enable LLM-powered explanations for
    suggested tests? (y/N)

  If yes:
    ? Ollama host: (http://localhost:11434)
    ? Model: (qwen2.5-coder:3b)

─── Building Registry ─────────────────────

  ✓ 247 source files indexed
  ✓ 38 test files indexed
  ✓ Import graph: 1,247 edges
  ✓ Route map: 12 routes
  ✓ Selector index: 89 test-ids
  ✓ Redux chains: 6 slices
  ✓ Translation index: 342 keys
  ✓ Custom commands: 4 commands

  Wrote .suggestorrc.json
  Wrote .suggestor/registry.json

  Done. Run `suggestor suggest` to get suggestions.
```

---

### Extractors — Detailed Specification

#### Source Extractor

Enhances the existing `ASTExtractor`. Operates on `*.ts`, `*.tsx`.

**New extractions to add:**

1. **JSX Attributes** — Walk `JsxOpeningElement` and `JsxSelfClosingElement` nodes. For each `JsxAttribute`, check if the name matches the user's configured selector strategy (`data-testid`, `data-cy`, `id`, `aria-label`). Extract the string literal value.

2. **JSX Text Content** — Extract `JsxText` nodes and string literal children in JSX. Normalize whitespace. Used for `cy.contains()` matching.

3. **Route Definitions** — Two patterns:
   - JSX: `<Route path="/login" element={<LoginPage />} />` — extract `path` + element tag name.
   - Object: `{ path: "/login", element: <LoginPage /> }` inside an array — extract same.
   - Lazy: `{ path: "/dashboard", lazy: () => import("./pages/Dashboard") }` — extract path + import path.

4. **i18n Translation Keys** — Detect calls to `t('key')`, `useTranslation()`, `<Trans i18nKey="key">`, `intl.formatMessage({ id: 'key' })`. Extract the string argument as the translation key.

5. **Redux Pattern Detection:**
   - `useSelector(selectorFn)` — extract the selector function name or inline selector.
   - `useDispatch()` + `dispatch(actionCreator())` — extract the action creator name.
   - `connect(mapStateToProps, mapDispatchToProps)` — extract both function references.
   - `createSlice({ name: 'user', ... })` — extract slice name.
   - `createAction('user/setName')` — extract action type string.

#### Cypress Extractor

New file. Operates on `*.cy.ts`, `*.cy.tsx`.

**Extractions:**

1. **`cy.visit()`** — Extract string argument. For template literals, extract the static prefix (everything before the first `${}`).

2. **`cy.get()` / `cy.find()`** — Extract the CSS selector string. Parse it:
   - `[data-testid="X"]` → `{ type: "testid", value: "X" }`
   - `[data-cy="X"]` → `{ type: "data-cy", value: "X" }`
   - `#X` → `{ type: "id", value: "X" }`
   - `.X` → `{ type: "class", value: "X" }`

3. **`cy.contains()`** — Extract the string argument. This is the visible text.

4. **`cy.intercept()`** — Extract HTTP method and URL pattern.

5. **`cy.url().should('include', '/path')`** — Detect chained assertion, extract the path string.

6. **`describe()` / `it()` blocks** — Extract the string argument (test/suite names).

7. **Custom command usage** — Any `cy.X()` call where `X` is not a built-in Cypress command. Recorded for resolution against the Custom Command Registry.

#### Redux Chain Detector

New file. Operates on files within the configured store directory.

**What it builds:**

For each slice/feature directory, it identifies:

```ts
interface IReduxChain {
  sliceName: string;           // "user"
  files: {
    actions?: string;          // src/store/user/actions.ts
    reducer?: string;          // src/store/user/reducer.ts
    selectors?: string;        // src/store/user/selectors.ts
    sagas?: string[];          // [src/store/user/sagas.ts]
    types?: string;            // src/store/user/types.ts
    slice?: string;            // src/store/user/slice.ts (RTK)
  };
  actionTypes: string[];       // ["user/setName", "user/login"]
  selectorNames: string[];     // ["selectUser", "selectUserName"]
  consumers: string[];         // files using useSelector/connect with this slice's selectors
}
```

**Detection by organization style:**

*Feature-based (src/store/user/):*
- Group all files under the same directory into one chain.
- Identify roles by AST patterns: files with `createReducer`/`createSlice` are reducers, files with `function*` generators are sagas, files with `createSelector` or `(state: RootState)` params are selectors.

*RTK createSlice (single file per slice):*
- Each `createSlice()` call defines a chain. Extract `name`, `reducers` keys (become action types), and `extraReducers` references.

*By type (src/actions/, src/reducers/):*
- Match files across directories by naming convention: `src/actions/user.ts` pairs with `src/reducers/user.ts` and `src/sagas/userSaga.ts`.

---

### Registry — Data Structures

#### Updated IFileEntry

```ts
interface IFileEntry {
  name: string;
  type: "source" | "test";

  // AST core (existing, kept)
  exports: string[];
  imports: string[];              // RESOLVED paths (not raw import strings)
  classes: string[];
  functions: string[];
  interfaces: string[];
  keywords: string[];

  // JSX mining (source files)
  selectors: ISourceSelector[];   // { attr: "data-testid", value: "submit-btn" }
  jsxTextContent: string[];
  translationKeys: string[];      // ["login.submitButton"]
  routesDefined: IRouteDef[];     // [{ path: "/login", component: "LoginPage" }]

  // Redux (source files)
  reduxUsage: {
    selectorsUsed: string[];      // selector function names called
    actionsDispatched: string[];  // action creators dispatched
    slicesDefined: string[];      // slice names defined in this file
  };

  // Cypress mining (test files)
  cypress: {
    visitedRoutes: string[];
    selectors: ICypressSelector[];
    containsText: string[];
    interceptedAPIs: IAPIIntercept[];
    customCommandsUsed: string[];
    describeBlocks: string[];
    itBlocks: string[];
  };
}
```

#### Indexes (built from IFileEntry data, held in memory)

```ts
interface IRegistry {
  files: Map<string, IFileEntry>;
  importGraph: {
    dependencies: Map<string, Set<string>>;
    dependents: Map<string, Set<string>>;
  };
  routeMap: Map<string, string>;              // "/login" → "src/pages/LoginPage.tsx"
  selectorIndex: Map<string, Set<string>>;    // "submit-btn" → Set(["src/components/LoginForm.tsx"])
  textIndex: Map<string, Set<string>>;        // "sign in" → Set(["src/pages/LoginPage.tsx"])
  translationIndex: {
    keyToText: Map<string, string>;
    textToFiles: Map<string, Set<string>>;
  };
  reduxChains: Map<string, IReduxChain>;      // "user" → chain
  customCommands: Map<string, ICypressExtraction>; // "login" → extracted selectors/routes
}
```

---

### Scoring Engine

For each `(changedFile, testFile)` pair, compute signals and aggregate.

#### Signals (Final Table)

| # | Signal | Weight | When It Fires |
|---|---|---|---|
| S1 | Direct Import | 0.95 | Test directly imports changed file |
| S2 | Route Match | 0.85 | Test visits URL mapped to component tree containing changed file |
| S3 | Selector Match (testid/data-cy) | 0.80 | Test's `cy.get('[data-testid=X]')` matches changed file's `data-testid="X"` |
| S4 | Same Redux Chain | 0.75 | Changed file and a file tested by this test are in the same Redux chain |
| S5 | Transitive Import (depth 1) | 0.70 | Test imports X, X imports changed file |
| S6 | Redux Consumer | 0.65 | Test covers a component that uses a selector/action from the changed Redux chain |
| S7 | Selector Match (id) | 0.65 | Same as S3 but for `id` attribute |
| S8 | Filename Convention | 0.60 | `src/pages/Login.tsx` ↔ `cypress/e2e/login.cy.ts` |
| S9 | Transitive Route | 0.60 | Changed file is imported (depth 1-2) by a route-mounted component that the test visits |
| S10 | API Intercept | 0.55 | Test intercepts an API route served by the changed file |
| S11 | Translation Match | 0.50 | Test's `cy.contains('Sign In')` resolves to a translation key used in the changed file |
| S12 | Contains Text | 0.50 | Test's `cy.contains('X')` matches JSX text in changed file |
| S13 | Describe/It Block | 0.45 | Test's describe block name matches changed component name |
| S14 | Keyword Overlap | 0.35 | Shared AST-derived keywords |
| S15 | Custom Command (transitive) | Inherits | Test uses `cy.login()` → resolve to underlying selectors/routes, apply S2-S12 |

#### Aggregation

```
finalScore = max(allSignalScores) + min(sum(otherScores) * 0.1, 0.05)
capped at 1.0
```

Single strong signal dominates. Weak signals break ties but never inflate.

#### Ubiquity Dampener

If a source file is imported by >70% of page components, multiply all its signal weights by 0.3. Append reason: "Global component — consider full suite."

---

### The Explanation Layer (Optional LLM)

When enabled, after scoring, the LLM receives a structured prompt:

```
Given the following test suggestion:

Changed file: src/store/user/reducer.ts
  - This file is part of the "user" Redux chain
  - It handles actions: user/login, user/logout, user/setProfile

Suggested test: cypress/e2e/user-profile.cy.ts
  - Visits: /user/profile
  - Interacts with: [data-testid="user-name"], [data-testid="edit-profile-btn"]
  - Contains text: "Save Changes"

Association chain:
  reducer.ts → (Redux chain: user) → selectUserProfile
    → UserProfilePage.tsx → (route: /user/profile)
    → user-profile.cy.ts

Confidence: 0.87

Write a 2-3 sentence explanation for a QA engineer
explaining WHY this test should run given the code change.
```

**When LLM is disabled**, we construct the explanation from templates:

```
"src/store/user/reducer.ts is part of the 'user' Redux chain.
 UserProfilePage.tsx consumes this chain via selectUserProfile.
 This test visits /user/profile and interacts with components
 rendered by UserProfilePage. Score: 0.87"
```

Both are useful. The LLM version reads more naturally. The template version is instant and deterministic.

---

### Edge Cases Addressed (v1 Scope)

| ID | Case | Solution |
|---|---|---|
| E1 | Dynamic routes (`/user/${id}`) | Extract static prefix, prefix-match against route params |
| E2 | Import aliases (`@/`) | Read tsconfig paths, resolve during graph build |
| E3 | Same-name components | Break ties via import graph + selector specificity |
| E4 | Ubiquitous components | Dampener: reduce weight by 0.3 if imported by >70% pages |
| E5 | Cypress custom commands | Parse `commands.ts`, inline selectors/routes into consuming tests |
| E7 | No-selector tests | Route match (S2 at 0.85) carries the test |
| E8 | Barrel exports | Expand re-exports in index files to actual source files |
| E9 | cy.contains false positives | Low weight (0.50) + only match interactive elements |
| E10 | Multi-page flows | All cy.visit() calls extracted, scored against all routes |
| E11 | Programmatic navigation | Selector match still fires; cy.url().should detected |
| E12 | i18n translations | Resolve key → text via locale JSON, match against cy.contains |
| E13 | Redux/Saga chains | Full chain detection, any change in chain impacts all chain tests |
| E16 | Shared test utilities | Import graph: fixture change → all importing tests suggested |
| E17 | CSS module changes | Import graph propagation handles it |
| E18 | Env/config changes | Special-case flag: "consider full suite" |

---

### File Structure (New)

```
src/
  core/
    ast-extractor.ts          ← MODIFY: add JSX attrs, routes, i18n, Redux detection
    cypress-extractor.ts      ← NEW: Cypress test file parser
    import-graph.ts           ← NEW: bidirectional import graph builder
    redux-chain.ts            ← NEW: Redux chain detector
    registry.ts               ← NEW: builds + holds all indexes
    scoring-engine.ts         ← NEW: weighted heuristic scorer
    matcher.ts                ← REWRITE: orchestrates scoring, no LLM
    git.ts                    ← KEEP: unchanged
  store/
    descriptor.ts             ← MODIFY: updated IFileEntry shape
  llm/
    ollama.ts                 ← KEEP: used only for optional explanations
    prompts.ts                ← MODIFY: only explanation prompt remains
  commands/
    setup.tsx                 ← REWRITE: wizard flow
    suggest.tsx               ← REWRITE: registry + scoring pipeline
    index.tsx                 ← MINOR UPDATE
  ui/
    components/
      SetupWizard.tsx         ← NEW: interactive wizard UI
      SuggestView.tsx         ← MODIFY: show signal-based reasons
  config.ts                   ← MODIFY: new config shape, remove LLM-required fields
  types.ts                    ← MODIFY: new interfaces, remove ILLMAnalysisResult
```

---

### Implementation Order

| Phase | Files | Depends On | Parallelizable |
|---|---|---|---|
| 1 | `types.ts` | Nothing | — |
| 2 | `ast-extractor.ts` (enhance) | Phase 1 | Yes, with 3 and 4 |
| 3 | `cypress-extractor.ts` (new) | Phase 1 | Yes, with 2 and 4 |
| 4 | `import-graph.ts` (new) | Phase 1 | Yes, with 2 and 3 |
| 5 | `redux-chain.ts` (new) | Phase 2, 4 | No |
| 6 | `registry.ts` (new) | Phase 2, 3, 4, 5 | No |
| 7 | `scoring-engine.ts` (new) | Phase 1, 6 | No |
| 8 | `matcher.ts` (rewrite) | Phase 6, 7 | No |
| 9 | `config.ts` + `SetupWizard.tsx` | Phase 6 | Yes, with 8 |
| 10 | `setup.tsx` + `suggest.tsx` (rewrite) | Phase 8, 9 | No |
| 11 | Cleanup: trim LLM to explanation-only | Phase 10 | No |

---

### Config Shape (Final)

```json
{
  "testPatterns": ["**/*.cy.ts", "**/*.test.ts", "**/*.spec.ts"],
  "sourcePatterns": ["**/*.ts", "**/*.tsx"],
  "sourceDirs": ["src"],
  "ignorePatterns": ["node_modules", "dist", ".git", "coverage"],
  "routing": {
    "library": "react-router-dom",
    "routerFile": "src/App.tsx"
  },
  "redux": {
    "storeDirs": ["src/store"],
    "organization": "by-feature",
    "hasSagas": true,
    "sagasNavigate": false
  },
  "i18n": {
    "library": "react-i18next",
    "defaultLocale": "en",
    "localesPath": "public/locales/en/translation.json",
    "structure": "namespaced"
  },
  "cypress": {
    "selectorStrategy": ["data-testid", "data-cy"],
    "hasCustomCommands": true,
    "commandsFile": "cypress/support/commands.ts"
  },
  "scoring": {
    "minConfidence": 0.40,
    "ubiquityThreshold": 0.70
  },
  "llm": {
    "enabled": false,
    "host": "http://localhost:11434",
    "model": "qwen2.5-coder:3b"
  }
}
```

---

That's the complete plan. Scoped to React + Redux + Redux Saga + Cypress. Single repo. LLM optional for explanations only. 11 edge cases handled in v1.


---

I get this and it's looking good, but another thing I guess we forgot is that
organizations use translations as well. Second is that, my org also uses redux
and redux saga. So in that case I think it will be an import graph dependency.
Such that, your store leads you to a components, now store changes provide you
with the unit test and integration test, same for the components, but say you
have actions -> reducers -> containers -> componets, changing one on the things
is depedency for other, so you have to test the entire chain as well.

----


Two excellent points. Both are real-world concerns that the current document doesn't address. Let me add them.

---

### E12: Internationalization / Translation Keys (i18n)

**The Problem:**

Many organizations don't hardcode text in JSX. Instead they use translation functions:

```tsx
// Source component
import { useTranslation } from 'react-i18next';

function LoginPage() {
  const { t } = useTranslation();
  return <button data-testid="submit">{t('login.submitButton')}</button>;
}
```

```ts
// Cypress test
cy.contains('Sign In')  // The *translated* string, not the key
```

The Cypress test uses the **rendered text** ("Sign In"), but the source component only has the **translation key** (`login.submitButton`). Our `cy.contains()` matching would fail because we'd be comparing "Sign In" against "login.submitButton".

**Solution — Translation Key Resolution:**

1. **Detect i18n usage in source files:** During AST extraction, identify calls to `t()`, `useTranslation()`, `intl.formatMessage()`, `<FormattedMessage id="..." />` (react-intl), or equivalent patterns.
2. **Extract translation keys:** `t('login.submitButton')` → key: `login.submitButton`.
3. **Load translation files:** Read the default locale JSON file (e.g., `public/locales/en/translation.json` or `src/i18n/en.json`). Build an index: `key → translated string`.
4. **Bridge the gap:** When a Cypress test has `cy.contains('Sign In')`, and a source file has `t('login.submitButton')`, and the translation file maps `login.submitButton` → `"Sign In"`, we have a match.

**New extractor additions:**

| Data Point | Source Side | Test Side |
|---|---|---|
| Translation keys used | `t('login.submitButton')` → `"login.submitButton"` | N/A |
| Rendered text | Key → resolved via locale JSON → `"Sign In"` | `cy.contains('Sign In')` → `"Sign In"` |

**New type:**

```ts
interface ITranslationIndex {
  keyToText: Map<string, string>;    // "login.submitButton" → "Sign In"
  textToKeys: Map<string, string[]>; // "Sign In" → ["login.submitButton"]
  keyToFiles: Map<string, Set<string>>; // "login.submitButton" → Set(["src/pages/LoginPage.tsx"])
}
```

**Matching flow:**

```
1. Cypress test: cy.contains('Sign In')
2. Look up 'Sign In' in textToKeys → ["login.submitButton"]
3. Look up "login.submitButton" in keyToFiles → Set(["src/pages/LoginPage.tsx"])
4. If LoginPage.tsx was changed → match (signal weight: 0.50, same as contains)
5. If a file *imported by* LoginPage.tsx was changed → transitive match
```

**Edge case within the edge case:** What if the developer changes the translation file itself (e.g., `en.json`)? In that case, we should:
- Detect which keys were modified in the diff.
- Map those keys to source files via `keyToFiles`.
- Then map those source files to tests normally.

**Configuration needed:** The user must tell us where translation files live. Add to `.suggestorrc.json`:
```json
{
  "i18n": {
    "type": "react-i18next" | "react-intl" | "custom",
    "defaultLocale": "en",
    "localesPath": "public/locales/en/translation.json"
  }
}
```

---

### E13: Redux / Redux-Saga — State Management Chain

**The Problem:**

In a Redux architecture, the data flow is:

```
Actions → Reducers → Store → Selectors → Containers → Components
                         ↑
                    Sagas (side effects)
```

These are typically separate files:

```
src/store/user/actions.ts      — action creators & action types
src/store/user/reducer.ts      — state mutation logic
src/store/user/selectors.ts    — memoized selectors (reselect)
src/store/user/sagas.ts        — side effects (API calls, etc.)
src/store/user/types.ts        — TS types for state slice
src/containers/UserProfile.tsx — connects store to component
src/components/UserCard.tsx    — pure presentational component
```

If the developer changes `actions.ts`, the entire chain is affected:
- `reducer.ts` handles those actions
- `sagas.ts` listens for those actions
- `selectors.ts` reads the state that the reducer produces
- `containers/UserProfile.tsx` uses those selectors
- `components/UserCard.tsx` renders the data

A change to `actions.ts` should suggest tests for **all of these**, not just files that directly import `actions.ts`.

**Why the basic import graph is insufficient:**

The import graph would show:
```
reducer.ts → imports → actions.ts      ✓ (depth 1)
sagas.ts   → imports → actions.ts      ✓ (depth 1)
container  → imports → selectors.ts    ✓ (depth 1)
container  → imports → actions.ts      ✓ (depth 1, for dispatching)
```

But the **semantic chain** is:
```
actions.ts → reducer.ts → selectors.ts → container → component
actions.ts → sagas.ts
```

The import graph catches most of this, but there's a subtle gap: `selectors.ts` doesn't necessarily import `actions.ts` or `reducer.ts` directly. It reads from the store shape, which is defined by the reducer. The link is **implicit** through the state shape, not an explicit import.

**Solution — Redux Chain Detection:**

1. **Detect Redux patterns during AST extraction:**

   | Pattern | Detection |
   |---|---|
   | Action creators | Functions returning `{ type: string, payload: ... }` or calls to `createAction()` / `createSlice()` |
   | Reducers | Functions with `(state, action)` signature, switch statements on `action.type`, or `createReducer()`/`createSlice()` |
   | Selectors | Functions taking `(state: RootState)` as parameter, or `createSelector()` calls |
   | Sagas | Generator functions (`function*`) using `take()`, `takeEvery()`, `takeLatest()`, `put()`, `call()`, `select()` |
   | Connected containers | `connect(mapState, mapDispatch)` or `useSelector()`/`useDispatch()` hooks |

2. **Build a Redux Dependency Chain:**

   ```ts
   interface IReduxChain {
     // "user" slice
     sliceName: string;
     actions: string;      // file path
     reducer: string;      // file path
     selectors: string;    // file path
     sagas: string[];      // file paths (can be multiple)
     containers: string[]; // file paths that connect this slice
   }
   ```

   Detection: Group files by directory convention (e.g., all files under `src/store/user/` belong to the `user` slice). Alternatively, trace `combineReducers()` to identify slice boundaries.

3. **Chain propagation rule:**

   When **any file in a Redux chain** is modified, **all files in that chain** are considered "impacted", and tests for any of them should be suggested.

   ```
   Changed: src/store/user/actions.ts
   Impacted chain: [actions.ts, reducer.ts, selectors.ts, sagas.ts]
   Impacted consumers: [containers that use useSelector with this slice's selectors]
   → Suggest tests for ALL of the above
   ```

4. **Scoring signal:**

   | Signal | Weight | Logic |
   |---|---|---|
   | **Same Redux Chain** | 0.75 | Test file tests another file in the same Redux chain as the changed file |
   | **Redux Consumer** | 0.65 | Test file tests a container/component that consumes a selector from the changed chain |

**How this connects to Cypress:**

A Cypress test doesn't import Redux files. But:
1. Cypress test visits `/user/profile` → maps to `UserProfilePage.tsx` via RouteMap.
2. `UserProfilePage.tsx` uses `useSelector(selectUserData)` → links to the `user` Redux chain.
3. Developer changes `src/store/user/reducer.ts` → part of the `user` chain.
4. Chain propagation: `reducer.ts` change impacts the `user` chain → impacts `UserProfilePage.tsx` → impacts Cypress tests visiting `/user/profile`.

The transitive path is: `reducer.ts` → (Redux chain) → `selectors.ts` → (import graph) → `UserProfilePage.tsx` → (route map) → `cypress/e2e/user-profile.cy.ts`.

**Saga-specific consideration:**

Sagas often dispatch actions that trigger navigation or update UI state that Cypress tests validate. For example:

```ts
function* loginSaga(action) {
  const response = yield call(api.login, action.payload);
  yield put(loginSuccess(response.data));
  // This might trigger a redirect to /dashboard
}
```

If `loginSaga` changes, tests for the login flow AND the dashboard should be impacted. The saga's `put()` calls tell us which actions it dispatches, and we can trace those actions to their reducers and downstream consumers.

---

### Updated Scoring Table (with new signals)

| Signal | Weight | Applies To |
|---|---|---|
| Direct Import | 0.95 | Unit/Integration |
| Route Match | 0.85 | Cypress E2E |
| Selector Match (testid/data-cy) | 0.80 | Cypress E2E |
| **Same Redux Chain** | **0.75** | **Unit/Integration/E2E** |
| Transitive Import (depth 1) | 0.70 | Unit/Integration |
| Selector Match (id) | 0.65 | Cypress E2E |
| **Redux Consumer** | **0.65** | **Unit/Integration/E2E** |
| Filename Match | 0.60 | Cypress E2E |
| Transitive Route Match | 0.60 | Cypress E2E |
| API Intercept Match | 0.55 | Cypress E2E |
| Contains Text Match | 0.50 | Cypress E2E |
| **Translation Text Match** | **0.50** | **Cypress E2E** |
| Describe Block Match | 0.45 | Cypress E2E |
| Keyword Overlap | 0.35 | All |

---

### Updated Implementation Phases

The original 10 phases remain. Two new ones are inserted:

```
Phase 2  → Source Extractor (add JSX attributes + route extraction + i18n key extraction + Redux pattern detection)
Phase 3  → Cypress Extractor
Phase 4  → Import Graph Builder
Phase 4b → Translation Index Builder (new — reads locale JSON, builds key↔text maps)
Phase 4c → Redux Chain Builder (new — groups Redux files into chains, detects slice boundaries)
Phase 5  → Registry Builder (integrates all of the above)
Phase 6  → Scoring Engine (add translation match + Redux chain signals)
...rest unchanged
```

---

### Updated Config (`.suggestorrc.json`)

```json
{
  "testPatterns": ["**/*.cy.ts", "**/*.test.ts", "**/*.spec.ts"],
  "sourcePatterns": ["**/*.ts", "**/*.tsx"],
  "sourceDirs": ["src"],
  "ignorePatterns": ["node_modules", "dist"],
  "i18n": {
    "type": "react-i18next",
    "defaultLocale": "en",
    "localesPath": "public/locales/en/translation.json"
  },
  "redux": {
    "enabled": true,
    "storeDirs": ["src/store"]
  }
}

