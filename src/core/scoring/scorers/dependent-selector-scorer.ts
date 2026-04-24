import { BaseScorer } from '@/core/scoring/scorers/base';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import { IScorerContext, ISignal } from '@/types';
import { EScorerType } from '@/utils/enums';
import { normalizeTestSelector } from '@/utils/selector-normalize';

/**
 * Reverse-dependency selector scorer.
 *
 * When a non-UI file changes (state machine, hook, util), the selectors live
 * in the components that IMPORT it, not in the file itself. This scorer:
 *
 *   1. Finds files that import the changed file (dependents, depth 1-2).
 *   2. Collects selectors from those dependent files.
 *   3. Matches them against the test's selectors.
 *
 * Covers chains like:
 *   userOnboardingMachine.ts → UserOnboardingContainer.tsx (has selectors) → test
 */
const MAX_DEPENDENT_DEPTH = 2;

export class DependentSelectorScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.DEPENDENT_SELECTOR));
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, changedFile: changedEntry, registry } = context;

    // Skip if changed file already has its own selectors — SelectorMatchScorer handles that.
    const ownSelectors = changedEntry.selectors || [];
    if (ownSelectors.length >= 3) {
      return [this.createSignal(false, 'Source has own selectors; SelectorMatchScorer covers this')];
    }

    const testSelectors = testEntry.cypress?.selectors || [];
    if (testSelectors.length === 0) {
      return [this.createSignal(false, 'No selectors in test')];
    }

    if (!registry) {
      return [this.createSignal(false, 'No registry available')];
    }

    // Walk dependents of changed file up to MAX_DEPENDENT_DEPTH, collect selectors.
    const selectorOrigin = new Map<string, { depth: number; via: string }>();
    const visited = new Set<string>([changedFile]);

    const walkDependents = (file: string, depth: number): void => {
      if (depth > MAX_DEPENDENT_DEPTH) return;
      const dependents = registry.getDependents(file);
      for (const dep of dependents) {
        if (visited.has(dep)) continue;
        visited.add(dep);
        const depEntry = registry.getFile(dep);
        if (!depEntry) continue;
        for (const s of depEntry.selectors || []) {
          if (!s.value) continue;
          if (!selectorOrigin.has(s.value)) {
            selectorOrigin.set(s.value, { depth, via: dep });
          }
        }
        walkDependents(dep, depth + 1);
      }
    };

    walkDependents(changedFile, 1);

    if (selectorOrigin.size === 0) {
      return [this.createSignal(false, 'No selectors found in dependent files')];
    }

    const selectorValues = new Set(selectorOrigin.keys());

    // Match test selectors against dependent selectors
    const exactMatches: Array<{ value: string; via: string; depth: number }> = [];
    const prefixMatches: Array<{ test: string; source: string; via: string; depth: number }> = [];

    for (const rawSelector of testSelectors) {
      const testSelector = normalizeTestSelector(rawSelector);
      if (!testSelector?.value) continue;
      const tv = testSelector.value;

      if (selectorValues.has(tv)) {
        const origin = selectorOrigin.get(tv)!;
        exactMatches.push({ value: tv, via: origin.via, depth: origin.depth });
        continue;
      }

      // Prefix match (same logic as SelectorMatchScorer)
      if (tv.length < 3) continue;
      for (const [sv, origin] of selectorOrigin) {
        if (sv.length < 3 || sv === tv) continue;
        if (sv.startsWith(tv) || tv.startsWith(sv)) {
          prefixMatches.push({ test: tv, source: sv, via: origin.via, depth: origin.depth });
          break;
        }
      }
    }

    if (exactMatches.length === 0 && prefixMatches.length === 0) {
      return [this.createSignal(false, 'No dependent selectors match test', {
        changedFile,
        testFile,
        dependentSelectorCount: selectorOrigin.size,
      })];
    }

    const allMatches = [...exactMatches, ...prefixMatches];
    const minDepth = Math.min(...allMatches.map((m) => m.depth));
    const viaFiles = [...new Set(allMatches.map((m) => m.via))];
    const matchedValues = exactMatches.map((m) => m.value);

    const sig = this.createSignal(
      true,
      `Dependent selectors match: ${matchedValues.join(', ')}${prefixMatches.length ? ` (+${prefixMatches.length} prefix)` : ''} via ${viaFiles.join(', ')} (d${minDepth})`,
      { changedFile, testFile, exactMatches, prefixMatches, viaFiles, minDepth },
    );

    // Weight: base weight dampened by depth and match quality.
    // This is an indirect signal — keep it below SelectorMatchScorer.
    let w = this.weight;
    if (exactMatches.length === 0) w *= 0.6; // prefix-only
    if (minDepth >= 2) w *= 0.6;

    const matchCount = exactMatches.length + prefixMatches.length;
    w *= Math.min(1, matchCount / 3);

    sig.weight = w;
    return [sig];
  }
}
