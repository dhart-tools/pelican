# Rerank Pipeline Analysis

How rerank actually works in pelican, why different `minConfidence` values can produce identical results, and why specific test files may be missing from output.

---

## The wrong mental model

> "Rerank is the final filter that drops anything below `minConfidence`."

This is not what happens. Rerank **replaces** the structural pelican score with a blended one, and a different filter runs on that blended value. `minConfidence` is also applied **before** rerank on the pure structural score. So the dial is being applied in two places, on two different quantities, and several other stages in between can decide a candidate's fate without `minConfidence` ever being consulted.

---

## The real pipeline (top to bottom)

### Stage 0 — Structural scoring
`ScoringEngine.evaluateTests()` (`src/core/scoring/scoring-engine.ts`)

- Every test in `registry.getFilesByType('test')` is scored against the changed source.
- Score = noisy-or over matched signals (direct-import, colocation, filename, selector, route, redux, describe-block, etc.).
- Result is in `[0, 1]`, sorted descending.

### Stage 1 — Pre-rerank `minConfidence` cut
`src/cli/commands/analyze.tsx:368`

```ts
const relevant = scoreResults.filter((r) => r.score >= config.scoring.minConfidence);
```

This is the **first** application of `minConfidence`, and it runs on the **pure structural pelican score**. At `minConfidence = 0.7`, anything that scored 0.65 structurally never enters rerank.

### Stage 2 — Auto-keep
`src/cli/commands/analyze.tsx:95,115`

```ts
const AUTO_KEEP_PELICAN = 0.9;
if (r.score >= AUTO_KEEP_PELICAN) autoKept.push(r);
```

Pelican ≥ 0.9 candidates **skip the LLM entirely** and keep their structural score. Direct-import + filename-match pairs almost always land here.

### Stage 3 — Reranker (`SemanticReranker.rerank`)
`src/core/rerank/semantic-reranker.ts:268`

For everything in `toRerank`:

**3a. Lock cache lookup** — `.pelican/pelican.lock`
- Confirmed pair → keep with `combined = min(1, pelican + 0.2 cacheBoost)`, **no LLM call**.
- Rejected pair → drop, **no LLM call**.
- Unknown → continues.

**3b. CE prefilter** — off by default in current config; skipped.

**3c. Bi-encoder prefilter** (`src/core/rerank/bi-encoder-prefilter.ts`) — on by default.
- Embeds source + every remaining candidate with `mxbai-embed-large` (default).
- Computes `blended = 0.7 * pelicanPrior + 0.3 * cosine`.
- Keeps top 30 above floor `minScore = 0.3`. Everything else is dropped **with a cached rejection** written into the lock.

**3d. LLM scoring** (`src/core/rerank/ollama-reranker.ts`)
- Asks model: relevant? + confidence 1–5 + short reason.
- v2 prompt blend: `combined = 0.4 * pelican + 0.6 * (confidence / 5)`.
- `relevant: true` → confirmed in lock, kept.
- `relevant: false` → rejected in lock, dropped.

### Stage 4 — Post-rerank `minConfidence` cut
`src/cli/commands/analyze.tsx:156`

```ts
const filtered = minConfidence != null ? mutated.filter((r) => r.score >= minConfidence) : mutated;
```

This is the **second** application of `minConfidence`, now on the post-rerank **combined** score (not on the pelican structural score).

---

## Why different `minConfidence` values give the same results

Three factors:

### 1. The combined score has a narrow effective range

For any candidate the LLM keeps:

| LLM confidence | combined range |
| -------------- | -------------- |
| 5/5            | [0.60, 1.00]   |
| 4/5            | [0.48, 0.88]   |
| 3/5            | [0.36, 0.76]   |

The reranker only keeps `relevant: true` verdicts, which the LLM only emits with confidence ≥ 3 in practice. **Almost every survivor lands ≥ 0.6 combined.** Cranking `minConfidence` between 0.4 and 0.6 slides the cut through empty space — there's no data to remove.

### 2. The `.pelican.lock` cache is sticky

Once a pair is `confirmed` in the lock, it surfaces with `pelican + 0.2`, **bypassing the LLM and bypassing v2 blend weights**. Once `rejected`, it's dropped forever (until `--no-cache` or the lock is edited). After the first run at any threshold, the lock decides most pairs for every subsequent run, regardless of the `minConfidence` value you pass.

### 3. Auto-keep at 0.9 hard-pins the top

Direct-import matches (≈0.95) are not touched by rerank at all. They appear identically for every `minConfidence ≤ 0.9`.

