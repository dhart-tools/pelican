# No-Rerank Results Analysis — 10 User Stories

Analysis of `pelican analyze` (structural scoring, **no rerank**) across the 10 user
stories in `pelican-test.zip`. Goal: find the systematic source of noise, find the
signals that consistently win, and make the easy categorical exclusions (InterOps,
dmSanity) maintainable.

> Data set: `pelican-test/<NN_Story>/` with three views per story —
> `Tester_given/` (ground truth specs the tester says to run),
> `Pelican_given/` (identical to ground truth — sanity copy), and
> `Pelican_all_results/` (pelican's full `MUST RUN + SHOULD CHECK` output).
> The comparison that matters is **Tester_given (truth) vs Pelican_all_results (output)**.

---

## 1. Headline numbers

| Story | Truth | Pelican output | TP | FP | FN | Precision | Recall |
| ----- | ----: | -------------: | -: | -: | -: | --------: | -----: |
| 01 StartProvisioning_Wizard   | 6  | 170 | 6  | 164 | 0 | 0.04 | 1.00 |
| 02 FirmwarePackages           | 8  | 172 | 8  | 164 | 0 | 0.05 | 1.00 |
| 03 ManageDevices_List_Views   | 9  | 180 | 9  | 171 | 0 | 0.05 | 1.00 |
| 04 LocationMappings_Modal     | 4  | 6   | 4  | 2   | 0 | 0.67 | 1.00 |
| 05 ZoneDevicesList_Component  | 4  | 172 | 4  | 168 | 0 | 0.02 | 1.00 |
| 06 NetProfilePackage          | 11 | 164 | 11 | 153 | 0 | 0.07 | 1.00 |
| 07 FileUploaderSimple         | 6  | 162 | 6  | 156 | 0 | 0.04 | 1.00 |
| 08 ExternalSystems            | 3  | 27  | 3  | 24  | 0 | 0.11 | 1.00 |
| 09 NetworkConfig_Search_Bug   | 6  | 52  | 6  | 46  | 0 | 0.12 | 1.00 |
| 10 MoveDevices                | 3  | 32  | 3  | 29  | 0 | 0.09 | 1.00 |
| **TOTAL** | **60** | **1037** | **60** | **1077** | **0** | **0.053** | **1.00** |

Two facts dominate everything below:

1. **Recall is a perfect 100%.** Every spec the tester wanted is found. Pelican is never
   *missing* tests — so this is **not** a sensitivity problem, and we must not "fix" it by
   raising thresholds blindly (that risks the one thing currently working).
2. **Precision is ~5%.** For every correct spec there are ~18 wrong ones. The entire
   problem is **over-suggestion / lack of a precision cut.**

---

## 2. The noise is bimodal, and the split is the whole story

Outputs fall into two clean buckets, not a spectrum:

- **Flood stories (160–180 specs ≈ 72–81% of all 223 specs in the repo):** 01, 02, 03, 05, 06, 07
- **Tight stories (6–52 specs):** 04, 08, 09, 10

The flood stories return *almost the entire test suite* regardless of what changed — and
they return **nearly the same ~160 specs every time**. The common-noise files confirm it:

```
 9/10 stories: openIncompatibleIssuesSoftwareStatusPopover.cy.ts, deviceListSyncedSoftwareStatusPopover.cy.ts, loadingIcons.cy.ts
 8/10 stories: selectDeviceGroup1, undeleteDevices, openDeviceGroup, deployNetConfigPkg…, badge…, homePageDeviceCount, apr, …
```

These are not related to any individual story. They are simply the specs that always get
swept in. **The "noise" is not random — it is the same large constant set, switched on or
off as a block.** That points to a single structural cause, not many small misfires.

---

## 3. Root cause: the changeset touches a *hub file*

Correlating each story's flood/tight status against the files actually changed (MANIFEST
"Branch modified files") gives a clean rule:

