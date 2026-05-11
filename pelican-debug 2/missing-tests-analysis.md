# Why 4 Tests Are "Not Even Considered" in the No-Rerank Run

Analysis of why `deviceConnection.cy.ts`, `deviceConnectionPopover.cy.ts`, `modulePopover.cy.ts`, and `startProvisioningFromPCUDashboard.cy.ts` never appear in `pelican-result-no-rerank/` for the `index.tsx` change in this debug bundle.

Headline: **These four tests are not filtered by rerank, `minConfidence`, or the lock cache. They are eliminated at Stage 0 — structural scoring — because every signal score returns 0.** Rerank is a red herring for them.

---

## 1. The tests ARE in the registry

Searched `.pelican/registry.json`:

| File | Registry line |
| --- | --- |
| `modulePopover.cy.ts` | 71449 |
| `deviceConnectionPopover.cy.ts` | 72124 |
| `deviceConnection.cy.ts` | 72190 |
| `deploySWPackageFromDeviceList.cy.ts` | 72294 |
| `startProvisioningFromPCUDashboard.cy.ts` | 74421 |

All present, all typed as `"type": "test"`. They were not lost to `testPatterns`, `excludePatterns`, or the alias mismatch. The first hypothesis in `rerank-analysis.md` ("not in the registry at all") is **wrong for these files** — and that's exactly what the no-rerank run was supposed to prove.

So `debug-output.txt:4` (`scoring 1 changed file(s) against 215 test file(s)`) includes all four of them. They get scored. They score 0.

---

## 2. Why they score 0 — every scorer rejects them

`index.tsx` is at `src/dm/.../DevicesList/index.tsx`. The filename scorer treats `index.*` as a pointer and uses the parent dir name, so the source basename becomes `DevicesList` → tokens `[devices, list]`. The selectors extracted from the file are just two (per `debug-output.txt:9`):
- `id="DevicesZoneDescription_"`
- `data-test-id="SelectedItemsCount"`

What each structural scorer needs vs. what the 4 tests give:

| Scorer | What it needs | What the 4 tests give |
| --- | --- | --- |
| `direct-import` (0.95) | Test imports the source file | `imports: []` for `deviceConnection`, `deviceConnectionPopover`, `startProvisioning`; `["cypress/support/helpers/timeout.cy.js"]` for `modulePopover`. **Zero source imports** — classic Cypress E2E pattern, they `cy.visit()` URLs instead. |
| `transitive-import` (0.7) | Imports another file that imports source | Same — empty graph |
| `selector-match` (0.8) | Test queries `SelectedItemsCount` or `DevicesZoneDescription_` | They query `Type_`, `Serial Number_`, `body`, etc. **No overlap.** |
| `selector-id-match` (0.65) | Same idea, IDs | None match |
| `translation-match` (0.85) | Shared i18n keys | None |
| `colocation` (0.75) | Same folder | Tests live in `cypress/e2e/...`, source in `src/dm/...` |
| `redux-chain` / `redux-consumer` | Redux relationship | Disabled in `.suggestorrc.json` (`reduxChain.enabled: false`) |
| `api-intercept` (0.55) | Test intercepts an API the source calls | None |
| `describe-block` (0.7) | describe()/it() text references source tokens | Describes mention "device list", but the cross-feature **single-token-collision demote** kicks in (see `filename-convention-scorer.ts:204` and same logic in describe-block). One token = demoted. |
| `dependent-selector` (0.65) | Selectors in files that import source | Even if the dependent-graph resolved, none of these tests query those dependent selectors |
| **`filename-match` (0.6)** | Tokens overlap ≥ 0.5 of `min(len(src), len(test))` | **Almost works — see below** |

### 2a. Why `filename-match` also rejects exactly these four

`filename-convention-scorer.ts:100` sets `MATCH_THRESHOLD = 0.5`. The overlap is computed as `effectiveIntersection / min(|sourceTokens|, |testTokens|)`, with a 0.9× weight for fuzzy substring containment (`devices` ↔ `device`).

Source tokens: `[devices, list]`, denominator = 2.

| Test | Test tokens | Exact ∩ | Fuzzy | Score | Pass? |
| --- | --- | --- | --- | --- | --- |
| `deploySWPackageFromDeviceList` | `[deploy, sw, package, from, device, list]` | `[list]` (1.0) | `device↔devices` (0.9) | **1.9 / 2 = 0.95** | ✅ |
| `displayDeviceListPage1` | `[display, device, list, page1]` | `[list]` (1.0) | `device↔devices` (0.9) | **0.95** | ✅ |
| `deviceConnection` | `[device, connection]` | `[]` | `device↔devices` (0.9) | **0.9 / 2 = 0.45** | ❌ |
| `deviceConnectionPopover` | `[device, connection, popover]` | `[]` | `device↔devices` (0.9) | **0.45** | ❌ |
| `modulePopover` | `[module, popover]` | `[]` | none | **0.0** | ❌ |
| `startProvisioningFromPCUDashboard` | `[start, provisioning, from, pcu, dashboard]` | `[]` | none | **0.0** | ❌ |

The `deviceConnection*` pair fails the gate by **0.05** — they share `device` (fuzzy → 0.9 hit) but lack `list` because they're popovers, not list views. Two of the four (`modulePopover`, `startProvisioning…`) don't even fuzzy-match — the source word `list` doesn't appear and `devices` doesn't substring-match any of their tokens.

This also explains why `deploySWPackageFromDeviceList.cy.ts` shows up in `pelican-result-no-rerank/` — it shares `list` AND `device`, clearing the gate at 0.95. The structural scorers can see it; rerank later drops it (which is why it disappears in the alias/rerank runs).

---

## 3. Why `--no-rerank` doesn't help