**Net effect:** the dial you're turning is hitting (a) the Stage 1 cut on pelican-pure where strong structural matches are already well above 0.7, and (b) the Stage 4 cut on combined score where most survivors are 0.6–1.0. The visible result is flat because the actual filtering is being done by **lock cache + bi-encoder topK + LLM verdict**, not by `minConfidence`.

---

## Why specific test files are missing from results

Files: `deviceConnectionPopover`, `modulePopover`, `deviceConnection.cy.ts`, `deviceConnectionPopover.cy.ts`, `startProvisioningFromPCUDashboard.cy.ts`, `deploySWPackageFromDeviceList.cy.ts`.

Possible causes, in order of likelihood:

1. **Not in the registry at all.** `testPatterns` didn't match, or `excludePatterns` caught them. This is the "not even considered" case. Component-named entries (`deviceConnectionPopover`, `modulePopover`) need to be picked up by `sourceDirs`; `.cy.ts` files by `testPatterns`.

2. **Path-alias resolution failure.** The import-graph analyzer can't resolve `@/components/...` without aliases. No resolution → no direct-import signal → structural score collapses → fails the Stage 1 `minConfidence` cut → never reaches rerank. The mismatch fix in `c853b7a` (hoisting top-level `pathAliases` into `analyzers.cypressExtractor.pathAliases`) directly affects which candidates clear Stage 1.

3. **Cached rejection in `.pelican.lock`** (Stage 3a). If an earlier run (with weaker config — broken aliases, smaller registry) saw these pairs and the LLM said no, they're now sticky-rejected. They will not reappear until `--no-cache` or the lock entry is removed.

4. **Bi-encoder dropped them** (Stage 3c). If `0.7 * pelican + 0.3 * cosine < 0.3` — likely when pelican is weak (alias failure again) and test naming is unusual — they get dropped before the LLM ever sees them, with the rejection also written to the lock.

### Diagnostic split

- `.cy.ts` file in registry but missing from results → path-alias resolution or lock-cache.
- `.cy.ts` file not in registry → `testPatterns` glob issue.

---

## Did the mismatch fix affect rerank behavior?

**Indirectly, yes — and exactly in the way that makes `minConfidence` look broken.**

The fix at `c853b7a` made `setup` and `analyze` build the **same registry**. Before the fix, `setup` could write a `.pelican.lock` based on a poorer registry (fewer imports resolved → weaker structural signals → LLM sees pairs with worse priors → more rejections). Those rejections are now sticky in the lock.

After the fix, `analyze` runs against a richer registry, but the lock still carries the old rejections. So:

- Same final lists across different `minConfidence` values (lock dominates).
- Files that "should" appear now (because their structural signals are stronger post-fix) still don't, because they were rejected in the lock before the fix.

---

## How to verify this empirically

1. **Delete `.pelican/pelican.lock`** (or run with `--no-cache`) and re-run with `--debug --rerank`. Watch stderr:
   - `[rerank] <file>: N from lock cache, M rejected from lock, K to score` — lock contribution.
   - `[bi-encoder] kept X/Y (topK=…, floor=…, top=…, cutoff=…)` — bi-encoder contribution.
   - `[rerank] kept X/Y for <file>` — final keep rate.

2. **Run analyze with a missing file as `--files`** at `minConfidence=0.0` and check `preRerankCount` in the result. If `preRerankCount` is 0 for a source you expect to have tests, the issue is registry / aliases, not rerank.

3. **Compare two runs with different `minConfidence` side-by-side using `--no-cache`** — the only way to see the cut actually move, because the cache otherwise makes runs identical.

---

## Where `minConfidence` is actually applied (summary)

| Stage | File | Line | Operates on |
| ----- | ---- | ---- | ----------- |
| 1 — pre-rerank cut | `src/cli/commands/analyze.tsx` | 368 | Pure pelican structural score |
| 2 — auto-keep gate | `src/cli/commands/analyze.tsx` | 95, 115 | Pelican (compared to fixed `0.9`, not `minConfidence`) |
| 3a — lock cache | `src/core/rerank/semantic-reranker.ts` | 297–319 | Cached state (no score check) |
| 3c — bi-encoder | `src/core/rerank/bi-encoder-prefilter.ts` | 138–146 | `0.7*pelican + 0.3*cosine` vs `minScore=0.3` (not `minConfidence`) |
| 3d — LLM blend | `src/core/rerank/semantic-reranker.ts` | 396–410 | Writes `combined = 0.4*pelican + 0.6*(conf/5)` |
| 4 — post-rerank cut | `src/cli/commands/analyze.tsx` | 156 | Combined post-rerank score |

The two places `minConfidence` actually filters (1 and 4) are operating on **different quantities**, and stages 2, 3a, 3c, 3d can each decide a candidate's fate without consulting `minConfidence` at all.
