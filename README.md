<div align="center">

<br/>

<img src="src/assets/pelican.png" alt="Pelican" width="180" />

# `pelican`

### You changed one file. Pelican tells you exactly which tests to run — and why.

*Out of an ocean of tests, almost none care about the change you just made.*
*Pelican scoops the handful that do.*

<br/>

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Tests](https://img.shields.io/badge/tests-jest-15A47A?style=flat-square&logo=jest&logoColor=white)
![Recall](https://img.shields.io/badge/recall-first-D9820A?style=flat-square)
![CI](https://img.shields.io/badge/built%20for-CI-0E343B?style=flat-square)

</div>

---

## It's 4:47 PM on a Thursday

You fixed a one-line bug in `cart-totals.ts`. The PR's ready. Then the question lands:

> *"Which tests should I run before we merge this?"*

You don't actually know. So you do one of three things, all bad:

- **Run everything** — 1,200 specs, 45 minutes, three coffees, and a CI bill nobody reads.
- **Run nothing relevant** — guess, miss the one spec that mattered, find out in production.
- **Ask the tester** — and your PR sits in a queue for 12, 24, 72 hours while someone hand-picks.

Pelican removes the question. Point it at your change; it reads the code, finds the few tests that genuinely exercise what you touched, and hands you a ranked list — each with a plain-English reason it made the cut.

---

## Before & After

<table>
<tr><th>Without Pelican</th><th>With Pelican</th></tr>
<tr valign="top">
<td>

```text
$ git push
→ wait for the tester to triage
→ "run the cart + checkout suites?"
→ run all 1,247 to be safe
→ ☕ ☕ ☕   (47 min)
→ merge, tomorrow
```

</td>
<td>

```text
$ pelican analyze
→ reads your diff
→ 9 tests that touch it, ranked
→ each with a reason
→ ✓ green in 4 min
→ merge, now
```

</td>
</tr>
</table>

---

## The big idea: recall first, precision second

Most test-selection tools chase precision and quietly drop real tests. Pelican refuses to. It works in two stages with a strict contract between them:

```text
                 ┌──────────────────────────────────────────────┐
   your change   │  1 · STATIC ENGINE          recall ≈ 100%     │
   ───────────►  │  analyzers + scorers  →  every test that      │
   (diff/files)  │  could plausibly be affected (a wide net)     │
                 └───────────────────────┬──────────────────────┘
                                         │  candidate pool
                                         ▼
                 ┌──────────────────────────────────────────────┐
   ranked,       │  2 · LLM RERANK (optional)  precision lift    │
   explained  ◄──│  reads the real diff + each test, drops only  │
   test list     │  the confidently-irrelevant — fail-open       │
                 └──────────────────────────────────────────────┘
```

- **Stage 1 never misses.** The static engine casts a wide, recall-safe net — if a change could plausibly break a test, that test is in the pool.
- **Stage 2 never silently cuts a real one.** The LLM only removes tests it is *confidently* sure are irrelevant; anything uncertain — or any model hiccup — is **kept**. Recall is preserved by construction.

No coverage data. No instrumentation. No CI history required. Just your code and `git`.

---

## Three things this saves you

### 1 · Your PR stops waiting on a human
A person used to read the diff and guess which tests to run — slow, easy to miss one, and a waste of your sharpest tester. Pelican picks them in seconds and tells you *why* each one matters. **Days of waiting → zero.**

### 2 · Regression that doesn't eat the week
CI runs the entire suite on every push — including the 99% your change couldn't touch. Pelican runs only what's affected. **Full coverage, a fraction of the time and cloud bill.**

### 3 · When the suite goes red, know who did what &nbsp; `coming soon`
Sanity or regression fails after a busy day — 100 mixed commits, many authors. Pelican traces the failing test back to the commits that touched its code and hands you a short suspect list. **No more blind bisecting.**

---

## Quick start

```bash
# 1. install + build
npm install
npm run build
npm link              # puts `pelican` on your PATH

# 2. tell Pelican where your code (and tests) live
pelican setup         # interactive — writes .pelicanrc.json

# 3. analyze a change
pelican analyze --files src/cart-totals.ts
pelican analyze --base main --target HEAD     # everything in this branch
pelican analyze --ci > selected-tests.json    # machine-readable for CI
```

No global install yet? Run it straight from the repo with `npm run dev -- analyze --files <path>`.

---

## Configuration

Everything lives in **`.pelicanrc.json`** at your repo root, in four clear blocks: **`source`** (where your app code is), **`test`** (where your specs are), **`behaviour`** (how it scores), and **`rerank`** (the optional LLM pass).

```jsonc
{
  "source": {
    "root": ".",                        // path to the app repo (required)
    "dirs": ["src"],                    // where to scan for source
    "ignoreDirs": ["dist", "coverage"], // extra dirs to skip (node_modules/.git always skipped)
    "pathAliases": { "@dm/": "src/dm/" },
    "selectorAttributes": ["data-testid", "data-cy"],
    "imports": true,
    "routes":  { "enabled": true,  "routerFile": "" },
    "redux":   { "enabled": true,  "storeDirs": [] },
    "i18n":    { "enabled": true,  "library": "react-i18next", "localesPath": "" }
  },

  "test": {
    "root": "bic-unity-dm-tests",       // optional — defaults to source.root (single repo)
    "patterns": ["**/*.cy.ts", "**/*.spec.ts"],
    "pathAliases": { "@fixtures/": "cypress/fixtures/" },
    "exclude": ["**/*InterOps*/**", "**/dmSanity.cy.ts"]
  },

  "behaviour": {
    "minConfidence": 0.6,               // keep cutoff
    "highConfidence": 0.8,              // HIGH vs MEDIUM band
    "maxResults": 10,
    "requireAnchor": true,              // drop matches with no file-identity signal
    "ubiquityThreshold": 0.7,
    "ubiquitousSelectorThreshold": 0.1,
    "routeTrafficDampingExponent": 1,
    "filenameAmbiguityShare": 0.1,      // generic filename tokens stop anchoring on their own
    "temporal": {                       // git-timing scorer (creation + co-change)
      "creationWindowSoftDays": 14,
      "creationWindowHardDays": 28,
      "updateWindowDays": 14,
      "maxCommitFiles": 30,             // bigger commits = bulk/refactor, ignored for coupling
      "maxWeight": 0.45
    }
  },

  "rerank": {
    "enabled": false,                   // turn on to add the LLM precision pass
    "provider": "openrouter",
    "model": "nvidia/nemotron-3-nano-30b-a3b",
    "apiKeyEnv": "OPENROUTER_API_KEY",  // env var NAME — preferred over inline apiKey
    "candidateBand": { "min": 0.4, "max": 1.0 },
    "protectAnchors": false,            // judge anchors too (don't auto-keep)
    "dropConfidence": 0.9,              // only drop a CONFIDENT rejection — the recall guard
    "skipCosmeticChanges": true,        // whitespace/format-only diff → select nothing
    "judgeMode": "strict",              // "primarily exercises" vs broad "could break"
    "highPrecision": false,             // true = send the whole changed file + diff
    "maxCandidates": 40,
    "concurrency": 4,
    "maxRetries": 3,
    "timeoutMs": 30000
  }
}
```

> **Two repos?** Source and tests in separate checkouts (e.g. `dm-web` + `bic-unity-dm-tests`)? Set `test.root` to the test repo. Pelican scans both, resolves cross-repo imports through `pathAliases`, and tracks each file's own git history.

> **Security:** prefer `apiKeyEnv` (the env-var *name*) over an inline `apiKey` — a config file gets committed, shared, and logged. If you use inline `apiKey`, keep `.pelicanrc.json` out of version control.

---

## The LLM rerank, in plain terms

Static analysis is great at *recall* but floods on *precision*: a change to `cart.ts` matches every spec that mentions "cart". The rerank fixes that by actually reading the change and each candidate — and it's engineered so it **can never cost you recall**.

| Knob | What it does |
|---|---|
| `enabled` | Off by default. No key set → Pelican warns loudly and falls back to structural results. |
| `model` | Any OpenRouter slug. Default is a small, fast NVIDIA Nemotron that reasons well; add `:free` to run at $0 (rate-limited), or keep it paid for no per-minute cap. |
| `candidateBand` | Only tests scoring in `[min, max)` are judged; below `min` already gone, at/above `max` auto-kept. |
| `dropConfidence` | **The recall guard.** A test is dropped *only* when the model says "not relevant" with confidence ≥ this (default `0.9`). Any doubt → kept. |
| `judgeMode` | `strict` = keep only tests that *primarily exercise* the change (matches how a tester picks). `broad` = keep anything a regression *could* break. |
| `skipCosmeticChanges` | A whitespace / formatting / comment-only diff can't break anything, so it selects **zero** tests. Text inside strings/JSX is treated as behavioural — never wrongly skipped. |
| `highPrecision` | Sends the whole changed file alongside the diff for maximum context. |

**Fail-open everywhere.** Missing key, bad model, a timeout, a rate-limit, an unparseable reply — every failure path *keeps* the candidate. The LLM can only ever remove a test it explicitly, confidently judged irrelevant.

**It explains itself.** Each kept test carries the model's own reasoning, anchored to your diff:

```text
▲ MUST RUN
   cart-totals.cy.ts
     ─ Direct Impact · @cart-totals.ts
       the change to formatTotal() drives the price the test asserts on
```

---

## CLI reference

```bash
pelican analyze [options]      # the main event — suggest tests for a change
pelican setup                  # interactive config wizard → .pelicanrc.json
pelican registry …             # build / inspect the static registry cache
pelican model                  # manage the rerank model
pelican theme <dark|light>     # color theme
pelican demo                   # guided walkthrough, no setup required
```

### `pelican analyze` options

| Flag | Meaning |
|---|---|
| `-f, --files <paths…>` | Analyze specific changed files (space- or comma-separated) |
| `-b, --base <ref>` / `-t, --target <ref>` | Derive the change from a git range (default `HEAD~1..HEAD`) |
| `-o, --output <tui\|json\|list>` | Output format (default `tui`) |
| `--ci` | Non-interactive, JSON to stdout — for pipelines |
| `--min-confidence <n>` / `--max-results <n>` | Override config thresholds for this run |
| `--all` | Show every suggestion (ignore the result cap) |
| `--expanded` | Per-source-file breakdown instead of the combined list |
| `--debug` | Write full scoring diagnostics to `./analyze-debug.log` |
| `--no-cache` | Bypass the `.pelican.lock` cache |
| `-c, --config <path>` | Use a specific config file |

---

## CI integration

```yaml
# .github/workflows/test.yml
- name: Pick the tests that matter
  run: |
    pelican analyze --base origin/main --target HEAD --ci > picked.json
    npx cypress run --spec "$(jq -r '.results[].suggestedTests[].testFile' picked.json | paste -sd,)"
```

Add `rerank.enabled` and an `OPENROUTER_API_KEY` secret and the same command runs the LLM precision pass — recall stays safe, the list gets tighter.

---

## Under the hood

<details>
<summary><b>The analyzers</b> — how raw code becomes signals</summary>

<br/>

Each source and test file is parsed once (TypeScript AST) into a structured registry entry. The analyzers extract:

- **Source extractor** — exports, imports, components, selectors (`data-testid` / `data-cy`), JSX text, translation keys, redux usage, action-type strings.
- **Cypress / spec extractor** — `describe`/`it` blocks, `cy.*` commands, visited routes, intercepted APIs, asserted text, selectors. Framework-agnostic: jest/vitest specs populate the same shape.
- **Import graph** — resolves relative + aliased imports (and tsconfig `baseUrl`), expands barrel re-exports into direct edges, so transitive dependencies are visible.
- **Route analyzer** — React Router `<Route>`, data-routers, and `lazy()` imports → a route → component map.
- **Redux-chain analyzer** — groups slices, reducers, selectors, and sagas into coherent state chains.
- **i18n analyzer** — translation keys → the text tests assert on.

</details>

<details>
<summary><b>The scoring engine</b> — how the candidate pool is built</summary>

<br/>

Sixteen scorers each emit weighted signals for a *(changed file, test)* pair; the engine combines them with **noisy-or** (`1 − ∏(1 − wᵢ)`), so independent evidence accumulates without ever exceeding 1.

**Anchor gate (the precision lever).** A candidate is kept only if it carries a *file-identity* anchor — a narrow one (`direct-import`, `filename-match`, `colocation`) or a medium one (`route-match`, `selector-match`, `transitive-import`) when the changed file isn't a hub. Tests matched only by broad domain signals are suppressed. This is what stops hub-file floods while preserving recall — every true positive carries an anchor.

**The scorers:** direct-import · transitive-import · filename-convention · colocation · route-match · selector-match · selector-id-match · dependent-selector · redux-chain · redux-consumer · action-type · translation-match · api-intercept · describe-block · usage-site · temporal-coherence.

**Dampeners keep it honest:** the ubiquity dampener fades signals from app-wide hub files; ubiquitous selectors (used by >10% of specs) are disqualified as matches; filename matches on generic, corpus-common tokens stop anchoring on their own; high-traffic routes are damped on transitive matches.

**Temporal coherence** corroborates with git timing — tests created or co-changed alongside the source — cross-repo safe (it correlates by timestamp, not commit SHA) and strictly additive: it can lift a weak match but never lower one.

</details>

<details>
<summary><b>Confidence bands</b></summary>

<br/>

Scores map to three bands you actually act on:

| Band | Meaning |
|---|---|
| **MUST RUN** | High confidence — a direct, structural tie to the change |
| **SHOULD CHECK** | Medium — a real but less certain connection |
| **GOOD TO HAVE** | Low — worth a glance if the area is sensitive |

Tune the cutoffs with `behaviour.minConfidence` (keep/drop) and `behaviour.highConfidence` (HIGH vs MEDIUM).

</details>

---

## Development

```bash
npm run dev -- analyze --files src/foo.ts   # run from source (tsx, no build)
npm run build                               # typecheck + bundle to dist/
npm test                                    # jest
npm run lint                                # eslint --fix
```

**Project layout**

```text
src/
  cli/            commands (analyze, setup, registry, model, theme, demo), views, config
  core/
    analyzers/    AST extraction → signals
    registry/     the file registry + two-repo builder
    scoring/      the engine, anchor gate, 16 scorers
    git/          per-repo history provider (creation + co-change)
    rerank/llm/   provider abstraction, OpenRouter, the recall-safe reranker
  types/          shared contracts
```

**Adding a scorer:** implement `IScorer` (`evaluate(changedFile, testFile, context) → ISignal[]`) and register it in `analyze.tsx`. Keep it additive — emit signals, never veto.

---

<div align="center">

### Small bird. Sharp beak. Fewer tests.

*Pelican picks what matters, so your people — and your robots — stop wasting time on what doesn't.*

</div>