`--no-rerank` affects Stage 3 (the bi-encoder + LLM filter). The four tests never reach Stage 3:

- **Stage 0** (`ScoringEngine.evaluateTests`) — every signal at 0 → score 0
- **Stage 1** (`analyze.tsx:368`, `r.score >= minConfidence`) — 0 < 0.4 → dropped here
- **Stage 3** (rerank) — never invoked for these candidates

So flipping `--no-rerank` on/off or changing `minConfidence` from 0.4 to 0.0 wouldn't change anything for these four files. The engine doesn't even emit them — the noisy-OR over zero matched signals is zero, and `analyze.tsx:368` filters them out before any debug logging happens (that's why `grep "deviceConnection\|modulePopover"` against `debug-output.txt` returns nothing).

The `.suggestorrc.json` mismatch fix in `c853b7a` is also irrelevant here — these four tests have **empty `imports: []` arrays in the registry**, so no path-alias resolution would have helped. Cypress E2E tests don't import React components.

---

## 4. The actual rule being missed

There is **one** scorer that would catch all four: `route-match` (weight 0.85). The registry shows all four tests visit `/managedevices`:

```
modulePopover.cy.ts            → visitedRoutes: ["/managedevices", ...]
deviceConnectionPopover.cy.ts  → visitedRoutes: ["/managedevices", ...]
deviceConnection.cy.ts         → visitedRoutes: ["/managedevices", ...]
startProvisioningFromPCUDashboard → /managedevices/... (via container)
```

And `index.tsx` is the page rendered at `/managedevices/:zoneId`.

But — the smoking gun — the run had:

```
debug-output.txt:1
enabledScorers=direct-import,selector-match,selector-id-match,filename-match,
              transitive-import,api-intercept,colocation,describe-block,translation-match,
              dependent-selector,redux-chain,redux-consumer
```

**No `route-match`.** And `.suggestorrc.json:42` has `routeAnalyzer.enabled: false`. The one signal that could rescue Cypress E2E tests with no imports and a different filename — route equality — is turned off in both the analyzer and the scorer list.

That is the rule being missed.

---

## 5. Tester's-eye check — should they even be there?

What was actually commented in `index.tsx`:

- L163–164: `getIsPinnedColumn()` — already commented previously
- L237–239: `// !isDevicesListLoading && searchQuery` — the ternary's left side is now a comment, which is a **syntax error** (the file will not compile as-is)

Both edits touch the **search + empty-state** behavior of the list. From a senior-tester lens, the highly relevant tests are exactly the ones that *did* show up: `searchDeviceList`, `displayDeviceList(Page)`, `openDeviceList`, `sortDeviceList`. The four "missing" tests cover device-connection popover, module popover, and provisioning kickoff — orthogonal to the change. So Pelican's silence on them is partially defensible — but it's **defensible by accident**, not by design. With route-match enabled they'd all show up, and rerank would then have to make the relevance call.

---

## 6. Run-by-run summary

| Folder | # files | Why |
| --- | --- | --- |
| `pelican-result/` (rerank, no aliases) | 5 | Weak structural scores (aliases broken) → rerank LLM keeps only the strongest |
| `pelican-result-alias/` (rerank + aliases) | 6 | One extra (`deviceListSyncedSoftwareStatusPopover`) survives now that aliases resolve some imports |
| `pelican-alias-rerank-no-test-format/` | 8 | Stricter prompt format relaxed → more LLM keeps |
| `pelican-result-no-rerank/` | 11 | Stage 1 only; everything scoring ≥ minConfidence passes — but the **4 missing tests still score 0 here**, so they're absent from every iteration |

---

## 7. Recommendations, in order

1. **Turn on `route-match`.** In the target project's `.suggestorrc.json`: set `analyzers.routeAnalyzer.enabled: true` and add `"route-match"` to `scoring.enabledScorers`. That single change moves all four files from "not even considered" to "scored ~0.85, into rerank".
2. **Delete `.pelican/pelican.lock` after that change.** Once route-match starts producing signals, old confirmed/rejected pairs in the lock will mask the new structural strength (Stage 3a in `rerank-analysis.md`) — exactly the stickiness described there.
3. **Sanity-pin the source change.** Current `index.tsx` has a broken ternary on L237–239. Either restore the predicate or commit a syntactically valid version before benchmarking — a file that doesn't compile is a bad fixture for measuring scorer behavior.
4. **Stop measuring `minConfidence` for these files.** `rerank-analysis.md` already explains why broadly; for these four specifically, `minConfidence` was never the gate — Stage 0 (signals → 0) was. The only knobs that move them are: enable `route-match`, enable Redux scorers (source clearly uses Redux containers), or lower the filename `MATCH_THRESHOLD` from 0.5 to 0.4 (which would let `deviceConnection*` through at 0.45 — but globally noisy).

---

## 8. Where things live (cross-reference)

| Concern | File | Line |
| --- | --- | --- |
| Filename match threshold | `src/core/scoring/scorers/filename-convention-scorer.ts` | 100 (`MATCH_THRESHOLD = 0.5`) |
| Filename fuzzy containment | `src/core/scoring/scorers/filename-convention-scorer.ts` | 163–174 |
| `index.*` → parent dir | `src/core/scoring/scorers/filename-convention-scorer.ts` | 256–261 |
| Stage 1 minConfidence cut | `src/cli/commands/analyze.tsx` | 368 |
| Stage 4 minConfidence cut | `src/cli/commands/analyze.tsx` | 156 |
| Scorer registry / weights | `src/core/scoring/scoring-config.ts` | 4–113 |
| route-match scorer | `src/core/scoring/scorers/route-match-scorer.ts` | — |
| Target config | `.suggestorrc.json` | `routeAnalyzer.enabled` / `scoring.enabledScorers` |
