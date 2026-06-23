import { BaseScorer } from '@/core/scoring/scorers/base';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import {
  DEFAULT_UBIQUITOUS_SELECTOR_THRESHOLD,
  formatSelectorShares,
  partitionBySelectorUbiquity,
} from '@/core/scoring/selector-ubiquity';
import { IScorerContext, ISignal } from '@/types';
import { EScorerType } from '@/utils/enums';
import { normalizeTestSelector } from '@/utils/selector-normalize';

export class SelectorMatchScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.SELECTOR_MATCH));
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, changedFile: changedEntry, registry, config } = context;

    const testSelectors = testEntry.cypress?.selectors || [];
    if (testSelectors.length === 0) {
      return [this.createSignal(false, 'No selectors in test')];
    }

    // Own selectors first. If the changed file is a thin container that renders
    // child components (e.g. `TransactionCreateContainer` → `*StepTwo`), its
    // own `selectors` array is empty — walk direct imports up to depth 2 and
    // union their selector values so container changes still match specs that
    // interact with the children. Track depth so we can dampen weight later.
    const sourceSelectors = changedEntry.selectors || [];
    const ownValues = sourceSelectors.map((s) => s.value).filter(Boolean);
    const valueOrigin = new Map<string, number>();
    for (const v of ownValues) valueOrigin.set(v, 0);

    // Only walk transitive deps when the file is a thin wrapper/container
    // (<3 own selectors). Otherwise a real component like NavBar pulls in
    // its whole render tree and matches specs that only touch its children.
    if (registry && ownValues.length < 3) {
      const visited = new Set<string>([changedFile]);
      const walk = (file: string, depth: number): void => {
        if (depth > 2) return;
        const deps = registry.getDependencies(file);
        for (const dep of deps) {
          if (visited.has(dep)) continue;
          visited.add(dep);
          const depEntry = registry.getFile(dep);
          if (!depEntry) continue;
          const ds = depEntry.selectors || [];
          for (const s of ds) {
            if (!s.value) continue;
            if (!valueOrigin.has(s.value)) valueOrigin.set(s.value, depth);
          }
          walk(dep, depth + 1);
        }
      };
      walk(changedFile, 1);
    }

    if (valueOrigin.size === 0) {
      return [this.createSignal(false, 'No selectors in source file')];
    }

    const sourceValues = Array.from(valueOrigin.keys());
    const sourceValueSet = new Set(sourceValues);

    const exactMatches: string[] = [];
    const prefixMatches: Array<{ test: string; source: string }> = [];

    for (const rawSelector of testSelectors) {
      const testSelector = normalizeTestSelector(rawSelector);
      if (!testSelector) continue;

      const tv = testSelector.value;
      if (!tv) continue;

      if (sourceValueSet.has(tv)) {
        exactMatches.push(tv);
        continue;
      }

      // Partial match: `getBySelLike("transaction-item")` vs template-literal
      // `data-test={`transaction-item-${id}`}` (source stored as static head
      // `transaction-item-`). Require min prefix length 3 and that one value
      // starts with the other — avoids "a"/"ab" matching everything.
      if (tv.length < 3) continue;
      for (const sv of sourceValues) {
        if (sv.length < 3) continue;
        if (sv === tv) continue;
        if (sv.startsWith(tv) || tv.startsWith(sv)) {
          prefixMatches.push({ test: tv, source: sv });
          break;
        }
      }
    }

    if (exactMatches.length > 0 || prefixMatches.length > 0) {
      const allMatched: string[] = [...exactMatches, ...prefixMatches.map((p) => p.source)];

      // Fix #2: disqualify ubiquitous selectors. Shared grid/nav/toast markers
      // (`Type_`, `Serial Number_`, `SaveButton`) appear across most specs, so a
      // match on them alone says nothing about WHICH spec a change affects — and
      // they're the dominant precision-flood carrier. The signal counts only if
      // at least one matched selector is discriminating (non-ubiquitous).
      const threshold =
        config?.scoring?.ubiquitousSelectorThreshold ?? DEFAULT_UBIQUITOUS_SELECTOR_THRESHOLD;
      const { discriminating, ubiquitous } = registry
        ? partitionBySelectorUbiquity(allMatched, registry, threshold)
        : { discriminating: [...new Set(allMatched)], ubiquitous: [] as string[] };

      if (registry && discriminating.length === 0) {
        return [
          this.createSignal(
            false,
            `All ${ubiquitous.length} matched selector(s) ubiquitous (>${(threshold * 100).toFixed(0)}% of specs) — disqualified: ${formatSelectorShares(ubiquitous, registry)}`,
            { changedFile, testFile, disqualified: ubiquitous },
          ),
        ];
      }

      // Everything below is computed over DISCRIMINATING matches only.
      const discSet = new Set(discriminating);
      const keptExact = exactMatches.filter((v) => discSet.has(v));
      const keptPrefix = prefixMatches.filter((p) => discSet.has(p.source));
      // Worst-case (deepest) origin — 0 = own file, 1 = direct import, 2 = grand-child.
      const minDepth = Math.min(...discriminating.map((v) => valueOrigin.get(v) ?? 0));
      const ignored = ubiquitous.length ? ` [${ubiquitous.length} ubiquitous ignored]` : '';
      const sig = this.createSignal(
        true,
        keptExact.length > 0
          ? `Test selectors match: ${keptExact.join(', ')}${keptPrefix.length ? ` (+${keptPrefix.length} prefix)` : ''}${minDepth > 0 ? ` (via dep d${minDepth})` : ''}${ignored}`
          : `Test selectors prefix-match: ${keptPrefix.map((p) => `${p.test}~${p.source}`).join(', ')}${minDepth > 0 ? ` (via dep d${minDepth})` : ''}${ignored}`,
        {
          changedFile,
          testFile,
          exactMatches: keptExact,
          prefixMatches: keptPrefix,
          minDepth,
          ubiquitous,
        },
      );
      let w = this.weight;
      if (keptExact.length === 0) w *= 0.7;
      if (minDepth === 1) w *= 0.7;
      else if (minDepth >= 2) w *= 0.45;

      // Match density: a single matched selector out of a spec's 20-selector
      // vocabulary is a weak connection. Scale weight by how much of the test
      // we actually cover. Cap at 3 matches = full weight so genuinely
      // selector-heavy components don't over-score.
      const matchCount = keptExact.length + keptPrefix.length;
      const densityFactor = Math.min(1, matchCount / 3);
      w *= Math.max(0.35, densityFactor);

      // IDF-style quality scaling over the DISCRIMINATING values. Ubiquitous
      // values are already removed, so no floor is needed — a low best-quality
      // here means a genuinely weak (rare-but-shallow) match.
      //   quality(v) = (1 - freq(v)/totalTests)^2
      //   freq 0     → 1.00 (unique to one spec)   freq 10/215 → 0.91
      //   freq 47/215 → 0.61                        freq 100/215 → 0.28
      if (registry) {
        const totalTests = registry.getTestFileCount();
        if (totalTests > 1) {
          let bestQuality = 0;
          for (const v of discriminating) {
            const share = registry.getTestSelectorFrequency(v) / totalTests;
            const q = Math.pow(1 - share, 2);
            if (q > bestQuality) bestQuality = q;
          }
          w *= bestQuality;
        }
      }
      sig.weight = w;
      return [sig];
    }

    return [
      this.createSignal(false, 'No matching selectors', {
        changedFile,
        testFile,
        testSelectors,
        sourceSelectors: sourceValues,
      }),
    ];
  }
}
