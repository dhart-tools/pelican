/**
 * Single source of truth for test specs that pelican must NEVER suggest,
 * regardless of how strongly they score.
 *
 * This is deliberately separate from scoring / threshold tuning. Some suites
 * are run on their own cadence (smoke, cross-system integration) and are pure
 * noise inside a per-change regression list — no weight change can fix that,
 * because the problem is categorical, not a matter of relevance strength.
 *
 * Specs matched here are dropped during registry build, so they never enter
 * the candidate pool and can never appear in results.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  To exclude more specs in the future: add ONE entry to
 *  {@link SUGGESTION_EXCLUSION_RULES} below. That is the only place to edit.
 * ──────────────────────────────────────────────────────────────────────────
 */

/**
 * A declarative rule describing one class of never-suggest spec.
 *
 * A rule matches when ANY of its provided matchers match. Keep each rule
 * narrow and well-justified — these silently remove tests from every result.
 */
export interface ISuggestionExclusionRule {
  /** Stable identifier — surfaces in debug logs and tests. */
  readonly id: string;
  /** Why this spec class is never a relevant per-change suggestion. */
  readonly reason: string;
  /**
   * Match when any path segment (folder name) contains this string,
   * case-insensitively. Use for whole suites living under a folder,
   * e.g. `'InterOps'` matches `cypress/e2e/ims/05 InterOps/alerts.cy.ts`.
   */
  readonly pathSegment?: string;
  /**
   * Match an exact file basename, case-insensitively,
   * e.g. `'dmSanity.cy.ts'`.
   */
  readonly fileName?: string;
}

/**
 * The canonical exclusion list. Order is irrelevant (rules are OR-ed).
 */
export const SUGGESTION_EXCLUSION_RULES: readonly ISuggestionExclusionRule[] = [
  {
    id: 'interops-specs',
    reason:
      'InterOps cross-system integration suites run on a separate cadence and are never the targeted regression set for an application code change.',
    pathSegment: 'InterOps',
  },
  {
    id: 'dm-sanity',
    reason: 'dmSanity is the smoke/sanity suite executed independently in CI.',
    fileName: 'dmSanity.cy.ts',
  },
];

/** Splits a path on both POSIX and Windows separators. */
function pathSegments(filePath: string): string[] {
  return filePath.split(/[\\/]+/).filter(Boolean);
}

/**
 * Returns the rule that excludes `filePath`, or `undefined` if it is allowed.
 * Returning the rule (not just a boolean) lets callers log *why* a spec was
 * dropped without re-deriving it.
 */
export function findSuggestionExclusion(
  filePath: string,
  rules: readonly ISuggestionExclusionRule[] = SUGGESTION_EXCLUSION_RULES,
): ISuggestionExclusionRule | undefined {
  const segments = pathSegments(filePath);
  const base = (segments[segments.length - 1] ?? '').toLowerCase();

  return rules.find((rule) => {
    if (rule.fileName && base === rule.fileName.toLowerCase()) return true;
    if (rule.pathSegment) {
      const needle = rule.pathSegment.toLowerCase();
      return segments.some((segment) => segment.toLowerCase().includes(needle));
    }
    return false;
  });
}

/** Convenience boolean wrapper around {@link findSuggestionExclusion}. */
export function isExcludedFromSuggestions(
  filePath: string,
  rules: readonly ISuggestionExclusionRule[] = SUGGESTION_EXCLUSION_RULES,
): boolean {
  return findSuggestionExclusion(filePath, rules) !== undefined;
}

/** Result of {@link partitionSuggestableTests}: kept specs + why each was dropped. */
export interface ISuggestionExclusionResult {
  kept: string[];
  excluded: { path: string; rule: ISuggestionExclusionRule }[];
}

/**
 * Partitions a list of test file paths into those pelican may suggest and
 * those excluded by {@link SUGGESTION_EXCLUSION_RULES}.
 */
export function partitionSuggestableTests(
  testFiles: readonly string[],
  rules: readonly ISuggestionExclusionRule[] = SUGGESTION_EXCLUSION_RULES,
): ISuggestionExclusionResult {
  const kept: string[] = [];
  const excluded: { path: string; rule: ISuggestionExclusionRule }[] = [];

  for (const path of testFiles) {
    const rule = findSuggestionExclusion(path, rules);
    if (rule) excluded.push({ path, rule });
    else kept.push(path);
  }

  return { kept, excluded };
}
