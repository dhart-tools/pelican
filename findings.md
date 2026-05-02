# Pelican debug 2 — gap analysis & improvement plan

Comparison of four pelican runs against the human tester's ground truth for a single code change to `src/dm/components/ManageDevices/Components/DevicesList/index.tsx` (commented-out line in `getColumns`).

## Inputs

- **Source file under test:** `index.tsx` in this directory (a `ZoneDevicesList` React component that renders a Cypress-instrumented BDGrid of devices).
- **Ground truth:** `tester-given/` — 13 `.cy.ts` files the human tester selected as relevant.
- **Pelican runs:** four variants captured in this folder (see results table).
- **Debug capture:** `debug-output.txt` (run that produced the rerank-with-aliases variant).

## Tester-given (ground truth, 13 files)

```
deleteDevices.cy.ts
deploySWPackageFromDeviceList.cy.ts
deviceConnect.cy.ts
deviceConnection.cy.ts
deviceConnectionPopover.cy.ts
displayDeviceList.cy.ts
importDevices.cy.ts
importDevices1.cy.ts
modulePopover.cy.ts
openDeviceList.cy.ts
pcuDeviceListScreen.cy.ts
startProvisioningFromPCUDashboard.cy.ts
stopProvisioningFromPCUDashboard.cy.ts
```

## Recall comparison

| Variant | Files returned | True positives | Recall | Precision |
| --- | --- | --- | --- | --- |
| `pelican-result` (baseline) | 5 | 3 | 23% | 60% |
| `pelican-result-alias` | 6 | 2 | 15% | 33% |
| `pelican-alias-rerank-no-test-format` | 8 | 2 | 15% | 25% |
| **`pelican-result-no-rerank`** | **11** | **4** | **31%** | **36%** |

**Conclusion: turning the reranker off was the single biggest recall win.** None of the four runs cracked 1/3 recall against the tester's set.

### True positives by variant

- `pelican-result`: `displayDeviceList`, `openDeviceList`, `pcuDeviceListScreen`
- `pelican-result-alias`: `displayDeviceList`, `openDeviceList`
- `pelican-alias-rerank-no-test-format`: `displayDeviceList`, `openDeviceList`
- `pelican-result-no-rerank`: `deploySWPackageFromDeviceList`, `displayDeviceList`, `openDeviceList`, `pcuDeviceListScreen`

### Tester picks pelican never surfaced (in any variant)

9 of 13:

```
deleteDevices.cy.ts
deviceConnect.cy.ts
deviceConnection.cy.ts
deviceConnectionPopover.cy.ts
importDevices.cy.ts
importDevices1.cy.ts
modulePopover.cy.ts
startProvisioningFromPCUDashboard.cy.ts
stopProvisioningFromPCUDashboard.cy.ts
```

## Root causes (from `debug-output.txt`)

### 1. Path aliases were not configured for the project under test

```
[debug] pathAliases: {"@fixtures/":"cypress/fixtures/"}
```

Only the fixtures alias was registered, but `index.tsx` imports `@dm/...`, `@src/...`, `@bd-infusion/...`. The import-graph analyzer could not follow any of those, so:

- `direct-import` scored ✗ on every candidate.
- `transitive-import` scored ✗ on every candidate.

Every surviving candidate ended up at exactly `score=0.570` on filename-match alone. That is filename-only ranking — not semantic ranking, not structural ranking.

### 2. Tester selected functionally; pelican only sees structural

The 9 missed files navigate via `cy.visit` to a route that mounts `ZoneDevicesList` and exercise it through column-generated selectors:

```
[data-test-id*='Serial Number_${...}']
[data-test-id="Type_${deviceGroupName}"]
[data-test-id="ConfigZoneName_${...}"]
[data-test-id="Provisioned-${...}"]
```