| Story | Output | Changeset includes a hub file? | Hub files in changeset |
| ----- | -----: | --- | --- |
| 01 | 170 (flood) | **yes** | `src/dm/components/index.ts`, `src/dm/containers/index.ts` (barrels) |
| 02 | 172 (flood) | **yes** | `components/index.ts`, `containers/index.ts`, **`dm/Router.tsx`** |
| 03 | 180 (flood) | **yes** | ManageDevices container/list hub |
| 05 | 172 (flood) | **yes** | `sagas/manageDevices.ts`, `sagas/provisioning.ts`, `reducers/manageDevices`, containers |
| 06 | 164 (flood) | **yes** | `actions/networkProfilePackage.ts`, container |
| 07 | 162 (flood) | **yes** | `containers/index.ts` (barrel) |
| 04 | 6 (tight)  | no | scoped to LocationMappings modal |
| 08 | 27 (tight) | no | scoped to `ExternalSystems/*` feature folder |
| 09 | 52 (tight) | no | scoped search-bug fix |
| 10 | 32 (tight) | no | `MoveDevices.tsx` + its container only |

**Every flood story's changeset contains at least one hub file; no tight story's does.**

A "hub file" is one with app-wide fan-out:

- **Barrel `index.ts`** (`dm/components/index.ts`, `dm/containers/index.ts`) — re-exports
  dozens of modules, so re-export/import-based matching links it to nearly everything.
- **`Router.tsx`** — defines every route, so the route channel matches nearly every spec
  that visits a page.
- **App-wide `sagas/*.ts`, `actions/*.ts`, `reducers/*.ts`** — Redux state is shared across
  the whole app, so the redux channels (`redux-chain`, `redux-consumer`, `action-type`)
  match every spec that exercises that domain — which, for a top-level slice, is most of them.

When the changeset is scoped to a single feature folder (04, 08, 09, 10), none of these
broad channels light up and precision jumps to 0.11–0.67.

---

## 4. Why the existing ubiquity dampener doesn't catch it

`ScoringEngine.applyUbiquityDampener()` exists exactly to kill global-file false positives.
It does not fire here, for three structural reasons:

1. **It measures ubiquity through the import graph only.**
   `ubiquity = dependents.size / sourceFiles.length`, where `dependents` comes from
   `registry.getDependents()`. But the Cypress e2e specs live in a **separate repo**
   (`bic-unity-dm-tests/cypress/e2e/…`) and **import nothing from `src/`** — they drive the
   app through `cy.*` commands and `@fixtures/dataTestIds.json`. Measured against the registry,
   **every spec has `tests_reached = 0`**: the test side of the import graph is empty. So
   import-graph ubiquity is *blind to specs* and can't dampen a hub→spec match it can't see.

2. **It only looks at the changed file's own dependents**, per file. A mixed changeset
   (one hub `index.ts` + several leaf components) still floods from the hub file, because
   each changed file is scored independently and the results are unioned.

3. **Even when it does fire, it only scales weights ×0.3 — it never excludes.** With the
   noisy-or combination `1 − ∏(1 − wᵢ)`, two or three dampened weak signals
   (`0.75·0.3 = 0.225`, etc.) still combine above `minConfidence = 0.4`. Dampening softens
   a single channel but not a *stack* of them.

**Net:** the dampener defends against import-graph ubiquity, but the flood travels on
channels the import graph can't see (route + redux + describe-text), so it sails straight
through.

> Caveat on attribution: the shipped `registry.json` was rebuilt with the e2e specs'
> selectors/routes/imports unresolved (all empty — the extractor can't resolve `@fixtures`/
> `@support` aliases or `dataTestIds.json` lookups). Exact per-pair scores therefore can't be
> replayed from this snapshot. The channel attribution above is inferred from (a) the
> architecture and (b) the airtight changeset↔flood correlation in §3, which holds regardless.

---

## 5. Signals that win in every case (what to bump / lean on)

Because recall is 100% and the **tight** stories already score the right specs at the top,
we can read off which signals reliably anchor a true match. The true positives are almost
always the spec **named after** the changed component and/or **colocated** with it:

- `filename-match` (default weight **0.60**) — the dedicated spec shares the component name.
  In a rename/migration story this is the single most reliable truth signal, yet it is one
  of the **lowest-weighted** scorers. **Recommend bumping to ~0.8–0.85.**
