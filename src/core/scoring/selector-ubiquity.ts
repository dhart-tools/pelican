import { IRegistry } from '@/types';

/**
 * Default share above which a test selector is treated as ubiquitous UI
 * infrastructure — shared data-grids, nav bars, toasts, modals whose test-ids
 * (`Type_`, `Serial Number_`, `SaveButton`) appear across most specs and so
 * cannot identify WHICH spec a change affects.
 *
 * These must not anchor a selector match: a selector signal counts only when it
 * rests on at least one non-ubiquitous (discriminating) selector. Tunable via
 * scoring config `ubiquitousSelectorThreshold`; calibrate against the
 * "top test selectors" frequency dump emitted under `--debug`.
 */
export const DEFAULT_UBIQUITOUS_SELECTOR_THRESHOLD = 0.1;

/** Fraction of test files (0..1) that query `value`. 0 when no tests indexed. */
export function selectorShare(value: string, registry: IRegistry): number {
  const total = registry.getTestFileCount();
  if (total <= 0) return 0;
  return registry.getTestSelectorFrequency(value) / total;
}

/** True when `value` is queried by more than `threshold` of all test files. */
export function isUbiquitousSelector(
  value: string,
  registry: IRegistry,
  threshold: number = DEFAULT_UBIQUITOUS_SELECTOR_THRESHOLD,
): boolean {
  return selectorShare(value, registry) > threshold;
}

/**
 * Splits matched selector values into discriminating (kept) and ubiquitous
 * (disqualified). The caller keeps the signal only when `discriminating` is
 * non-empty, and reports `ubiquitous` (with shares) in the debug reason.
 */
export function partitionBySelectorUbiquity(
  values: readonly string[],
  registry: IRegistry,
  threshold: number = DEFAULT_UBIQUITOUS_SELECTOR_THRESHOLD,
): { discriminating: string[]; ubiquitous: string[] } {
  const discriminating: string[] = [];
  const ubiquitous: string[] = [];
  for (const v of new Set(values)) {
    if (isUbiquitousSelector(v, registry, threshold)) ubiquitous.push(v);
    else discriminating.push(v);
  }
  return { discriminating, ubiquitous };
}

/** `value=NN%` list for debug reasons, sorted most-frequent first. */
export function formatSelectorShares(values: readonly string[], registry: IRegistry): string {
  return [...new Set(values)]
    .map((v) => ({ v, s: selectorShare(v, registry) }))
    .sort((a, b) => b.s - a.s)
    .map(({ v, s }) => `${v}=${(s * 100).toFixed(0)}%`)
    .join(', ');
}
