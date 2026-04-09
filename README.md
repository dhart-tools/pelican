<div align="center">

```
███████╗██╗   ██╗ ██████╗  ██████╗ ███████╗███████╗████████╗ ██████╗ ██████╗
██╔════╝██║   ██║██╔════╝ ██╔════╝ ██╔════╝██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗
███████╗██║   ██║██║  ███╗██║  ███╗█████╗  ███████╗   ██║   ██║   ██║██████╔╝
╚════██║██║   ██║██║   ██║██║   ██║██╔══╝  ╚════██║   ██║   ██║   ██║██╔══██╗
███████║╚██████╔╝╚██████╔╝╚██████╔╝███████╗███████║   ██║   ╚██████╔╝██║  ██║
╚══════╝ ╚═════╝  ╚═════╝  ╚═════╝ ╚══════╝╚══════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝
```

**Know exactly which Cypress tests to run. Every single time.**

<br/>

[![Build](https://img.shields.io/github/actions/workflow/status/henit-chobisa/suggestor/ci.yml?branch=main&style=flat-square&label=build)](https://github.com/henit-chobisa/suggestor/actions)
[![Tests](https://img.shields.io/github/actions/workflow/status/henit-chobisa/suggestor/test.yml?branch=main&style=flat-square&label=tests&color=4caf50)](https://github.com/henit-chobisa/suggestor/actions)
[![Contributors](https://img.shields.io/github/contributors/henit-chobisa/suggestor?style=flat-square&color=orange)](https://github.com/henit-chobisa/suggestor/graphs/contributors)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Version](https://img.shields.io/badge/version-1.0.0-brightgreen?style=flat-square)](./package.json)

</div>

---

## The Problem Nobody Talks About

You just changed one function in `UserProfile.tsx`.

Your CI pipeline now runs **1,247 Cypress tests**. It takes 43 minutes. The tests are green. You don't know which ones were actually *relevant* to your change. You don't know which ones caught real bugs and which ones just... ran. Your PR waits. Your teammates wait. Your deploy waits.

On Thursday, a regression slips through. The right test existed. It just didn't run in the critical window because it was buried in a different suite nobody knew was connected.

Sound familiar?

**This is the problem Suggestor was built to solve.**

---

## What is Suggestor?

Suggestor is an intelligent test recommendation engine that understands your codebase semantically — not just by file names, but by *relationships*. It analyzes how your source code is wired together: imports, routes, Redux slices, CSS selectors, translation keys, API endpoints — and uses all of that context to surface exactly which Cypress tests are relevant when a file changes.

It's not pattern matching. It's not file-name similarity. It's code intelligence.

```
You change:  src/features/auth/LoginForm.tsx

Suggestor:   ● login.cy.ts              [HIGH   0.97]  direct import + selector match
             ● auth-flow.cy.ts          [HIGH   0.91]  route match → LoginPage → LoginForm
             ● forgot-password.cy.ts    [MEDIUM 0.61]  transitive import (AuthLayout)
             ● i18n-smoke.cy.ts         [LOW    0.42]  translation key match (login.submitButton)
```

---

## Table of Contents

- [How It Works](#how-it-works)
- [Usage](#usage)
  - [Installation](#installation)
  - [Quick Start](#quick-start)
  - [Configuration](#configuration)
- [Analyzers](#analyzers)
  - [SourceExtractorAnalyzer](#sourceextractoranalyzer)
  - [CypressExtractorAnalyzer](#cypressextractoranalyzer)
  - [ImportGraphAnalyzer](#importgraphanalyzer)
  - [RouteAnalyzer](#routeanalyzer)
  - [ReduxChainAnalyzer](#reduxchainanalyzer)
  - [I18nAnalyzer](#i18nanalyzer)
- [Scoring Engine](#scoring-engine)
  - [How Scores Are Calculated](#how-scores-are-calculated)
  - [All Scorers](#all-scorers)
  - [Confidence Levels](#confidence-levels)
- [Development](#development)

---

## How It Works

Suggestor is built on three layers that work in sequence:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         YOUR CODEBASE                               │
│   src/features/   cypress/e2e/   src/store/   public/locales/      │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          ANALYZERS                                  │
│                                                                     │
│   SourceExtractor    CypressExtractor    ImportGraph                │
│   RouteAnalyzer      ReduxChainAnalyzer  I18nAnalyzer               │
│                                                                     │
│   Each analyzer reads files, parses the TypeScript AST, and        │
│   extracts structured semantic data: exports, selectors,            │
│   routes, Redux roles, translation keys, import edges.              │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           REGISTRY                                  │
│                                                                     │
│   A central in-memory store that holds everything the analyzers     │
│   found, organized into fast-lookup indexes:                        │
│                                                                     │
│   files          → Map<path, IFileEntry>                            │
│   importGraph    → bidirectional dependency edges                   │
│   selectorIndex  → Map<data-testid value, Set<filePath>>            │
│   routeMap       → Map<"/login", "src/pages/LoginPage.tsx">         │
│   reduxChains    → Map<sliceName, full chain metadata>              │
│   translationIndex → key↔text bidirectional lookup                 │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        SCORING ENGINE                               │
│                                                                     │
│   For every (changedFile × testFile) pair, runs 10 scorers.        │
│   Each scorer returns signals with weights. The engine combines     │
│   them, applies a ubiquity dampener for global files, and          │
│   produces a final confidence score from 0.0 to 1.0.               │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           OUTPUT                                    │
│                                                                     │
│   Ranked list of test files, scored, labeled, and explained.       │
│   Feed into CI to run only what matters.                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Usage

### Installation

```bash
# Clone and install dependencies
git clone https://github.com/henit-chobisa/suggestor.git
cd suggestor
pnpm install

# Build the CLI
pnpm build

# Link globally
pnpm link
```

### Quick Start

```bash
# Run against a changed file
suggestor --changed src/features/auth/LoginForm.tsx

# Run against multiple changed files (e.g. from a git diff)
suggestor --changed $(git diff --name-only HEAD~1)

# Output as JSON for CI consumption
suggestor --changed src/features/auth/LoginForm.tsx --format json
```

### Configuration

Create a `suggestor.config.ts` at your project root:

```typescript
import type { ISuggestorConfig } from './src/v2/types/config';

const config: ISuggestorConfig = {
  scoring: {
    // Which scorers to enable (all enabled by default)
    enabledScorers: [
      'direct-import',
      'route-match',
      'selector-match',
      'translation-match',
      'redux-chain',
      'transitive-import',
      'redux-consumer',
      'selector-id-match',
      'filename-convention',
      'api-intercept',
    ],

    // A file imported by more than 70% of the codebase
    // is considered "ubiquitous" and its signals are dampened
    ubiquityThreshold: 0.7,

    // Minimum score to include in results
    minConfidence: 0.4,

    // Score threshold for HIGH confidence label
    highConfidence: 0.8,

    // Override individual scorer weights (optional)
    scorerWeights: {
      'direct-import': 0.95,
      'route-match': 0.85,
    },
  },
};

export default config;
```

**RegistryBuilder config** (passed programmatically):

```typescript
const builder = new RegistryBuilder({
  sourceDirs: ['src', 'lib'],
  testPatterns: ['cypress/e2e/**/*.cy.ts', '**/*.cy.tsx'],
  sourceExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  ignoreDirs: ['node_modules', 'dist', '.next', 'build'],
  projectRoot: process.cwd(),
});
```

---

## Analyzers

Analyzers are the foundation of Suggestor. Each one reads a category of files, walks the TypeScript AST, and extracts structured information into the Registry. They are composable, versioned, and independently testable.

```
IAnalyzer<TInput, TOutput>
├── name: string
├── version: string
├── dependencies: string[]          ← declares what other analyzers it needs
├── extract(input): TOutput         ← parse a file, return structured data
└── index(output, registry): void   ← store results into the registry
```

---

### SourceExtractorAnalyzer

> Extracts the semantic DNA of every source file in your project.

**What it reads:** Any `.ts`, `.tsx`, `.js`, `.jsx` file that is not a test.

**What it extracts:**

| Category | Examples |
|---|---|
| Imports | `import { useAuth } from './hooks/useAuth'` |
| Exports | Named, default, re-exports |
| Functions & Classes | `function LoginForm()`, `class AuthService` |
| JSX selector attributes | `data-testid="login-btn"`, `data-cy="submit"`, `id="modal"`, `aria-label="close"` |
| Translation keys | `t('login.submitButton')`, `t('errors.required')` |
| Redux usage | `useSelector(selectUser)`, `dispatch(loginAction())`, `createSlice(...)` |
| Route definitions | `<Route path="/login" element={<LoginPage />} />` |

**How it works internally:**

```
LoginForm.tsx
     │
     ▼
TypeScript Compiler API (ts.createSourceFile)
     │
     ▼
AST Node Walker (recursive visit)
     │
     ├─► ImportDeclaration  → push to imports[]
     ├─► ExportDeclaration  → push to exports[]
     ├─► FunctionDeclaration → push to functions[]
     ├─► ClassDeclaration    → push to classes[]
     ├─► JsxAttribute        → if name ∈ SELECTOR_ATTRIBUTES → push to selectors[]
     ├─► CallExpression      → if callee === "t" → push to translationKeys[]
     └─► CallExpression      → if callee ∈ Redux patterns → push to reduxUsage[]
```

**Scenario — selector extraction:**

You have this component:

```tsx
// src/features/auth/LoginForm.tsx
export function LoginForm() {
  return (
    <form data-testid="login-form">
      <input data-cy="email-input" id="email" />
      <button data-testid="login-btn" aria-label="Sign in">
        {t('login.submitButton')}
      </button>
    </form>
  );
}
```

The analyzer extracts:

```typescript
selectors: [
  { attr: 'data-testid', value: 'login-form' },
  { attr: 'data-cy',     value: 'email-input' },
  { attr: 'id',          value: 'email' },
  { attr: 'data-testid', value: 'login-btn' },
  { attr: 'aria-label',  value: 'Sign in' },
],
translationKeys: ['login.submitButton']
```

Now when the `SelectorMatchScorer` runs, it knows exactly which test files reference `login-btn` or `email-input` — without running a single test.

---

### CypressExtractorAnalyzer

> Reads your test files and maps out everything the test *does* — where it goes, what it clicks, what it sees.

**What it reads:** Any `.cy.ts`, `.cy.tsx`, or spec file matching your test patterns.

**What it extracts:**

| Category | Cypress Command | Extracted Data |
|---|---|---|
| Navigation | `cy.visit('/login')` | Visited route: `/login` |
| Selector queries | `cy.get('[data-testid="login-btn"]')` | Selector: `{ type: TEST_ID, value: 'login-btn' }` |
| Text assertions | `cy.contains('Sign in')` | Contains text: `'Sign in'` |
| API mocks | `cy.intercept('POST', '/api/auth/login')` | Intercept: `{ method: POST, pattern: '/api/auth/login' }` |
| URL assertions | `cy.url().should('include', '/dashboard')` | URL assertion: `/dashboard` |
| Test structure | `describe(...)`, `it(...)`, `context(...)` | Test block hierarchy |

**Real test → extracted data:**

```typescript
// cypress/e2e/auth/login.cy.ts
describe('Login Flow', () => {
  it('should log in successfully', () => {
    cy.intercept('POST', '/api/auth/login').as('loginRequest');
    cy.visit('/login');
    cy.get('[data-testid="email-input"]').type('user@example.com');
    cy.get('[data-cy="password-field"]').type('secret');
    cy.get('[data-testid="login-btn"]').click();
    cy.wait('@loginRequest');
    cy.url().should('include', '/dashboard');
  });
});
```

Extracted:

```typescript
{
  visitedRoutes: ['/login'],
  selectors: [
    { type: 'TEST_ID', value: 'email-input' },
    { type: 'DATA_CY', value: 'password-field' },
    { type: 'TEST_ID', value: 'login-btn' },
  ],
  apiIntercepts: [{ method: 'POST', urlPattern: '/api/auth/login' }],
  urlAssertions: ['/dashboard'],
  containsText: [],
}
```

This is the mirror of what `SourceExtractorAnalyzer` extracted. The scorers connect the two sides.

---

### ImportGraphAnalyzer

> Builds the complete bidirectional dependency graph of your entire codebase. Answers: "If I change X, what else is affected?"

**What it detects:**

```
Static imports:     import X from './Y'
Dynamic imports:    const X = await import('./Y')
Re-exports:         export { X } from './Y'
Wildcard re-exports: export * from './Y'
Require calls:      const X = require('./Y')
Type imports:       import type { X } from './Y'  ← filtered out (not runtime)
```

**Barrel file resolution:**

One of the trickiest problems in import graph analysis is barrel files (`index.ts` files that re-export from many places). Suggestor handles this in two passes:

```
Pass 1 — Index barrel files
─────────────────────────────────────────────────────────
  src/components/index.ts
    export { Button } from './Button'
    export { Modal }  from './Modal'
    export { Input }  from './Input'

  → barrelMap: { 'src/components/index.ts' → ['Button', 'Modal', 'Input'] }

Pass 2 — Build edges with barrel resolution
─────────────────────────────────────────────────────────
  LoginForm.tsx imports { Button } from 'src/components'
  → resolves barrel → edge: LoginForm → src/components/Button.tsx
```

**Transitive dependency analysis:**

```
┌─────────────────────────────────────────────────────┐
│  You change: src/components/Button.tsx              │
│                                                     │
│  getTransitiveDependents('Button.tsx', depth=3):    │
│                                                     │
│  Button.tsx                                         │
│     └─► LoginForm.tsx          (depth 1)            │
│              └─► AuthPage.tsx  (depth 2)            │
│                       └─► App.tsx (depth 3)         │
│                                                     │
│  Affected: [LoginForm, AuthPage, App]               │
│  Tests to run: login.cy.ts, auth-flow.cy.ts         │
└─────────────────────────────────────────────────────┘
```

**Alias resolution — multi-source, priority order:**

```
Priority:   tsconfig.json  >  vite.config.ts  >  webpack.config.js  >  user config

Resolution: Longest prefix wins (prevents ambiguity)

Example:
  @/pages/auth/Login  →  src/pages/auth/Login.tsx   (via tsconfig paths)
  @pages/Login        →  src/pages/Login.tsx         (via vite alias)
  ~/utils/format      →  src/utils/format.ts         (via webpack alias)
```

---

### RouteAnalyzer

> Maps every URL in your app to the React component that renders it.

**Three route definition styles supported:**

**Style 1 — JSX routes:**
```tsx
// src/App.tsx
<Routes>
  <Route path="/login"     element={<LoginPage />} />
  <Route path="/dashboard" element={<DashboardPage />} />
  <Route path="/users/:id" element={<UserProfile />} />
</Routes>
```

**Style 2 — Router config (React Router v6.4+):**
```typescript
// src/router.ts
export const router = createBrowserRouter([
  { path: '/',        element: <App />,       children: [
    { path: 'login',  element: <LoginPage /> },
    { path: 'users',  element: <UsersPage />, children: [
      { path: ':id',  element: <UserProfile /> },
    ]},
  ]},
]);
```

**Style 3 — Lazy routes:**
```typescript
const LoginPage = lazy(() => import('@/pages/auth/Login'));
{ path: '/login', element: <LoginPage /> }
```

**Nested path stitching:**

```
Parent path:   /users
  Child path:  :id

→ Resolved:    /users/:id   →   src/pages/UserProfile.tsx
```

**Result in the registry:**

```typescript
routeMap: {
  '/login'      → 'src/pages/auth/LoginPage.tsx',
  '/dashboard'  → 'src/pages/DashboardPage.tsx',
  '/users/:id'  → 'src/pages/UserProfile.tsx',
}
```

When a Cypress test does `cy.visit('/login')`, the `RouteMatchScorer` can immediately look up which component renders at that route — and trace whether the changed file is inside that component tree.

---

### ReduxChainAnalyzer

> Maps your entire Redux architecture — who owns what state, who dispatches what action, who reads what selector.

This is where things get deep. Modern Redux codebases are split across multiple files: a `slice` that defines actions and reducers, a separate `selectors` file, `sagas` for side effects, and dozens of consumer components. If you change one part of a Redux chain, which tests are affected?

**Redux role detection:**

| Role | Detection pattern |
|---|---|
| `SLICE` | File calls `createSlice(...)` |
| `REDUCER` | Function with `(state, action)` parameters |
| `SELECTORS` | File calls `createSelector(...)` or exports selector functions |
| `ACTIONS` | File calls `createAction(...)` |
| `SAGAS` | File contains generator functions (`function*`) |
| `TYPES` | Pure type definition file |

**Chain building (two-pass process):**

```
Pass 1 — Extract roles from individual files
────────────────────────────────────────────────────────────────────
  src/store/auth/authSlice.ts      → role: SLICE
  src/store/auth/authSelectors.ts  → role: SELECTORS
  src/store/auth/authSagas.ts      → role: SAGAS
  src/store/auth/authTypes.ts      → role: TYPES

Pass 2 — Build the named chain
────────────────────────────────────────────────────────────────────
  Chain "auth":
    slice:     authSlice.ts
    selectors: authSelectors.ts
    sagas:     authSagas.ts
    types:     authTypes.ts
    consumers: [LoginPage.tsx, ProfilePage.tsx, HeaderNav.tsx]
              (files that import from authSelectors.ts)
```

**Visual chain:**

```
                     ┌─────────────────────┐
                     │    authTypes.ts      │
                     │  (type definitions)  │
                     └──────────┬──────────┘
                                │ imports
                     ┌──────────▼──────────┐
                     │    authSlice.ts      │
                     │  createSlice(...)    │
                     │  actions: login,     │
                     │           logout,    │
                     │           refresh    │
                     └──────┬───────┬──────┘
                    depends │       │ depends
                 ┌──────────▼──┐ ┌──▼──────────────┐
                 │ authReducer  │ │  authSelectors   │
                 │ (state mgmt) │ │  selectUser      │
                 └─────────────┘ │  selectIsLoggedIn │
                                 └────────┬──────────┘
                                          │ imported by
                          ┌───────────────┼──────────────────┐
                          │               │                   │
                 ┌────────▼───────┐ ┌─────▼──────┐ ┌────────▼───────┐
                 │  LoginPage.tsx  │ │ HeaderNav  │ │  ProfilePage   │
                 │  (consumer)     │ │ (consumer) │ │  (consumer)    │
                 └────────────────┘ └────────────┘ └────────────────┘
```

**What this enables:** Change `authSelectors.ts` → Suggestor knows all three consumer components are affected → recommends tests for all their routes.

---

### I18nAnalyzer

> Connects your translation files to the tests that assert on translated text.

**The problem it solves:**

Your test does:
```typescript
cy.contains('Sign In')
```

Your source does:
```typescript
<button>{t('login.submitButton')}</button>
```

Your translation file has:
```json
{ "login": { "submitButton": "Sign In" } }
```

Without I18n awareness, no analyzer would know these are connected. Suggestor builds the bridge.

**What it indexes:**

```typescript
translationIndex: {
  keyToText:  { 'login.submitButton' → 'Sign In' },
  textToKeys: { 'sign in'            → ['login.submitButton'] },    // normalized
  keyToFiles: { 'login.submitButton' → Set(['src/features/auth/LoginForm.tsx']) },
  dynamicKeys: Set(['greeting.hello']) // keys with {{name}} placeholders
}
```

**Supported i18n structures:**

```
Flat file:
  public/locales/en/translation.json
  { "login.submitButton": "Sign In" }

Nested file:
  public/locales/en/translation.json
  { "login": { "submitButton": "Sign In" } }   → key: "login.submitButton"

Namespaced files:
  public/locales/en/auth.json    → namespace "auth"
  { "submitButton": "Sign In" }  → key: "auth:submitButton"
```

**Interpolation detection:**

```
{{name}}     → react-i18next style    → dynamic key
{count}      → react-intl style       → dynamic key
%(key)s      → python-style           → dynamic key

"Hello {{name}}" → stored as "Hello" (base text for partial matching)
```

---

## Scoring Engine

The scoring engine is where everything comes together. Given a changed file and a test file, it asks all 10 scorers for their opinion — then synthesizes a single confidence score.

### How Scores Are Calculated

Each scorer returns a list of `ISignal` objects:

```typescript
interface ISignal {
  source: string;          // which scorer produced this
  type: string;            // signal type (e.g. 'DIRECT_IMPORT')
  weight: number;          // strength of this signal (0.0–1.0)
  matched: boolean;        // did it find a connection?
  metadata?: Record<string, unknown>;
  reason?: string;         // human-readable explanation
}
```

**The score formula:**

```
signals = all matched signals from all scorers, sorted descending

finalScore = signals[0]                               // dominant signal
           + min(sum(signals[1..n]) × 0.1,  0.05)    // tiebreaker bonus
           (capped at 1.0)
```

In plain English: **one strong signal dominates**. Multiple weaker signals add a small tiebreaker bonus — but they can't carry a result on their own. This prevents false positives from accumulation of weak matches.

**Ubiquity Dampener:**

```
If a file is imported by > 70% of all files in the codebase:
  → it is "ubiquitous" (think: a utility module, a theme file, a base component)
  → signals involving it are reduced to 30% of their original weight

Why: "If everything imports it, it doesn't tell you anything specific."

Example:
  src/utils/cn.ts  ← imported by 94% of the codebase
  Signal weight:   0.7 × 0.3 = 0.21  (dampened)
  Without dampening: 0.7 (would produce false HIGH confidence for every test)
```

### All Scorers

| Scorer | Weight | What it detects |
|---|---|---|
| `DirectImportScorer` | **0.95** | Test directly imports the changed file |
| `RouteMatchScorer` | **0.85** | Test visits a route that renders the changed component |
| `TranslationMatchScorer` | **0.85** | Test `cy.contains()` text matches source `t()` keys |
| `SelectorMatchScorer` | **0.80** | Test `data-testid`/`data-cy` selectors match source JSX attributes |
| `ReduxChainScorer` | **0.75** | Both files belong to the same Redux slice chain |
| `TransitiveImportScorer` | **0.70** | Test imports X, and X imports the changed file |
| `ReduxConsumerScorer` | **0.65** | Test visits a route whose component uses the affected Redux chain |
| `SelectorIdMatchScorer` | **0.65** | Test `#id` selectors match source `id=""` attributes |
| `FilenameConventionScorer` | **0.60** | File names match after normalization (`LoginForm` ↔ `LoginForm.cy.ts`) |
| `APIInterceptScorer` | **0.55** | Test `cy.intercept()` URL matches an API file path |

---

**DirectImportScorer (0.95)**

The clearest possible signal. If the test imports the changed file, it was written to test it.

```typescript
// cypress/e2e/login.cy.ts
import { validateEmail } from '../../src/utils/validators';  // ← direct import

// You change: src/utils/validators.ts
// Score: 0.95 (near-certain)
```

---

**RouteMatchScorer (0.85)**

Test visits a route → route renders a component → component is (or imports) the changed file.

```
cy.visit('/login')
      │
      ▼ registry.routeMap
LoginPage.tsx
      │
      ▼ importGraph.getDependencies() (depth ≤ 3)
LoginForm.tsx  ← changed file found here
      │
      ▼
Signal: ROUTE_MATCH, weight: 0.85
```

---

**TranslationMatchScorer (0.85)**

Connects `cy.contains('Sign In')` in a test to `t('login.submitButton')` in source code, via the i18n index.

```
cy.contains('Sign In')
      │
      ▼ textToKeys lookup (normalized: 'sign in')
'login.submitButton'
      │
      ▼ keyToFiles lookup
src/features/auth/LoginForm.tsx  ← changed file
      │
      ▼
Signal: TRANSLATION_MATCH, weight: 0.85
Reason: "Test text 'Sign In' matches translation key login.submitButton used in LoginForm.tsx"
```

---

**SelectorMatchScorer (0.80)**

The connector between the DOM and your tests. Matches `data-testid` and `data-cy` values between source JSX and Cypress selectors.

```
Source file contains:                Test file contains:
  <button data-testid="login-btn">     cy.get('[data-testid="login-btn"]')

                    MATCH → Signal weight: 0.80
```

---

**ReduxChainScorer (0.75)**

Two approaches depending on test type:

```
Unit/integration tests:
  Test imports authSelectors.ts
  Changed file is authSlice.ts
  Both in chain "auth"
  → Signal: REDUX_CHAIN_MATCH

E2E tests (no direct Redux import):
  Test visits /dashboard
  DashboardPage imports selectUser (from authSelectors)
  Changed file is authSlice.ts
  authSelectors is in chain "auth"
  → Signal: REDUX_CHAIN_CONSUMER
```

---

**FilenameConventionScorer (0.60)**

A simple but surprisingly powerful last resort.

```
Normalization steps:
  1. Remove extension:    LoginForm.tsx     → LoginForm
  2. Lowercase:           LoginForm         → loginform
  3. Remove non-alnum:    login-form.cy.ts  → loginform

  "loginform" === "loginform"  → match
```

Catches the cases where all semantic analysis comes up empty but the naming convention is clear.

---

**APIInterceptScorer (0.55)**

Connects backend API files to the tests that mock them.

```
Test:        cy.intercept('POST', '/api/auth/login')
Changed file: src/api/auth/login.ts

Pattern match:  '/api/auth/login'  ∈  'src/api/auth/login.ts'  → match
Signal: API_INTERCEPT_MATCH, weight: 0.55
```

Applies when the changed file path contains `/api/`, `/routes/`, or `/handlers/`.

---

### Confidence Levels

```
Score ≥ 0.8   →  HIGH    ██████████  Run this test. Something changed that it covers.
Score ≥ 0.4   →  MEDIUM  █████░░░░░  Worth running. There's a meaningful connection.
Score < 0.4   →  LOW     ██░░░░░░░░  Tenuous connection. Consider skipping in fast CI.
```

**Example output for a changed file:**

```
Changed: src/features/auth/LoginForm.tsx

  Test File                              Score    Confidence  Primary Signal
  ─────────────────────────────────────────────────────────────────────────
  cypress/e2e/auth/login.cy.ts           0.97     HIGH        selector-match + direct-import
  cypress/e2e/auth/auth-flow.cy.ts       0.91     HIGH        route-match (/login → LoginPage)
  cypress/e2e/auth/forgot-password.cy.ts 0.85     HIGH        translation-match (login.*)
  cypress/e2e/smoke/navigation.cy.ts     0.62     MEDIUM      transitive-import (AuthLayout)
  cypress/e2e/i18n/smoke.cy.ts           0.44     MEDIUM      translation-match (login.submitButton)
  cypress/e2e/admin/dashboard.cy.ts      0.21     LOW         filename-convention
```

---

## Development

### Setup

```bash
git clone https://github.com/henit-chobisa/suggestor.git
cd suggestor
pnpm install
```

### Running Tests

```bash
# Run all v2 tests
pnpm test:v2

# Run with Jest
pnpm test:jest

# Run linter
pnpm lint
```

### Project Structure

```
src/v2/
├── types/
│   ├── analyzers/
│   │   ├── base.ts                   IAnalyzer<TInput, TOutput>, ISignal
│   │   ├── source-extractor.ts       ISourceExtractionResult
│   │   ├── cypress-extractor.ts      ICypressExtractionResult
│   │   ├── redux-chain.ts            IReduxExtractionResult
│   │   ├── i18n-analyzer.ts          II18nExtractionResult
│   │   ├── route-analyzer.ts         IRouteExtractionResult
│   │   └── import-graph.ts           IImportGraphExtractionResult
│   ├── registry/
│   │   ├── registry.ts               IRegistry, IFileEntry
│   │   └── indexes.ts                ITranslationIndex, IReduxChain
│   ├── scorers/
│   │   ├── base.ts                   IScorer, IScorerContext
│   │   └── score-result.ts           IScoreResult
│   └── config.ts                     ISuggestorConfig
│
├── core/
│   ├── analyzers/
│   │   ├── base.ts                   BaseAnalyzer<TInput, TOutput>
│   │   ├── source-extractor/         SourceExtractorAnalyzer
│   │   ├── cypress-extractor/        CypressExtractorAnalyzer
│   │   ├── redux-chain/              ReduxChainAnalyzer
│   │   ├── i18n-analyzer/            I18nAnalyzer
│   │   ├── route-analyzer/           RouteAnalyzer + AliasResolver
│   │   └── import-graph-analyzer/    ImportGraphAnalyzer + AliasResolver
│   ├── registry/
│   │   ├── registry.ts               Registry (central data store)
│   │   ├── registry-builder.ts       RegistryBuilder (orchestrator)
│   │   └── path-utils.ts             normalizePath()
│   └── scoring/
│       ├── scoring-engine.ts         ScoringEngine
│       ├── scoring-config.ts         Default scorer weights & order
│       └── scorers/
│           ├── base.ts               BaseScorer
│           ├── direct-import-scorer.ts
│           ├── route-match-scorer.ts
│           ├── selector-match-scorer.ts
│           ├── translation-match-scorer.ts
│           ├── redux-chain-scorer.ts
│           ├── transitive-import-scorer.ts
│           ├── redux-consumer-scorer.ts
│           ├── selector-id-match-scorer.ts
│           ├── filename-convention-scorer.ts
│           └── api-intercept-scorer.ts
│
└── utils/
    ├── enums.ts                      All enum definitions
    └── constants.ts                  BUILTIN_CYPRESS_COMMANDS, regex patterns
```

### Adding a New Analyzer

```typescript
import { BaseAnalyzer } from '../base';
import type { IMyExtractionResult } from '../../../types/analyzers/my-analyzer';

export class MyAnalyzer extends BaseAnalyzer<string, IMyExtractionResult> {
  name = EAnalyzerName.MY_ANALYZER;
  version = '1.0.0';
  dependencies = [];  // other analyzers this one needs

  extract(filePath: string): IMyExtractionResult {
    // parse the file, return structured data
    return { ... };
  }

  index(result: IMyExtractionResult, registry: IRegistry): void {
    // store into registry indexes
  }
}
```

### Adding a New Scorer

```typescript
import { BaseScorer } from '../base';
import type { IScorerContext, IScoreResult } from '../../../types/scorers';

export class MyScorer extends BaseScorer {
  name = EScorerType.MY_SCORER;
  version = '1.0.0';
  weight = 0.7;
  description = 'Detects ...';

  evaluate(changedFile: string, testFile: string, ctx: IScorerContext): IScoreResult {
    const signals = [];

    // your matching logic here
    if (/* match found */) {
      signals.push(this.createSignal({
        type: 'MY_MATCH',
        weight: this.weight,
        matched: true,
        reason: 'Found X in Y',
      }));
    }

    return this.buildResult(signals);
  }
}
```

---

<div align="center">

**Built with care for the engineers who have spent too long waiting for CI.**

[Report a bug](https://github.com/henit-chobisa/suggestor/issues) · [Request a feature](https://github.com/henit-chobisa/suggestor/issues) · [Contribute](./CONTRIBUTING.md)

</div>