None of those tokens appear in `index.tsx`. They are emitted by the column factories imported from `@dm/components/.../DevicesList/Columns` (`getSerialNumberColumn`, `getProvisionedColumn`, etc.). Without resolving those imports (see #1), pelican has no way to know those selectors are reachable from this source.

The selectors actually present in `index.tsx`:

```
DevicesZoneDescription_${zoneId}
SelectedItemsCount
manage-devices-warning-modal-test-id
manage-devices-list-test-id
zone-without-device-
```

Almost none of these appear in any tester-given file (only `deleteDevices.cy.ts` mentions one: `manage-devices-list-test-id`).

### 3. Reranker lock cache rejected borderline candidates

```
[rerank] src\dm\components\ManageDevices\Components\DevicesList\index.tsx: 8 from lock cache, 3 rejected from lock, 0 to score
[rerank] kept 8/11 for src\dm\components\ManageDevices\Components\DevicesList\index.tsx
```

With every candidate sitting at the same `0.570` filename-only floor, the lock cache's keep/reject decisions are essentially noise — there is no real pelican-side signal for the model to combine with. That is why disabling rerank improved recall.

### 4. `describe-block` scorer demoted legitimate matches

```
✗ describe-block (0.7) — Cross-feature describe collision on [list] — demoted
```

The token `list` is too common; the demote is technically correct but penalizes legitimate device-list tests across the board.

## Improvement levers (in order of impact)

### 1. Fix path aliases (config, not code)

This is almost certainly the biggest win for recall on this sample. In the target project's `.suggestorrc.json`:

```json
"cypressExtractor": {
  "pathAliases": {
    "@dm/": "src/dm/",
    "@src/": "src/",
    "@fixtures/": "cypress/fixtures/"
  }
}
```

Add any other aliases declared in the project's `tsconfig.json` `paths`. Once import-graph can follow `@dm/...`, `direct-import` and `transitive-import` start scoring on the right candidates.

### 2. Selector chasing through the import graph

When a source file imports a column/component factory, the selectors that factory emits should attribute back to the importing source. `getSerialNumberColumn` lives in `Columns/SerialNumberColumn.tsx` and emits `Serial Number_*` — `index.tsx` imports it, so those selectors should count toward `index.tsx`'s reachable selector set.

- Hook point: `src/core/scoring/scorers/dependent-selector-scorer.ts`. It currently only follows direct children based on debug reasons (`No selectors found in dependent files`). Extend to N-hop traversal of the import graph.
- This is what would have caught `deleteDevices`, `importDevices`, `deviceConnect`, etc., once #1 is in place.

### 3. Route- / container-aware scoring

All 9 missed tests `cy.visit` a URL that resolves (via `RouterPath.MANAGE_DEVICES`) to a tree mounting `ZoneDevicesList`. `RouteMatchScorer` already exists in pelican, but the project under test has:

```json
"routeAnalyzer": { "enabled": false, "routerFile": "" }
```

Enabling it and pointing `routerFile` at the project's routes file would close most of the remaining recall gap by linking `cy.visit('/devices/...')` calls to the components mounted under that route.

### 4. Soften the `describe-block` cross-feature demote

Right now, any `[list]` collision triggers the demote. Better behavior: only demote when the describe text shares *no* other tokens with the source. `list` + `device` overlapping with the source path should not be demoted; just `list` alone should.

- Hook point: `src/core/scoring/scorers/describe-block-scorer.ts`.

### 5. Make `--rerank` more surgical when re-enabled later

Two changes to consider separately, after recall is fixed structurally:

- Raise the lock-cache rejection threshold so it cannot drop a candidate below the pre-rerank floor without strong positive evidence.
- When pelican's pre-rerank scores are flat (all candidates at the same score, e.g. the `0.570` case here), fall back to "keep" rather than "reject" — the reranker has no useful signal to combine.

## CLI change shipped alongside this analysis

Reranker is now opt-in:

- **Old:** `--no-rerank` skipped Ollama; default was rerank ON.
- **New:** `--rerank` enables Ollama; default is rerank OFF (pelican structural scoring + `.pelican.lock` cache only).

Files changed:

- `src/cli/commands/analyze.tsx` — gating sites flipped (interactive + headless paths) and CLI option declaration replaced.
- `src/cli/types.ts` — comment updated.

This matches the recommendation from the recall table: rerank-off was the best variant, so it should be the default.

## Recommended next step

**Before any pelican code changes**, re-run on the same target project with the alias config from lever #1 added. That alone should account for most of the recall gap and gives a real baseline to evaluate code-side changes against. If recall is still <50% after that, levers #2 and #3 are the real code work and would benefit from another debug capture first.