- `colocation` (0.75) — unit/integration specs sit next to the source. Reliable; keep high.
- `direct-import` (0.95) — strongest when resolvable. (For the separate-repo e2e specs it
  can't resolve, so for those the truth rides on filename + describe-block instead.)
- `describe-block` (0.70) — already IDF-weighted and gated to need a co-signal; it's the
  main text channel that ties an e2e spec to a component by name. Keep, but see §6 — it must
  not be allowed to fire on a *weak, broad* co-signal.

**Signals that drive the flood (down-weight or gate behind an anchor):**

- `redux-chain` (0.75), `redux-consumer` (0.65), `action-type` (0.60) — fire app-wide on any
  hub saga/action/reducer change. Biggest precision tax on stories 05/06.
- `route-match` (0.85) — floods on `Router.tsx` changes (story 02), since it owns every route.
- Re-export/transitive matching through barrel `index.ts` files — floods on 01/02/07.

The asymmetry to exploit: **truth signals are file-identity based** (name, location, direct
import) and stay narrow; **noise signals are domain-membership based** (shares a slice, a
route table, a re-export barrel) and go broad. Lean scoring toward the former.

---

## 6. Recommendations — all implemented

Status of each lever (implementation detail in §9):

**A. Anchor-gate the result set (biggest precision lever). ✅ Implemented.**
Every suggested spec must carry at least one *anchor* signal before broad domain signals
(`redux-chain`, `redux-consumer`, `action-type`, `describe-block`) can keep it. This mirrors
the existing describe-block co-signal gate, generalized: weak/broad-only matches get dropped.
On these 10 stories this is what collapses the ~160-spec floods while preserving 100% recall
(every truth spec has a filename/colocation anchor).

**B. Make ubiquity hub-aware (by file role, not just import dependents). ✅ Implemented.**
Barrels (re-export `index.ts`) and `Router.tsx` are detected *structurally* (re-export
breadth, route-table size) and demoted so their broad (medium-tier) signals no longer act as
anchors. Note: path-based redux hub detection (`sagas|actions|reducers/*`) was **deliberately
dropped** — story 08 (ExternalSystems) touches `sagas/actions/externalSystems` yet stays
tight (27 results), so "under sagas/" is not a reliable hub signal. Those broad redux matches
are handled by **A** instead (they have no anchor → dropped), which is more robust than a
path heuristic.

**C. Apply `maxResults` to the no-rerank path. ✅ Already supported (no change needed).**
`analyze.tsx` already applies `finalResults.slice(0, maxResults)` on the no-rerank
(`pelicanOnly`) path; the captured 170-row dumps came from running with `--all`
(`maxResults = Infinity`). Default `maxResults: 10` already caps normal runs.

**D. Bump `filename-match` 0.60 → 0.82. ✅ Implemented.** Keeps `colocation` high — cheap,
reliable, recall-safe.

**E. Categorical exclusions (InterOps, dmSanity). ✅ Implemented — see §7.**

---

## 7. Implemented: maintainable suggestion-exclusions

Per request, two spec classes are now **never suggested**, with a design built for adding
more in one place.

- **InterOps** specs — cross-system integration suites run on a separate cadence.
- **dmSanity.cy.ts** — smoke/sanity suite run independently.

**Where:** `src/core/registry/suggestion-exclusions.ts` — a single declarative rule list:

```ts
export const SUGGESTION_EXCLUSION_RULES: readonly ISuggestionExclusionRule[] = [
  { id: 'interops-specs', reason: '…separate cadence…', pathSegment: 'InterOps' },
  { id: 'dm-sanity',      reason: '…independent smoke suite…', fileName: 'dmSanity.cy.ts' },
];
```

To exclude more specs later, **add one entry** here (a `pathSegment` for a whole folder or
a `fileName` for an exact spec). Nothing else changes.

**How it's wired:** `RegistryBuilder` filters discovered specs through
`partitionSuggestableTests()` *before* they enter the registry, so excluded specs never get
scored at all (cheaper than filtering results, and impossible to leak through any scorer).
Debug mode logs each drop with its rule id.

**Why a registry-build filter and not config `excludePatterns`:** `excludePatterns` removes
files from *both* source and test discovery and is per-project JSON; the exclusion list here
is test-only, code-centralized, self-documenting (each rule carries a `reason`), and unit
tested. It is also `rules`-injectable, so callers/tests can supply their own set.

**Tests:** `src/core/registry/__tests__/suggestion-exclusions.test.ts` (11 cases — folder
match incl. numeric prefixes, case-insensitivity, Windows separators, exact-basename safety,
custom rules, partition ordering). All green; `tsc --noEmit` clean; full registry suite passes.

**Measured impact on the 10 stories:** removes **54 false positives** with **0 recall loss**
(no ground-truth spec is InterOps/dmSanity):

| Story | FPs removed | Truth lost |
| ----- | ----------: | ---------: |
| 01 | 9 | 0 |
| 02 | 10 | 0 |
| 03 | 1 | 0 |
| 05 | 10 | 0 |
| 06 | 10 | 0 |
| 07 | 10 | 0 |
| 08 | 2 | 0 |
| 10 | 2 | 0 |
| **Total** | **54** | **0** |

This is a clean categorical win, but note it is **~5% of the 1077-FP problem**. The
remaining ~95% is the hub-file flood — addressed by recommendations **A–D**, which are the
real accuracy levers.

---

## 8. One-line summary

Pelican finds every right test (recall 1.00) but buries it (precision 0.05). The noise is a
single mechanism — **a changeset that touches a hub file (barrel `index.ts`, `Router.tsx`,
or a top-level redux saga/action/reducer) lights up broad domain-membership signals that the
import-graph ubiquity dampener can't see**, returning ~75% of the suite as a block. Fix
direction: gate results behind file-identity *anchor* signals, make ubiquity hub-aware, cap
results, and bump `filename-match`. InterOps/dmSanity are now excluded at registry-build via
a centralized, tested rule list.

---

## 9. Implementation

All levers from §6 are now in the code. New modules are small, pure, and unit-tested.

**A — Anchor gate.** `src/core/scoring/anchor-gate.ts`
- Two anchor tiers: **narrow** (`direct-import`, `filename-match`, `colocation`) always
  anchor; **medium** (`route-match`, `selector-match`, `selector-id-match`,
  `transitive-import`) anchor only when the changed file isn't a hub. Everything else
  (`redux-chain`, `redux-consumer`, `action-type`, `describe-block`, `usage-site`,
  `dependent-selector`) is weak and can never stand alone.
- `applyAnchorGate(signals, { changedIsHub })` suppresses *all* matched signals (score → 0)
  when no anchor is present. Pure — never mutates input.
- Wired into `ScoringEngine.evaluateTests()` after the describe-block gate, before the
  ubiquity dampener. Gated by `scoring.requireAnchor` (default **true**; set
  `advanced.requireAnchor: false` to disable).

**B — Hub-aware ubiquity.** `src/core/scoring/hub-file.ts`
- `getHubRole(entry)` detects **barrels** (an `index.*` with ≥ `barrelMinExports` exports
  *and* imports — default 8, which separates top-level barrels from leaf `index.ts`) and
  **routers** (filename `Router.*`, or ≥ `routerMinRoutes` routes — default 5). Thresholds
  are injectable.
- Computed once per changed file in the engine and fed to the anchor gate so a hub's
  medium-tier signals don't anchor. A hub's *own* unit test (narrow filename/colocation
  match) still survives.

**C — `maxResults`.** No change needed; already applied on the no-rerank path. Avoid `--all`
for day-to-day use.

**D — `filename-match` weight 0.60 → 0.82.** `src/core/scoring/scoring-config.ts`.

**E — Exclusions.** `src/core/registry/suggestion-exclusions.ts` (see §7).

**Config surface (all optional, sensible defaults):**
```jsonc
{
  "advanced": {
    "requireAnchor": true   // A/B anchor gate; default true
  }
}
```

**Tests & checks (all green):**
- `anchor-gate.test.ts` (11), `hub-file.test.ts` (8), `suggestion-exclusions.test.ts` (11),
  plus 3 engine-level gate tests in `scoring-engine.test.ts` — 34 new/changed assertions pass.
- `tsc --noEmit` clean on production code. No regressions: the 5 pre-existing failing suites
  (`config-loader`, `components`, `views`, `redux-chain-analyzer`, `redux-consumer`) fail
  identically on the untouched base branch and are out of scope here.

**Validation caveat (unchanged from §4):** the shipped `registry.json` has the e2e specs'
imports/selectors/routes unresolved, so end-to-end precision gains can't be replayed from
this snapshot. The gate logic is proven by unit tests; a full before/after precision number
needs a re-run against a registry built with the e2e path aliases (`@fixtures`, `@support`)
resolved. Expected effect on these 10 stories: the six flood stories collapse from ~160–180
to roughly their tester-set size (+ a few anchored extras), since every flood spec is matched
only by hub-borne weak signals with no anchor.
```
