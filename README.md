<div align="center">

<br/>

<img src="src/assets/pelican.png" alt="Pelican" width="200" />

<br/>

# `pelican`

### You changed one file. We'll tell you exactly which tests to run.

<br/>

[![Build](https://img.shields.io/github/actions/workflow/status/dhart-tools/pelican/build-test.yml?branch=main&style=for-the-badge&label=BUILD&logo=github)](https://github.com/dhart-tools/pelican/actions)
&nbsp;&nbsp;
[![Lint](https://img.shields.io/github/actions/workflow/status/dhart-tools/pelican/test-lint.yml?branch=main&style=for-the-badge&label=LINT&color=4caf50&logo=eslint)](https://github.com/dhart-tools/pelican/actions)
&nbsp;&nbsp;
[![Contributors](https://img.shields.io/github/contributors/dhart-tools/pelican?style=for-the-badge&color=orange&logo=github)](https://github.com/dhart-tools/pelican/graphs/contributors)

[![TypeScript](https://img.shields.io/badge/TYPESCRIPT-5.x-3178c6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
&nbsp;&nbsp;
[![Cypress](https://img.shields.io/badge/CYPRESS-NATIVE-69D3A7?style=for-the-badge&logo=cypress&logoColor=white)](https://www.cypress.io/)
&nbsp;&nbsp;
[![License](https://img.shields.io/badge/LICENSE-ELv2-blue?style=for-the-badge)](./LICENSE)

<br/>

**Semantic code analysis** &middot; **10 scoring dimensions** &middot; **Zero runtime overhead** &middot; **One command**

<br/>

---

<br/>

</div>

> [!WARNING]
> **Pelican is licensed under the [Elastic License 2.0 (ELv2)](./LICENSE).**
> You are free to use, modify, and self-host this software. However, you **may not** offer Pelican as a hosted or managed service to third parties without explicit written permission from the author. Commercial exploitation — including reselling, white-labeling, or building a paid product directly from this codebase — is prohibited under these terms. If you want to use Pelican commercially, [reach out](https://github.com/dhart-tools/pelican/issues).

## It's 4:47 PM on a Thursday.

You changed one line in `UserProfile.tsx`. A CSS class. Maybe a copy change. Maybe you refactored how props are passed down.

Your CI pipeline wakes up. It runs **1,247 Cypress tests**. All of them. Every single one. It takes 43 minutes.

You alt-tab. You check Slack. You refill your coffee. You come back. Green. Ship it.

But here's the thing — of those 1,247 tests, **only 11 were actually relevant** to your change. Eleven. The other 1,236 tests tested features your change couldn't possibly affect. They ran because nobody knew which ones mattered.

And here's the worse thing — sometimes **the 12th test**, the one that *would* have caught the regression? It was in a completely different test suite. Nobody knew it was connected. It didn't run until the nightly. The bug hit staging at 2 AM.

Your Slack lights up.

**You've been here before. We all have.**

<br/>

<div align="center">

```
    ┌─────────────────────────────────────────────────────────────┐
    │                                                             │
    │   You change:  src/features/auth/LoginForm.tsx              │
    │                                                             │
    │   ┌───────────────────────────────────────────────────────┐ │
    │   │                                                       │ │
    │   │   pelican --changed src/features/auth/LoginForm.tsx │ │
    │   │                                                       │ │
    │   └───────────────────────────────────────────────────────┘ │
    │                                                             │
    │   Pelican thinks for ~2 seconds, then:                    │
    │                                                             │
    │   ● login.cy.ts              HIGH   0.97                    │
    │     ├─ direct-import         ██████████████████░░  0.95     │
    │     └─ selector-match        ████████████████░░░░  0.80     │
    │                                                             │
    │   ● auth-flow.cy.ts          HIGH   0.91                    │
    │     └─ route-match           █████████████████░░░  0.85     │
    │                                                             │
    │   ● forgot-password.cy.ts    HIGH   0.87                    │
    │     └─ translation-match     █████████████████░░░  0.85     │
    │                                                             │
    │   ● navigation.cy.ts         MED    0.62                    │
    │     └─ transitive-import     ██████████████░░░░░░  0.70     │
    │                                                             │
    │   4 tests to run.  ~3 minutes.  Done.                       │
    │                                                             │
    └─────────────────────────────────────────────────────────────┘
```

</div>

<br/>

---

## Before & After

<table>
<tr>
<td width="50%">

### Without Pelican

```
$ git push origin feature/update-profile

CI: Running all tests...

  ✓ login.cy.ts             (31s)
  ✓ signup.cy.ts            (28s)
  ✓ forgot-password.cy.ts   (19s)
  ✓ dashboard.cy.ts         (45s)
  ✓ settings.cy.ts          (33s)
  ✓ admin-users.cy.ts       (41s)
  ✓ admin-roles.cy.ts       (38s)
  ✓ billing.cy.ts           (52s)
  ✓ onboarding.cy.ts        (27s)
  ✓ search.cy.ts            (35s)
  ✓ notifications.cy.ts     (22s)
    ... 1,236 more tests ...
  ✓ export-csv.cy.ts        (44s)

  1247 passed  (43m 12s)
```

43 minutes. All green. No idea which ones
mattered. All of them ran "just in case."

</td>
<td width="50%">

### With Pelican

```
$ pelican --changed $(git diff --name-only)
  | cypress run --spec

Analyzing: src/features/auth/LoginForm.tsx

  ● login.cy.ts            HIGH  0.97
    "direct-import + selector-match"
  ● auth-flow.cy.ts        HIGH  0.91
    "route /login renders LoginPage → LoginForm"
  ● forgot-password.cy.ts  HIGH  0.87
    "translation key login.submitButton"
  ● navigation.cy.ts       MED   0.62
    "transitive: AuthLayout → LoginForm"

Running 4 targeted tests...

  ✓ login.cy.ts             (31s)
  ✓ auth-flow.cy.ts         (24s)
  ✓ forgot-password.cy.ts   (19s)
  ✓ navigation.cy.ts        (28s)

  4 passed  (1m 42s)
```

1 minute 42 seconds. The 4 tests that
actually cover your change. Nothing else.

</td>
</tr>
</table>

> **That's a 96% reduction in test execution time, with zero loss in coverage for the change.**

---

## Why Not Just...

Before we go deeper, let's address the elephant in the room. You're probably thinking one of these:

<table>
<tr>
<td width="40%"><strong>"We just run tests in the same directory"</strong></td>
<td width="60%">Your <code>LoginForm</code> is in <code>src/features/auth/</code>. But the test that catches the regression is in <code>cypress/e2e/smoke/navigation.cy.ts</code> — a smoke test that visits <code>/login</code> and checks the form works. Directory matching misses it entirely.</td>
</tr>
<tr>
<td><strong>"We use <code>grep</code> on changed file names"</strong></td>
<td>You renamed <code>useAuth</code> hook. Grep finds <code>auth.cy.ts</code>. It misses <code>dashboard.cy.ts</code>, which imports <code>DashboardPage</code>, which imports <code>HeaderNav</code>, which calls <code>useAuth</code>. Grep can't follow transitive imports.</td>
</tr>
<tr>
<td><strong>"We tag tests with metadata"</strong></td>
<td>Metadata rots. Someone adds a new feature and forgets to tag the test. Someone refactors a component and the tag now points to a file that doesn't exist. Pelican reads the actual code — it can't go stale.</td>
</tr>
<tr>
<td><strong>"We just run everything, CI is cheap"</strong></td>
<td>CI minutes are cheap. <strong>Your engineers' context switches are not.</strong> Every 43-minute pipeline is a coffee break that breaks flow. Multiply that by 15 PRs/day, 5 days/week. That's 53 hours/week of idle pipeline time — and 53 hours of broken focus.</td>
</tr>
<tr>
<td><strong>"We use code coverage data"</strong></td>
<td>Coverage data requires running the tests first. It's a feedback loop — you need the answer <em>before</em> you run. Pelican uses static analysis. It gives you the answer before anything executes.</td>
</tr>
</table>

---

## How It Works — The Big Picture

Pelican has three layers. Each one builds on the last.

```
                    YOUR CODEBASE
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
       ▼                 ▼                 ▼
  Source Files      Test Files      Config Files
  (.ts, .tsx)      (.cy.ts)       (i18n, routes)
       │                 │                 │
       └────────┬────────┘                 │
                │                          │
                ▼                          │
┌──────────────────────────────────────────┤
│                                          │
│            L A Y E R   1                 │
│                                          │
│              ANALYZERS                   │
│                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │  Source   │ │ Cypress  │ │  Import  │ │
│  │Extractor │ │Extractor │ │  Graph   │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ │
│       │             │            │       │
│  ┌────┴─────┐ ┌─────┴────┐ ┌────┴─────┐ │
│  │  Route   │ │  Redux   │ │   i18n   │ │
│  │ Analyzer │ │  Chain   │ │ Analyzer │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ │
│       │             │            │       │
└───────┼─────────────┼────────────┼───────┘
        │             │            │
        └──────┬──────┘            │
               │                   │
               ▼                   │
┌──────────────────────────────────┤
│                                  │
│          L A Y E R   2           │
│                                  │
│            REGISTRY              │
│                                  │
│  ┌────────────────────────────┐  │
│  │ files: Map<path, entry>   │  │
│  │ importGraph: deps ↔ deps  │◄─┘
│  │ selectorIndex: val → files│
│  │ routeMap: url → component │
│  │ reduxChains: slice → chain│
│  │ translationIndex: key ↔ t │
│  └────────────────────────────┘
│                                  │
└─────────────────┬────────────────┘
                  │
                  ▼
┌──────────────────────────────────┐
│                                  │
│          L A Y E R   3           │
│                                  │
│         SCORING ENGINE           │
│                                  │
│  For each (changed, test) pair:  │
│                                  │
│  ┌────────────────────────────┐  │
│  │ 10 scorers evaluate        │  │
│  │ signals collected          │  │
│  │ ubiquity dampener applied  │  │
│  │ final score computed       │  │
│  │ confidence level assigned  │  │
│  └────────────────────────────┘  │
│                                  │
│  Output:                         │
│    test.cy.ts → 0.97 [HIGH]     │
│    "direct import + selectors"   │
│                                  │
└──────────────────────────────────┘
```

---

## Table of Contents

<table>
<tr>
<td width="50%" valign="top">

**Using Pelican**
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [CI Integration](#ci-integration)

**Understanding the Analyzers**
- [SourceExtractorAnalyzer](#-sourceextractoranalyzer)
- [CypressExtractorAnalyzer](#-cypressextractoranalyzer)
- [ImportGraphAnalyzer](#-importgraphanalyzer)
- [RouteAnalyzer](#-routeanalyzer)
- [ReduxChainAnalyzer](#-reduxchainanalyzer)
- [I18nAnalyzer](#-i18nanalyzer)

</td>
<td width="50%" valign="top">

**Understanding the Scoring**
- [How Scores Are Calculated](#how-scores-are-calculated)
- [The Score Formula](#the-score-formula)
- [Ubiquity Dampener](#the-ubiquity-dampener)
- [All 10 Scorers (Detailed)](#all-10-scorers)
- [Confidence Levels](#confidence-levels)

**Real-World Walkthroughs**
- [Trace 1: The Selector Bridge](#trace-1--the-selector-bridge)
- [Trace 2: The Translation Ghost](#trace-2--the-translation-ghost)
- [Trace 3: The Redux Ripple](#trace-3--the-redux-ripple)

**Scenarios You've Lived Through**
- [The New Dev's First PR](#scenario-1--the-new-devs-first-pr)
- [The "Which Tests Do I Run?" Slack Message](#scenario-2--the-which-tests-do-i-run-slack-message)
- [The Shared Component Refactor](#scenario-3--the-shared-component-refactor)
- [The Friday 5 PM Hotfix](#scenario-4--the-friday-5-pm-hotfix)
- [The Config File Nobody Thinks About](#scenario-5--the-config-file-nobody-thinks-about)
- [The Monorepo Migration](#scenario-6--the-monorepo-migration)

**Development**
- [Setup](#setup)
- [Project Structure](#project-structure)
- [Extending Pelican](#extending-pelican)

</td>
</tr>
</table>

---

## Installation

```bash
git clone https://github.com/dhart-tools/pelican.git
cd pelican
pnpm install
pnpm build
pnpm link
```

## Quick Start

```bash
# Single file
pelican --changed src/features/auth/LoginForm.tsx

# From git diff (most common usage)
pelican --changed $(git diff --name-only HEAD~1)

# JSON output for piping into CI
pelican --changed $(git diff --name-only HEAD~1) --format json

# Only HIGH confidence results
pelican --changed $(git diff --name-only HEAD~1) --min-confidence high
```

## Configuration

```typescript
// pelican.config.ts
import type { ISuggestorConfig } from './src/v2/types/config';

export default {
  scoring: {
    enabledScorers: [
      'direct-import',        // weight: 0.95
      'route-match',          // weight: 0.85
      'translation-match',    // weight: 0.85
      'selector-match',       // weight: 0.80
      'redux-chain',          // weight: 0.75
      'transitive-import',    // weight: 0.70
      'redux-consumer',       // weight: 0.65
      'selector-id-match',    // weight: 0.65
      'filename-convention',  // weight: 0.60
      'api-intercept',        // weight: 0.55
    ],
    ubiquityThreshold: 0.7,   // files imported by >70% of codebase are dampened
    minConfidence: 0.4,       // minimum score to appear in results
    highConfidence: 0.8,      // threshold for HIGH label
  },
} satisfies ISuggestorConfig;
```

## CI Integration

Pipe the output directly into Cypress:

```yaml
# .github/workflows/test.yml
name: Smart Tests
on: [pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Get changed files
        id: changed
        run: echo "files=$(git diff --name-only origin/main...HEAD | tr '\n' ',')" >> $GITHUB_OUTPUT

      - name: Suggest tests
        id: suggest
        run: |
          SPECS=$(pelican --changed "${{ steps.changed.outputs.files }}" --format spec-list)
          echo "specs=$SPECS" >> $GITHUB_OUTPUT

      - name: Run targeted tests
        if: steps.suggest.outputs.specs != ''
        run: npx cypress run --spec "${{ steps.suggest.outputs.specs }}"
```

---

<br/>

<div align="center">

# The Analyzers

*Six specialized parsers that see your codebase the way a senior engineer would.*

</div>

<br/>

Every analyzer implements the same interface — simple, composable, independently testable:

```typescript
interface IAnalyzer<TInput, TOutput> {
  name: string;
  version: string;
  dependencies: string[];          // other analyzers this one requires
  extract(input: TInput): TOutput; // parse input → structured data
  index(output: TOutput): void;    // store into the registry
}
```

---

### `01` SourceExtractorAnalyzer

> *Reads every source file in your project and extracts its semantic DNA — what it exports, what selectors it renders, what translation keys it uses, what Redux state it touches.*

**Reads:** `.ts` `.tsx` `.js` `.jsx` (non-test files)

<table>
<tr>
<td width="50%">

**Your code:**

```tsx
// src/features/auth/LoginForm.tsx

import { useAuth } from '@/hooks/useAuth';
import { selectUser } from '@/store/auth';

export function LoginForm() {
  const user = useSelector(selectUser);
  const { login } = useAuth();

  return (
    <form data-testid="login-form"
          onSubmit={login}>
      <input
        data-cy="email-input"
        id="email-field"
        aria-label="Email address"
      />
      <input
        data-cy="password-input"
        type="password"
      />
      <button data-testid="login-btn">
        {t('login.submitButton')}
      </button>
    </form>
  );
}
```

</td>
<td width="50%">

**What Pelican sees:**

```typescript
{
  imports: [
    '@/hooks/useAuth',
    '@/store/auth'
  ],

  exports: ['LoginForm'],

  functions: ['LoginForm'],

  selectors: [
    { attr: 'data-testid', value: 'login-form' },
    { attr: 'data-cy',     value: 'email-input' },
    { attr: 'id',          value: 'email-field' },
    { attr: 'aria-label',  value: 'Email address' },
    { attr: 'data-cy',     value: 'password-input' },
    { attr: 'data-testid', value: 'login-btn' },
  ],

  translationKeys: [
    'login.submitButton'
  ],

  reduxUsage: {
    selectors: ['selectUser'],
    dispatches: []
  }
}
```

</td>
</tr>
</table>

**Internal AST walk:**

```
LoginForm.tsx  →  ts.createSourceFile()  →  recursive node visitor
                                                   │
   ┌───────────────────────────────────────────────┤
   │                                               │
   ▼                                               ▼
ImportDeclaration                            JsxOpeningElement
   │                                               │
   ├─ '@/hooks/useAuth'                            ├─ attribute: data-testid
   └─ '@/store/auth'                               │   └─ value: "login-form"
                                                   ├─ attribute: data-cy
CallExpression                                     │   └─ value: "email-input"
   │                                               ├─ attribute: id
   ├─ t('login.submitButton')                      │   └─ value: "email-field"
   │   └─ → translationKeys[]                      └─ attribute: aria-label
   │                                                   └─ value: "Email address"
   └─ useSelector(selectUser)
       └─ → reduxUsage.selectors[]
```

> **Edge cases handled:** Only extracts string literals (ignores dynamic `t(variable)` calls and template expressions). Handles nested JSX depth. Detects all Redux Toolkit patterns: `createSlice`, `createAction`, `createSelector`, `createAsyncThunk`.

---

### `02` CypressExtractorAnalyzer

> *Reads every test file and maps out what it does — which pages it visits, which elements it interacts with, which text it asserts on, which APIs it mocks.*

**Reads:** `.cy.ts` `.cy.tsx` `.spec.ts` (test files matching configured patterns)

This is the **mirror** of the SourceExtractor. While the source side says "I render `data-testid='login-btn'`", the test side says "I click `data-testid='login-btn'`". The scorers connect the two.

<table>
<tr>
<td width="50%">

**Your test:**

```typescript
// cypress/e2e/auth/login.cy.ts

describe('Login Flow', () => {
  beforeEach(() => {
    cy.intercept('POST', '/api/auth/login')
      .as('loginReq');
    cy.intercept('GET', '/api/users/me')
      .as('userReq');
  });

  it('logs in with valid credentials', () => {
    cy.visit('/login');

    cy.get('[data-testid="email-input"]')
      .type('user@company.com');

    cy.get('[data-cy="password-input"]')
      .type('P@ssw0rd!');

    cy.get('[data-testid="login-btn"]')
      .click();

    cy.wait('@loginReq');

    cy.url()
      .should('include', '/dashboard');

    cy.contains('Welcome back');
  });
});
```

</td>
<td width="50%">

**What Pelican sees:**

```typescript
{
  describes: [{
    name: 'Login Flow',
    tests: [{
      name: 'logs in with valid credentials',
    }],
  }],

  visitedRoutes: ['/login'],

  selectors: [
    { type: 'TEST_ID', value: 'email-input' },
    { type: 'DATA_CY', value: 'password-input' },
    { type: 'TEST_ID', value: 'login-btn' },
  ],

  apiIntercepts: [
    { method: 'POST', url: '/api/auth/login' },
    { method: 'GET',  url: '/api/users/me' },
  ],

  urlAssertions: ['/dashboard'],

  containsText: ['Welcome back'],

  customCommands: [],
}
```

</td>
</tr>
</table>

**Selector parsing — the regex engine:**

```
cy.get('[data-testid="login-btn"]')   →  { type: TEST_ID,  value: 'login-btn' }
cy.get('[data-cy="email"]')           →  { type: DATA_CY,  value: 'email' }
cy.get('#submit-form')                →  { type: ID,        value: 'submit-form' }
cy.get('.btn-primary')                →  { type: CLASS,     value: 'btn-primary' }
cy.get('.modal [data-cy="close"]')    →  { type: DATA_CY,  value: 'close' }
cy.get('div > span.active:first')     →  { type: COMPLEX,   value: 'div > span.active:first' }
```

> **Edge cases handled:** Template literal selectors extract the prefix only. Custom Cypress commands are tracked. Both `describe` and `context` block types are recognized. Chained selectors like `cy.get(...).find(...)` are followed.

---

### `03` ImportGraphAnalyzer

> *Builds the complete bidirectional dependency graph of your entire codebase. Answers the fundamental question: "If I change file X, what else could break?"*

This is the **backbone** of Pelican. Almost every other scorer depends on it.

**What it tracks:**

| Import type | Example | Tracked? |
|---|---|---|
| Static import | `import { X } from './Y'` | Yes |
| Dynamic import | `const X = await import('./Y')` | Yes |
| Re-export | `export { X } from './Y'` | Yes |
| Wildcard re-export | `export * from './Y'` | Yes |
| require() | `const X = require('./Y')` | Yes |
| Type-only import | `import type { X } from './Y'` | **No** (not runtime) |

**Barrel file resolution (the hard problem):**

Most codebases have barrel files — `index.ts` files that re-export from dozens of places. A naive import graph would say "LoginForm depends on `components/index.ts`." That's useless. We need to know *which specific component* it actually uses.

```
       The Problem                              Pelican's Solution
  ─────────────────────                    ─────────────────────────────

  LoginForm.tsx                            Pass 1: Index barrels
    │                                      ┌─────────────────────────┐
    └─ import { Button }                   │ components/index.ts:    │
         from '@/components'               │   Button  → ./Button    │
              │                            │   Modal   → ./Modal     │
              ▼                            │   Input   → ./Input     │
    components/index.ts  ← barrel          └─────────────────────────┘
      export { Button } from './Button'
      export { Modal }  from './Modal'     Pass 2: Resolve edges
      export { Input }  from './Input'     ┌─────────────────────────┐
              │                            │ LoginForm.tsx            │
              ▼                            │   └─► Button.tsx         │
    We need the edge to go                 │       (not index.ts)     │
    to Button.tsx, not index.ts            └─────────────────────────┘
```

**Transitive analysis — ripple effects:**

```
  You change: src/utils/formatDate.ts

  ┌──────────────────────────────────────────────────────────┐
  │                                                          │
  │  formatDate.ts        ◄── YOU CHANGED THIS               │
  │       │                                                  │
  │       ├─── imported by ──► EventCard.tsx    (depth 1)    │
  │       │                        │                         │
  │       │                        └──► EventList.tsx (d.2)  │
  │       │                                  │               │
  │       │                                  └──► App.tsx    │
  │       │                                       (depth 3)  │
  │       │                                                  │
  │       ├─── imported by ──► InvoicePDF.tsx   (depth 1)    │
  │       │                                                  │
  │       └─── imported by ──► DatePicker.tsx   (depth 1)    │
  │                                 │                        │
  │                                 └──► SettingsForm.tsx    │
  │                                      (depth 2)           │
  │                                                          │
  │  Blast radius: 6 files                                   │
  │  Tests to suggest: events.cy.ts, invoice.cy.ts,          │
  │                    settings.cy.ts                         │
  │                                                          │
  └──────────────────────────────────────────────────────────┘
```

**Built-in alias resolution:**

Pelican reads your project configuration and resolves aliases automatically:

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  Priority:   1. tsconfig.json    (highest)                           │
│              2. vite.config.ts                                       │
│              3. webpack.config.js                                    │
│              4. User-supplied overrides (lowest, but never skipped)  │
│                                                                      │
│  Strategy:   Longest prefix match wins                               │
│                                                                      │
│  ┌──────────────────────┬────────────────────────────────┐          │
│  │ You write            │ Pelican resolves to           │          │
│  ├──────────────────────┼────────────────────────────────┤          │
│  │ @/pages/Login        │ src/pages/Login.tsx             │          │
│  │ @components/Button   │ src/components/Button.tsx       │          │
│  │ ~/utils/format       │ src/utils/format.ts             │          │
│  │ @store/auth          │ src/store/auth/index.ts         │          │
│  └──────────────────────┴────────────────────────────────┘          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

### `04` RouteAnalyzer

> *Maps every URL in your application to the React component that renders it. Turns `cy.visit('/login')` into "this test exercises `LoginPage.tsx`."*

**Three route definition styles — all supported:**

<table>
<tr>
<td>

**JSX Routes**
```tsx
<Routes>
  <Route path="/login"
    element={<LoginPage />} />
  <Route path="/users/:id"
    element={<UserProfile />} />
</Routes>
```

</td>
<td>

**Config Routes (v6.4+)**
```typescript
createBrowserRouter([
  { path: '/',
    element: <App />,
    children: [
      { path: 'login',
        element: <LoginPage /> },
      { path: 'users/:id',
        element: <UserProfile /> },
    ]
  },
]);
```

</td>
<td>

**Lazy Routes**
```typescript
const Login = lazy(() =>
  import('@/pages/Login')
);

{ path: '/login',
  element: <Login /> }
```

</td>
</tr>
</table>

**Nested path stitching:**

```
  Route tree:                    Resolved routeMap:
  ─────────────                  ──────────────────

  /                              /           → App.tsx
  ├── login                      /login      → LoginPage.tsx
  ├── dashboard                  /dashboard  → DashboardPage.tsx
  │   ├── overview               /dashboard/overview  → OverviewPanel.tsx
  │   └── analytics              /dashboard/analytics → AnalyticsPanel.tsx
  └── users                      /users      → UsersPage.tsx
      └── :id                    /users/:id  → UserProfile.tsx
          ├── posts              /users/:id/posts    → UserPosts.tsx
          └── settings           /users/:id/settings → UserSettings.tsx
```

**Why this matters — the chain reaction:**

```
  cy.visit('/users/123/settings')
       │
       ▼ routeMap lookup
  UserSettings.tsx
       │
       ▼ importGraph: what does UserSettings import?
  ┌─ useUserData.ts (hook)
  ├─ SettingsForm.tsx (child component)
  │     └─ FormField.tsx ◄── YOU CHANGED THIS
  └─ userValidators.ts

  Result: This test covers FormField.tsx
  Signal: ROUTE_MATCH, score: 0.85
```

---

### `05` ReduxChainAnalyzer

> *Traces the entire lifecycle of Redux state — from action dispatch to selector consumption — and links every file in the chain together.*

This is where Pelican goes deeper than any grep or import-trace ever could. In a real-world Redux codebase, state flows through **5-7 files** across multiple directories. Changing one file in the chain can break tests that touch completely different parts of the UI.

**How Redux role detection works:**

```
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│  File                              Detected As     How             │
│  ─────────────────────────────────────────────────────────────     │
│  src/store/auth/authSlice.ts       SLICE           createSlice()   │
│  src/store/auth/authActions.ts     ACTIONS          createAction()  │
│  src/store/auth/authReducer.ts     REDUCER          (state,action)  │
│  src/store/auth/authSelectors.ts   SELECTORS        createSelector()│
│  src/store/auth/authSagas.ts       SAGAS            function*       │
│  src/store/auth/authTypes.ts       TYPES            types only      │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**The chain that gets built:**

```
                        ╔═══════════════════════╗
                        ║    CHAIN: "auth"      ║
                        ╚═══════════╤═══════════╝
                                    │
            ┌───────────────────────┼──────────────────────┐
            │                       │                      │
    ┌───────▼────────┐    ┌────────▼────────┐    ┌───────▼────────┐
    │  authSlice.ts  │    │ authSelectors.ts│    │  authSagas.ts  │
    │                │    │                 │    │                │
    │ createSlice({  │    │ selectUser      │    │ function*      │
    │   name:'auth', │    │ selectToken     │    │ watchLogin()   │
    │   reducers:{   │    │ selectIsAdmin   │    │                │
    │     login,     │    │                 │    │ put(login())   │
    │     logout,    │    └────────┬────────┘    │ take(LOGIN)    │
    │     setUser    │             │              └────────────────┘
    │   }            │             │ imported by
    │ })             │             │
    └────────────────┘    ┌───────┴──────────────────────────┐
                          │                                   │
                ┌─────────▼──────────┐              ┌────────▼────────┐
                │  LoginPage.tsx     │              │  AdminPanel.tsx  │
                │                    │              │                  │
                │  useSelector(      │              │  useSelector(    │
                │    selectUser      │              │    selectIsAdmin │
                │  )                 │              │  )               │
                │  dispatch(login()) │              │                  │
                │                    │              │                  │
                │  CONSUMER          │              │  CONSUMER        │
                └────────────────────┘              └──────────────────┘
```

**What this means for testing:**

| You change | Chain affected | Consumers affected | Tests recommended |
|---|---|---|---|
| `authSlice.ts` | auth | LoginPage, AdminPanel | login.cy.ts, admin.cy.ts |
| `authSelectors.ts` | auth | LoginPage, AdminPanel | login.cy.ts, admin.cy.ts |
| `authSagas.ts` | auth | LoginPage, AdminPanel | login.cy.ts, admin.cy.ts |
| `loginAction` in slice | auth | LoginPage | login.cy.ts |

> **The non-obvious insight:** You changed `authSagas.ts` — a file that no test directly imports, that no route directly renders, that no selector directly references. But Pelican knows it's part of the auth chain, and every consumer of auth state is potentially affected.

---

### `06` I18nAnalyzer

> *The invisible bridge between your translation JSON and your Cypress `cy.contains()` assertions.*

This analyzer solves one of the most maddening problems in E2E testing: **your test asserts on English text, your source code uses translation keys, and nothing in between connects them.**

**The gap:**

```
  Your test:                     Your source:                Your JSON:
  ────────────                   ────────────                ──────────
  cy.contains('Sign In')        {t('login.submit')}         {"login":{"submit":"Sign In"}}

  ◄──── no connection ────►   ◄──── no connection ────►

  Until now.
```

**What the I18nAnalyzer builds:**

```
┌───────────────────────────────────────────────────────────────────┐
│                                                                   │
│  translationIndex                                                 │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ keyToText                                                   │ │
│  │   'login.submit'         → 'Sign In'                        │ │
│  │   'login.forgotPassword' → 'Forgot your password?'          │ │
│  │   'nav.home'             → 'Home'                           │ │
│  │   'errors.required'      → 'This field is required'         │ │
│  │   'greeting.hello'       → 'Hello {{name}}'      (dynamic) │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ textToKeys (normalized, lowercased)                         │ │
│  │   'sign in'              → ['login.submit']                 │ │
│  │   'forgot your password' → ['login.forgotPassword']         │ │
│  │   'home'                 → ['nav.home', 'footer.home']      │ │
│  │   'hello'                → ['greeting.hello']  (base text)  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ keyToFiles (which source files use each key)                │ │
│  │   'login.submit'         → { LoginForm.tsx }                │ │
│  │   'login.forgotPassword' → { LoginForm.tsx, ResetPage.tsx } │ │
│  │   'nav.home'             → { NavBar.tsx, Sidebar.tsx }      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ dynamicKeys (keys with interpolation variables)             │ │
│  │   'greeting.hello'  → template: 'Hello {{name}}'           │ │
│  │   'items.count'     → template: '{count} items remaining'   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

**Supported i18n formats:**

```
  Flat keys:         { "login.submit": "Sign In" }
  Nested objects:    { "login": { "submit": "Sign In" } }     → key: login.submit
  Namespaced files:  locales/en/auth.json → { "submit": "Sign In" }  → key: auth:submit
```

**Interpolation awareness:**

```
  Source text              Pattern           Stored as
  ──────────────────────────────────────────────────────
  "Hello {{name}}"         react-i18next     "Hello"     (base text for partial match)
  "{count} items left"     react-intl        "items left" (base text)
  "%(user)s logged in"     python-style      "logged in"  (base text)
```

---

<br/>

<div align="center">

# The Scoring Engine

*Ten specialized scorers. One formula. Zero guesswork.*

</div>

<br/>

### How Scores Are Calculated

Every scorer looks at a `(changedFile, testFile)` pair and returns **signals** — pieces of evidence for or against a connection.

```typescript
interface ISignal {
  source: string;                    // which scorer found this
  type: string;                      // e.g. 'DIRECT_IMPORT', 'SELECTOR_MATCH'
  weight: number;                    // 0.0 – 1.0 (how strong is this evidence?)
  matched: boolean;                  // did it find a connection?
  metadata?: Record<string, any>;    // extra data (matched selectors, routes, etc.)
  reason?: string;                   // human-readable: "Test imports changed file directly"
}
```

### The Score Formula

```
  Given:  signals = [all matched signals, sorted by weight descending]

  ┌─────────────────────────────────────────────────────────────┐
  │                                                             │
  │  finalScore = signals[0].weight                             │
  │             + min( sum(signals[1..n].weight) × 0.1,  0.05 )│
  │                                                             │
  │  (capped at 1.0)                                            │
  │                                                             │
  └─────────────────────────────────────────────────────────────┘

  In English:

  "The strongest signal wins.
   Additional signals add a small tiebreaker — but they
   can never carry the score on their own."
```

**Why this design?**

```
  Scenario A:  1 strong signal (direct import at 0.95)
               → score: 0.95
               → CORRECT: the test was literally written for this file

  Scenario B:  5 weak signals (all ~0.2 each)
               → score: 0.2 + min(0.8 * 0.1, 0.05) = 0.25
               → CORRECT: many weak clues ≠ strong evidence

  Scenario C:  1 strong (0.85) + 2 medium (0.70 + 0.60)
               → score: 0.85 + min(1.30 * 0.1, 0.05) = 0.90
               → CORRECT: strong signal + corroborating evidence = boost
```

### The Ubiquity Dampener

This is one of Pelican's most important features. Without it, **every test in your project** would score HIGH against shared utility files.

```
  Problem:
  ─────────────────────────────────────────────────
  src/utils/cn.ts   ← imported by 94% of files

  Without dampener:
    cn.ts changes → 94% of tests get signal weight 0.70+
    → Almost everything is HIGH confidence
    → Useless. Might as well run all tests.

  With dampener:
  ─────────────────────────────────────────────────
  If a file is imported by > 70% of the codebase:
    signal.weight *= 0.3  (reduced to 30%)

  cn.ts changes → signal weight: 0.70 × 0.30 = 0.21
    → LOW confidence for most tests
    → Only tests with ADDITIONAL strong signals survive

  The 70% threshold is configurable (ubiquityThreshold in config).
```

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  File                  Imported by    Ubiquitous?   Dampener     │
  │  ─────────────────────────────────────────────────────────────   │
  │  src/utils/cn.ts       94% of files   YES           × 0.30      │
  │  src/theme/colors.ts   81% of files   YES           × 0.30      │
  │  src/hooks/useAuth.ts  12% of files   no            × 1.00      │
  │  src/store/auth.ts      8% of files   no            × 1.00      │
  │  src/pages/Login.tsx    1% of files   no            × 1.00      │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

---

### All 10 Scorers

<table>
<tr>
<th>#</th>
<th>Scorer</th>
<th>Weight</th>
<th>What It Finds</th>
<th>Think Of It As...</th>
</tr>
<tr>
<td align="center"><strong>1</strong></td>
<td><code>DirectImportScorer</code></td>
<td><code>0.95</code></td>
<td>Test file directly imports the changed file</td>
<td>"The test was written for this file"</td>
</tr>
<tr>
<td align="center"><strong>2</strong></td>
<td><code>RouteMatchScorer</code></td>
<td><code>0.85</code></td>
<td>Test visits a route that renders the changed component (up to depth 3)</td>
<td>"The test walks through this page"</td>
</tr>
<tr>
<td align="center"><strong>3</strong></td>
<td><code>TranslationMatchScorer</code></td>
<td><code>0.85</code></td>
<td>Test's <code>cy.contains()</code> text matches source <code>t()</code> keys via i18n index</td>
<td>"The test reads text this file displays"</td>
</tr>
<tr>
<td align="center"><strong>4</strong></td>
<td><code>SelectorMatchScorer</code></td>
<td><code>0.80</code></td>
<td>Test's <code>data-testid</code>/<code>data-cy</code> selectors match source JSX attributes</td>
<td>"The test clicks what this file renders"</td>
</tr>
<tr>
<td align="center"><strong>5</strong></td>
<td><code>ReduxChainScorer</code></td>
<td><code>0.75</code></td>
<td>Both files participate in the same Redux slice chain</td>
<td>"They share the same state"</td>
</tr>
<tr>
<td align="center"><strong>6</strong></td>
<td><code>TransitiveImportScorer</code></td>
<td><code>0.70</code></td>
<td>Test imports file X, and X imports the changed file (one hop)</td>
<td>"A friend of a friend"</td>
</tr>
<tr>
<td align="center"><strong>7</strong></td>
<td><code>ReduxConsumerScorer</code></td>
<td><code>0.65</code></td>
<td>Test visits a route whose component consumes the affected Redux chain</td>
<td>"The page reads state you changed"</td>
</tr>
<tr>
<td align="center"><strong>8</strong></td>
<td><code>SelectorIdMatchScorer</code></td>
<td><code>0.65</code></td>
<td>Test <code>#id</code> selectors match source <code>id=""</code> attributes</td>
<td>"Matching by element ID"</td>
</tr>
<tr>
<td align="center"><strong>9</strong></td>
<td><code>FilenameConventionScorer</code></td>
<td><code>0.60</code></td>
<td>Normalized file names match (<code>LoginForm</code> ~ <code>login-form.cy.ts</code>)</td>
<td>"They were named after each other"</td>
</tr>
<tr>
<td align="center"><strong>10</strong></td>
<td><code>APIInterceptScorer</code></td>
<td><code>0.55</code></td>
<td>Test <code>cy.intercept()</code> URL pattern matches an API file path</td>
<td>"The test mocks this API"</td>
</tr>
</table>

---

**How each scorer traces a connection:**

**`DirectImportScorer`** — The smoking gun.

```
  login.cy.ts                        LoginForm.tsx
  ─────────────                      ──────────────
  import { validateEmail }  ────────►  export function validateEmail()
    from '../../src/utils/validators'

  Verdict:  This test was written to test this file.
  Signal:   DIRECT_IMPORT  weight=0.95
```

---

**`RouteMatchScorer`** — Following the URL.

```
  auth-flow.cy.ts                    Registry                     LoginForm.tsx
  ─────────────────                  ────────────────              ──────────────
  cy.visit('/login')  ──────►  routeMap['/login']
                                     │
                                     ▼
                               LoginPage.tsx
                                     │
                                     ▼ importGraph.getDependencies(depth ≤ 3)
                                     │
                               ┌─────┴──────┐
                               │ LoginForm   │◄─── CHANGED FILE FOUND HERE
                               │ AuthLayout  │
                               │ useAuth     │
                               └─────────────┘

  Verdict:  This test visits a page that renders the changed file.
  Signal:   ROUTE_MATCH  weight=0.85
```

---

**`TranslationMatchScorer`** — The invisible link.

```
  i18n-smoke.cy.ts                  i18n Index                    LoginForm.tsx
  ────────────────                  ──────────                    ──────────────
  cy.contains('Sign In') ──►  textToKeys['sign in']
                                     │
                                     ▼
                               'login.submitButton'
                                     │
                                     ▼ keyToFiles['login.submitButton']
                                     │
                               ┌─────┴──────────┐
                               │ LoginForm.tsx   │◄─── CHANGED FILE
                               └────────────────┘

  Verdict:  Test asserts on text that this file displays via i18n.
  Signal:   TRANSLATION_MATCH  weight=0.85
  Reason:   "Test text 'Sign In' → key 'login.submitButton' → LoginForm.tsx"
```

---

**`SelectorMatchScorer`** — The DOM fingerprint.

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  SOURCE (LoginForm.tsx):           TEST (login.cy.ts):           │
  │  ─────────────────────             ────────────────────          │
  │                                                                  │
  │  <form data-testid="login-form">   cy.get('[data-testid=        │
  │    <input data-cy="email" />           "login-form"]')           │
  │    <button data-testid=            cy.get('[data-cy="email"]')   │
  │      "login-btn">                  cy.get('[data-testid=         │
  │                                        "login-btn"]')           │
  │                                                                  │
  │  Matches found:  3 / 3                                           │
  │  Signal:  SELECTOR_MATCH  weight=0.80                            │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

---

**`ReduxChainScorer`** — Two strategies depending on test type.

```
  Strategy 1: Import-based (unit/integration tests)
  ─────────────────────────────────────────────────

  test imports authSelectors.ts  ←──┐
  changed file is authSlice.ts  ←───┤── both in chain "auth"
                                    │
  Signal: REDUX_CHAIN_MATCH  weight=0.75


  Strategy 2: Consumer-based (E2E tests, no direct Redux imports)
  ───────────────────────────────────────────────────────────────

  test visits /dashboard
       │
       ▼
  DashboardPage.tsx
       │
       └── imports selectUser from authSelectors (chain: "auth")

  changed file: authSagas.ts (also in chain: "auth")

  Signal: REDUX_CHAIN_CONSUMER  weight=0.75
```

---

**`TransitiveImportScorer`** — One degree of separation.

```
  navigation.cy.ts                    AuthLayout.tsx              LoginForm.tsx
  ────────────────                    ──────────────              ──────────────
  import { AuthLayout } ────────►  import { LoginForm } ────────►  CHANGED FILE
      from '../../layouts'              from '../features/auth'

  The test doesn't import LoginForm directly.
  But it imports something that does.

  Signal: TRANSITIVE_IMPORT  weight=0.70
```

---

**`FilenameConventionScorer`** — The fallback that's surprisingly useful.

```
  Normalization pipeline:

  Source:  LoginForm.tsx      →  remove ext  →  LoginForm   →  lowercase  →  loginform
  Test:    login-form.cy.ts   →  remove ext  →  login-form  →  lowercase  →  loginform
                                                                               │
                                                             strip non-alnum ──┘
                                                                    │
                                                                loginform === loginform  ✓

  Signal: FILENAME_MATCH  weight=0.60
```

---

**`APIInterceptScorer`** — Connecting API mocks to API code.

```
  Test:                                Changed file:
  ──────                               ───────────────
  cy.intercept('POST',                 src/api/auth/login.ts
    '/api/auth/login')                      │
         │                                  │
         └─── path segments match ──────────┘

  Applies when changed file path contains: /api/  /routes/  /handlers/
  Signal: API_INTERCEPT_MATCH  weight=0.55
```

---

### Confidence Levels

```
  Score         Level      Bar                     What to do
  ──────────────────────────────────────────────────────────────

  ≥ 0.80        HIGH       ████████████████████    Run this. Always.

  ≥ 0.40        MEDIUM     ██████████░░░░░░░░░░    Worth running. Real connection exists.

  < 0.40        LOW        ████░░░░░░░░░░░░░░░░    Tenuous. Skip in fast CI, include in nightly.
```

---

<br/>

<div align="center">

# Real-World Walkthroughs

*Three end-to-end traces showing how Pelican connects the dots no human would.*

</div>

<br/>

### Trace 1 — The Selector Bridge

> A junior dev changes a `data-testid` value and doesn't know 3 test files depend on it.

```
CHANGE: src/components/SearchBar.tsx
        ─ data-testid="search-input" → data-testid="search-field"

  Pelican runs the SourceExtractor:
    Old selectors: [{ attr: 'data-testid', value: 'search-input' }]
    New selectors: [{ attr: 'data-testid', value: 'search-field' }]

  Pelican runs the SelectorMatchScorer against all tests:

    search.cy.ts       → cy.get('[data-testid="search-input"]')     MATCH (old value)
    navigation.cy.ts   → cy.get('[data-testid="search-input"]')     MATCH (old value)
    home.cy.ts         → cy.get('[data-testid="search-input"]')     MATCH (old value)
    billing.cy.ts      → cy.get('[data-testid="amount-input"]')     no match
    login.cy.ts        → cy.get('[data-testid="email-input"]')      no match

  Result:
    search.cy.ts        HIGH   0.82   selector-match (search-input)
    navigation.cy.ts    HIGH   0.82   selector-match (search-input)
    home.cy.ts          HIGH   0.82   selector-match (search-input)

  Those 3 tests WILL FAIL after this change.
  Pelican caught all 3.
  Without Pelican, the dev merges. Three tests break in nightly.
```

---

### Trace 2 — The Translation Ghost

> A product manager asks to change the button text from "Sign In" to "Log In". The developer changes the JSON file. Which tests break?

```
CHANGE: public/locales/en/translation.json
        ─ "login.submit": "Sign In"  →  "login.submit": "Log In"

  Pelican rebuilds the i18n index:
    textToKeys['sign in'] is now gone
    textToKeys['log in']  = ['login.submit']
    keyToFiles['login.submit'] = { LoginForm.tsx, MobileLogin.tsx }

  Pelican runs the TranslationMatchScorer:

    login.cy.ts          → cy.contains('Sign In')
                           textToKeys['sign in'] → EMPTY (text changed!)
                           But LoginForm.tsx is in keyToFiles['login.submit']
                           And SourceExtractor shows LoginForm uses t('login.submit')
                           → Score: HIGH  "translation key login.submit"

    auth-flow.cy.ts      → cy.contains('Sign In')
                           Same chain → HIGH

    billing.cy.ts        → cy.contains('Pay Now')
                           No match → skip

  Result:
    login.cy.ts          HIGH   0.87   translation-match + route-match
    auth-flow.cy.ts      HIGH   0.85   translation-match

  Both tests will now fail because they assert on 'Sign In' which is now 'Log In'.
  Pelican knew because it traced: JSON value → key → source file → test assertion.
```

---

### Trace 3 — The Redux Ripple

> A backend engineer modifies the auth saga to add token refresh logic. Zero UI changes. Which Cypress tests need to run?

```
CHANGE: src/store/auth/authSagas.ts
        ─ Added: yield put(refreshToken()) in watchLogin saga

  Pelican runs the ReduxChainAnalyzer:
    authSagas.ts has role: SAGAS
    It belongs to chain: "auth"
    Chain "auth" members: authSlice, authSelectors, authSagas, authTypes
    Chain "auth" consumers: LoginPage, ProfilePage, HeaderNav, AdminPanel

  No test directly imports authSagas.ts.
  No test has a selector matching authSagas.ts.
  No test visits a route that renders authSagas.ts.

  But the ReduxChainScorer knows:
    login.cy.ts       → visits /login → LoginPage is a consumer of chain "auth"  → MATCH
    profile.cy.ts     → visits /profile → ProfilePage is a consumer              → MATCH
    admin.cy.ts       → visits /admin → AdminPanel is a consumer                 → MATCH
    billing.cy.ts     → visits /billing → BillingPage is NOT a consumer          → skip

  The ReduxConsumerScorer adds:
    dashboard.cy.ts   → visits /dashboard → DashboardPage imports selectUser     → MATCH

  Result:
    login.cy.ts        HIGH    0.81   redux-chain (auth) via LoginPage
    profile.cy.ts      MED     0.71   redux-consumer (auth) via ProfilePage
    admin.cy.ts        MED     0.67   redux-consumer (auth) via AdminPanel
    dashboard.cy.ts    MED     0.65   redux-consumer (auth) via DashboardPage

  A saga change with zero UI impact — and Pelican found 4 tests across 4 different
  routes that exercise the affected state. A grep would have found zero.
```

---

<br/>

<div align="center">

# Scenarios You've Lived Through

*Every team has these stories. Pelican exists because we got tired of living them.*

</div>

<br/>

### Scenario 1 — The New Dev's First PR

> It's your first week. You fixed a typo in a component. You have no idea which tests to run. You're about to become *that person* who breaks the build.

```
  Monday, 10:15 AM. You're new. You joined Thursday.

  You fixed a prop name in UserAvatar.tsx. One line. You're 90% sure
  it's fine. But this is a 200k-line codebase and you've read maybe
  300 lines of it.

  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  WITHOUT PELICAN:                                                │
  │                                                                  │
  │  You:     "Hey @team, I changed UserAvatar.tsx — which           │
  │            tests should I check?"                                │
  │                                                                  │
  │  Sarah:   (typing...)  "hmm, probably avatar.cy.ts"              │
  │  Mike:    (30 min later)  "oh also check profile.cy.ts,          │
  │           it uses that component in a card"                      │
  │  Sarah:   "wait, does the header still use the old avatar?"      │
  │  Mike:    "I think we migrated that... let me check"             │
  │  Mike:    (45 min later)  "yeah header-nav.cy.ts too"            │
  │                                                                  │
  │  Total time: 1 hour 15 minutes of your time + 2 engineers'      │
  │  time, for a ONE LINE CHANGE.                                    │
  │                                                                  │
  │  And Mike forgot about the onboarding flow. That breaks Friday.  │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  WITH PELICAN:                                                   │
  │                                                                  │
  │  $ pelican --changed src/components/UserAvatar.tsx               │
  │                                                                  │
  │  ● avatar.cy.ts             HIGH   0.95  direct-import           │
  │  ● profile-card.cy.ts       HIGH   0.87  selector-match          │
  │  ● header-nav.cy.ts         HIGH   0.83  route-match             │
  │  ● onboarding.cy.ts         MED    0.71  transitive-import       │
  │                                                                  │
  │  Total time: 2 seconds. Zero interruptions to the team.          │
  │  And it caught the onboarding flow that Mike wouldn't have.      │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

**The deeper problem Pelican solves here:** Institutional knowledge about test coverage lives in people's heads. When Sarah goes on vacation, when Mike switches teams, when the new dev joins — that knowledge is gone. Pelican makes it structural. It lives in the code, not in Slack threads.

---

### Scenario 2 — The "Which Tests Do I Run?" Slack Message

> Every team has this ritual. A developer changes code. A tester asks what broke. The developer guesses. The tester runs what they're told. Both miss something.

```
  The conversation that happens 15 times a day:

  #dev-qa channel:
  ────────────────────────────────────────────────────────────────────

  Dev:       "Hey QA, I pushed changes to the payment flow.
              Touched PaymentForm.tsx and the Stripe hook."

  Tester:    "Got it. I'll run the payment tests. Anything else?"

  Dev:       "Hmm, maybe the checkout flow? Not sure if it
              uses the same Stripe hook."

  Tester:    "OK I'll add that. What about the subscription page?"

  Dev:       "I don't think so... but maybe? Let me check."
              (opens 4 files, traces imports for 10 minutes)
              "Actually yeah, SubscriptionManager imports
              useStripePayment transitively through BillingProvider."

  Tester:    "OK so payment, checkout, AND subscription. Anything
              else or can I start?"

  Dev:       "I think that's it."

  Narrator:  It was not it. The invoice download page also
             uses the Stripe hook through a 3-level import chain
             that neither of them knew about.
```

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  WITH PELICAN:                                                   │
  │                                                                  │
  │  $ pelican --changed src/features/payment/PaymentForm.tsx \      │
  │                       src/hooks/useStripePayment.ts              │
  │                                                                  │
  │  ● payment.cy.ts            HIGH   0.97  direct-import           │
  │  ● checkout-flow.cy.ts      HIGH   0.91  route-match + selector  │
  │  ● subscription.cy.ts       HIGH   0.85  transitive-import       │
  │  ● invoice-download.cy.ts   MED    0.72  transitive (3 hops)     │
  │  ● billing-settings.cy.ts   MED    0.68  redux-consumer          │
  │                                                                  │
  │  The dev pastes this in Slack. The tester runs exactly these.    │
  │  No guessing. No "I think that's it." No missed invoice page.   │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

**What changes:** The developer-tester handoff goes from a 20-minute negotiation based on tribal knowledge to a 2-second command that produces a definitive, traceable answer. The tester trusts the output because it shows *why* each test was selected. The developer doesn't have to mentally trace import chains. Nobody has to guess.

---

### Scenario 3 — The Shared Component Refactor

> You're updating the design system. One component change. Fourteen teams use it. Nobody knows how many tests touch it.

```
  You're on the platform team. Design wants to update the Button
  component — new padding, new focus ring, slightly different
  height. You're about to change a file that half the app imports.

  The fear:
  ─────────────────────────────────────────────────────────────

  Button.tsx is imported by 47 components across 14 feature teams.
  Those components are tested by... how many test files? You have
  no idea. Your team owns Button. You don't own the tests.

  You COULD run all 1,247 tests. But your PR review will say:
  "CI took 43 minutes" and someone will ask why.

  You COULD ask all 14 teams. But that's 14 Slack messages, 14
  delayed responses, and 14 incomplete answers.

  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  $ pelican --changed src/design-system/Button.tsx                │
  │                                                                  │
  │  Analyzing... (Button.tsx is imported by 47 files)               │
  │  Ubiquity dampener: Button.tsx imported by 38% — NOT ubiquitous  │
  │                                                                  │
  │  ● button-variants.cy.ts     HIGH   0.95  direct-import          │
  │  ● login.cy.ts               HIGH   0.88  selector-match         │
  │  ● checkout.cy.ts            HIGH   0.86  selector-match         │
  │  ● signup-flow.cy.ts         HIGH   0.84  route → SignupForm     │
  │  ● settings.cy.ts            HIGH   0.82  selector-match         │
  │  ● modal-dialogs.cy.ts       MED    0.74  transitive-import      │
  │  ● admin-dashboard.cy.ts     MED    0.71  route → AdminPage      │
  │  ● search-results.cy.ts      MED    0.67  transitive-import      │
  │  ● onboarding.cy.ts          MED    0.64  route → OnboardPage    │
  │                                                                  │
  │  9 tests across 7 teams. Not 1,247. Not 0.                      │
  │                                                                  │
  │  And if Button were truly ubiquitous (imported by 70%+),         │
  │  the ubiquity dampener would kick in — only tests with           │
  │  ADDITIONAL strong signals would make the cut.                   │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

**The nuance here:** Pelican doesn't just find all 47 files that import Button. It finds the *tests* that exercise those files, scores them by real connection strength, and filters out the noise. A test that visits a page with a Button 4 levels deep is less relevant than a test that directly clicks `[data-testid="submit-btn"]`.

---

### Scenario 4 — The Friday 5 PM Hotfix

> Production is down. Users are seeing a blank screen. You found the bug — a null check in the data fetching hook. You need to fix it, test it, and ship it. Now.

```
  5:04 PM Friday. PagerDuty is screaming.

  The fix is one line:
    - const data = response.data;
    + const data = response?.data ?? [];

  In useDataFetcher.ts. A hook used by... a lot of things.

  You do NOT have 43 minutes for a full test suite.
  You do NOT have time to ask the team which tests to run.
  Half the team already left for the weekend.

  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  $ pelican --changed src/hooks/useDataFetcher.ts                 │
  │            --min-confidence high                                  │
  │                                                                  │
  │  ● data-table.cy.ts          HIGH   0.93  direct-import          │
  │  ● dashboard.cy.ts           HIGH   0.89  route + selector       │
  │  ● user-list.cy.ts           HIGH   0.87  direct-import          │
  │  ● search-results.cy.ts      HIGH   0.85  route-match            │
  │  ● analytics.cy.ts           HIGH   0.81  transitive-import      │
  │                                                                  │
  │  5 tests. 4 minutes. HIGH confidence only.                       │
  │  Enough to ship the hotfix with confidence.                      │
  │                                                                  │
  │  Monday morning, the nightly run will catch any LOW/MED edge     │
  │  cases. But right now, your users can see the page again.        │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

**Why `--min-confidence high` matters:** In an emergency, you don't need every tangentially-related test. You need the ones that *will definitely exercise your change*. Pelican's confidence levels let you dial the scope to match the urgency. HIGH for hotfixes. MEDIUM for normal PRs. Everything for nightly.

---

### Scenario 5 — The Config File Nobody Thinks About

> Someone updates the route configuration. No component code changed. No test fails locally. But 6 tests break in CI because the URLs shifted.

```
  The change seems harmless:

  // routes.config.ts
  - { path: 'settings', element: <SettingsPage /> }
  + { path: 'preferences', element: <SettingsPage /> }

  Just a rename. The component is the same. All the props are
  the same. The logic is identical.

  But in your test suite:
    cy.visit('/settings')         ← 3 tests do this
    cy.url().should('include', '/settings')  ← 2 more assert this

  None of them import routes.config.ts. A grep for "settings"
  returns 200+ results across the codebase. You can't tell
  which ones are route-related and which are unrelated.

  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  $ pelican --changed src/routes.config.ts                        │
  │                                                                  │
  │  Pelican rebuilds the routeMap:                                  │
  │    /settings is now gone                                         │
  │    /preferences → SettingsPage.tsx (new)                         │
  │                                                                  │
  │  ● settings.cy.ts            HIGH   0.92  route-match /settings  │
  │  ● user-preferences.cy.ts    HIGH   0.88  route-match /settings  │
  │  ● account.cy.ts             HIGH   0.84  route-match /settings  │
  │  ● navigation-smoke.cy.ts    MED    0.72  url-assertion          │
  │  ● sidebar-nav.cy.ts         MED    0.65  url-assertion          │
  │                                                                  │
  │  5 tests that will break. All because of a URL rename.           │
  │  Pelican caught them through route analysis, not string matching.│
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

**The insight:** Route changes are invisible to import analysis and difficult for grep. Pelican's RouteAnalyzer understands that `cy.visit('/settings')` is semantically connected to the route config — not because the test imports it, but because the test *navigates to a path it defines*.

---

### Scenario 6 — The Monorepo Migration

> Your team is migrating from feature folders to a packages-based monorepo structure. Imports are being rewritten. File paths are changing. Half the import aliases are broken. Which tests still pass?

```
  Week 3 of the monorepo migration. You just moved
  the entire auth feature from:
    src/features/auth/*  →  packages/auth/src/*

  73 files moved. Import paths rewritten with new aliases.
  The TypeScript compiler says it's fine. ESLint says it's fine.

  But your Cypress tests still use the old routes. Some tests
  import helpers from the old paths. Some tests assert on
  text that now comes from a different translation namespace.

  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  $ pelican --changed $(git diff --name-only main)                │
  │                                                                  │
  │  Analyzing 73 changed files...                                   │
  │                                                                  │
  │  ● login.cy.ts               HIGH   0.97  direct-import          │
  │    ├─ import path changed    ██████████████████░░  0.95           │
  │    └─ route still valid      ██████████████████░░  0.85           │
  │                                                                  │
  │  ● auth-flow.cy.ts           HIGH   0.94  route + selector       │
  │  ● registration.cy.ts        HIGH   0.91  route + translation    │
  │  ● password-reset.cy.ts      HIGH   0.89  route-match            │
  │  ● mfa-setup.cy.ts           HIGH   0.86  direct-import          │
  │  ● session-timeout.cy.ts     HIGH   0.83  redux-chain (auth)     │
  │  ● profile-security.cy.ts    MED    0.74  transitive-import      │
  │  ● admin-users.cy.ts         MED    0.71  redux-consumer         │
  │  ● audit-log.cy.ts           MED    0.68  redux-consumer         │
  │  ● onboarding.cy.ts          MED    0.62  transitive-import      │
  │                                                                  │
  │  10 tests to validate the migration. Not 1,247.                  │
  │  Run these 10 green, and you know auth works in its new home.    │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

**Why this is hard without Pelican:** During a migration, import paths change but semantic relationships stay the same. `LoginForm` still renders `[data-testid="login-btn"]`, still lives at `/login`, still uses `selectUser` from the auth Redux chain. Pelican traces these semantic connections regardless of where the files physically live.

---

<div align="center">

### The Pattern

</div>

Every scenario above shares the same root problem:

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                     │
  │  The knowledge of "which tests cover which code" exists             │
  │  somewhere in your organization.                                    │
  │                                                                     │
  │  But it's fragmented:                                               │
  │    • Partly in the senior dev's head (she wrote those tests)        │
  │    • Partly in the QA team's spreadsheet (last updated 3 months     │
  │      ago)                                                           │
  │    • Partly in tribal knowledge shared over Slack (good luck        │
  │      finding that thread)                                           │
  │    • Partly in nobody's head (the connection is too indirect        │
  │      for any human to track)                                        │
  │                                                                     │
  │  Pelican doesn't ask anyone.                                        │
  │  It reads the code and works it out.                                │
  │                                                                     │
  │  Every time. In 2 seconds. With receipts.                           │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

---

<br/>

<div align="center">

# Development

</div>

<br/>

### Setup

```bash
git clone https://github.com/dhart-tools/pelican.git
cd pelican
pnpm install
```

### Running Tests

```bash
pnpm test:v2     # Run all v2 analyzer/scorer tests
pnpm test:jest   # Run with Jest runner
pnpm lint        # ESLint with auto-fix
pnpm build       # TypeScript → dist/
```

### Project Structure

```
src/v2/
│
├── types/                            ── INTERFACES & CONTRACTS ──
│   ├── analyzers/
│   │   ├── base.ts                   IAnalyzer<TInput, TOutput>, ISignal
│   │   ├── source-extractor.ts       ISourceExtractionResult
│   │   ├── cypress-extractor.ts      ICypressExtractionResult
│   │   ├── redux-chain.ts            IReduxExtractionResult, IReduxChain
│   │   ├── i18n-analyzer.ts          II18nExtractionResult, ITranslationIndex
│   │   ├── route-analyzer.ts         IRouteExtractionResult
│   │   └── import-graph.ts           IImportGraphExtractionResult
│   ├── registry/
│   │   └── registry.ts               IRegistry, IFileEntry
│   ├── scorers/
│   │   └── base.ts                   IScorer, IScorerContext, IScoreResult
│   └── config.ts                     ISuggestorConfig
│
├── core/                             ── IMPLEMENTATIONS ──
│   ├── analyzers/
│   │   ├── base.ts                   BaseAnalyzer<TInput, TOutput>
│   │   ├── source-extractor/         TS AST → exports, selectors, i18n keys, Redux
│   │   ├── cypress-extractor/        Cypress AST → routes, selectors, intercepts
│   │   ├── redux-chain/              Redux files → named chains with consumers
│   │   ├── i18n-analyzer/            JSON translations → bidirectional key↔text index
│   │   ├── route-analyzer/           React Router → URL↔component map + AliasResolver
│   │   └── import-graph-analyzer/    Imports → bidirectional dep graph + AliasResolver
│   ├── registry/
│   │   ├── registry.ts               Central in-memory data store
│   │   ├── registry-builder.ts       Orchestrates analyzers, builds registry
│   │   └── path-utils.ts             normalizePath() — consistent relative paths
│   └── scoring/
│       ├── scoring-engine.ts          Runs scorers, computes final scores
│       ├── scoring-config.ts          Default weights and scorer ordering
│       └── scorers/
│           ├── base.ts                BaseScorer (createSignal, buildResult)
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
└── utils/                            ── SHARED ──
    ├── enums.ts                      EAnalyzerName, EScorerType, EConfidenceLevel, ...
    └── constants.ts                  BUILTIN_CYPRESS_COMMANDS (45+), regex patterns
```

### Extending Pelican

<details>
<summary><strong>Adding a new Analyzer</strong></summary>

```typescript
import { BaseAnalyzer } from '../base';
import { EAnalyzerName } from '../../../utils/enums';

interface IMyResult {
  // your extraction result shape
}

export class MyAnalyzer extends BaseAnalyzer<string, IMyResult> {
  name = EAnalyzerName.MY_ANALYZER;  // add to enum first
  version = '1.0.0';
  dependencies = [];  // e.g. [EAnalyzerName.IMPORT_GRAPH]

  extract(filePath: string): IMyResult {
    // Use ts.createSourceFile() to parse
    // Walk the AST, extract what you need
    return { /* ... */ };
  }

  index(result: IMyResult, registry: IRegistry): void {
    // Store into a new registry index
  }
}
```

</details>

<details>
<summary><strong>Adding a new Scorer</strong></summary>

```typescript
import { BaseScorer } from '../base';
import { EScorerType } from '../../../utils/enums';

export class MyScorer extends BaseScorer {
  name = EScorerType.MY_SCORER;  // add to enum first
  version = '1.0.0';
  weight = 0.70;  // choose based on signal reliability
  description = 'Detects X between changed files and tests';

  evaluate(
    changedFile: string,
    testFile: string,
    ctx: IScorerContext
  ): ISignal[] {
    const signals: ISignal[] = [];

    // Your logic: look up data in ctx.registry
    // Compare changedFile data vs testFile data

    if (/* connection found */) {
      signals.push(this.createSignal({
        type: 'MY_SIGNAL_TYPE',
        weight: this.weight,
        matched: true,
        reason: `Human-readable explanation of the match`,
      }));
    }

    return signals;
  }
}

// Then register it in scoring-config.ts
```

</details>

---

<br/>

<div align="center">

---

<br/>

```
  "The best test suite in the world is useless
   if you don't know which tests to run."
```

<br/>

**Built for the engineers who've spent too long watching CI spin.**

<br/>

[Report a Bug](https://github.com/dhart-tools/pelican/issues) &nbsp;&middot;&nbsp; [Request a Feature](https://github.com/dhart-tools/pelican/issues) &nbsp;&middot;&nbsp; [Contribute](./CONTRIBUTING.md)

<br/>

</div>
