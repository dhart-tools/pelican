import { BaseScorer } from '@/core/scoring/scorers/base';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import { IScorerContext, ISignal } from '@/types';
import { EScorerType } from '@/utils/enums';
import { normalizeTestSelector } from '@/utils/selector-normalize';

export class SelectorMatchScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.SELECTOR_MATCH));
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, changedFile: changedEntry, registry } = context;

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
      // Worst-case (deepest) origin of the matched values — 0 = own file,
      // 1 = direct import, 2 = grand-child. Transitive matches dampen.
      const allMatched: string[] = [
        ...exactMatches,
        ...prefixMatches.map((p) => p.source),
      ];
      const minDepth = Math.min(...allMatched.map((v) => valueOrigin.get(v) ?? 0));
      const sig = this.createSignal(
        true,
        exactMatches.length > 0
          ? `Test selectors match: ${exactMatches.join(', ')}${prefixMatches.length ? ` (+${prefixMatches.length} prefix)` : ''}${minDepth > 0 ? ` (via dep d${minDepth})` : ''}`
          : `Test selectors prefix-match: ${prefixMatches.map((p) => `${p.test}~${p.source}`).join(', ')}${minDepth > 0 ? ` (via dep d${minDepth})` : ''}`,
        { changedFile, testFile, exactMatches, prefixMatches, minDepth },
      );
      let w = this.weight;
      if (exactMatches.length === 0) w *= 0.7;
      if (minDepth === 1) w *= 0.7;
      else if (minDepth >= 2) w *= 0.45;

      // Match density: a single matched selector out of a spec's 20-selector
      // vocabulary is a weak connection. Scale weight by how much of the test
      // we actually cover. Cap at 3 matches = full weight so genuinely
      // selector-heavy components don't over-score.
      const matchCount = exactMatches.length + prefixMatches.length;
      const densityFactor = Math.min(1, matchCount / 3);
      w *= Math.max(0.35, densityFactor);

      // IDF-style quality scaling. Each matched value's contribution is
      // weighted by how discriminating it is: values that appear in most
      // specs (`SaveButton`, `CancelButton`, `BackButton`) are near-useless
      // for identifying WHICH spec a change affects, while rare values
      // (`facility-name-input`) are near-perfect discriminators.
      //
      // quality(v) = (1 - freq(v)/totalTests)^2
      //   freq 0/215    → 1.00   (perfect discriminator — unique to one spec)
      //   freq 10/215   → 0.91
      //   freq 47/215   → 0.61   (SaveButton in 22% of specs → 0.61)
      //   freq 100/215  → 0.28
      //   freq 200/215  → 0.005  (universal — near-zero signal)
      //
      // Signal quality = MAX of per-value qualities. A single rare match
      // rescues the signal even if other matched values are ubiquitous
      // (the discriminator carries the decision).
      if (registry) {
        const totalTests = registry.getTestFileCount();
        if (totalTests > 1) {
          const uniqueMatched = Array.from(new Set(allMatched));
          let bestQuality = 0;
          for (const v of uniqueMatched) {
            const freq = registry.getTestSelectorFrequency(v);
            const share = freq / totalTests;
            const q = Math.pow(1 - share, 2);
            if (q > bestQuality) bestQuality = q;
          }
          // Floor at 0.25 so a match on purely ubiquitous selectors still
          // lands as a weak MED rather than vanishing into LOW.
          w *= Math.max(0.25, bestQuality);
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
