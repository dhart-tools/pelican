import path from 'path';

import { BaseScorer } from '@/core/scoring/scorers/base';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import { IScorerContext, ISignal } from '@/types';
import { EScorerType } from '@/utils/enums';

/**
 * Colocation scorer: matches tests that live *next to* the source file by path.
 *
 * Covers the dominant co-location conventions:
 *   - Same directory:     src/foo/Bar.tsx          + src/foo/Bar.test.tsx
 *   - __tests__ sibling:  src/foo/Bar.tsx          + src/foo/__tests__/Bar.test.tsx
 *   - index + folder:     src/foo/fileManager/index.ts
 *                         + src/foo/fileManager/fileManager.test.ts
 *
 * Distance-graded signal: exact dir match → full weight; `__tests__` sibling
 * or parent/child dir → 0.8×; shared two-level ancestor → 0.5×.
 */
export class ColocationScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.COLOCATION));
  }

  evaluate(changedFile: string, testFile: string, _context: IScorerContext): ISignal[] {
    const sourceDir = path.dirname(changedFile);
    const testDir = path.dirname(testFile);

    const relation = this.classify(sourceDir, testDir);
    if (!relation) {
      return [this.createSignal(false, 'Test not colocated with source', { sourceDir, testDir })];
    }

    const signal = this.createSignal(
      true,
      `Colocated (${relation.kind}): source dir "${sourceDir}" ~ test dir "${testDir}"`,
      { sourceDir, testDir, relation: relation.kind },
    );
    signal.weight = this.weight * relation.factor;
    return [signal];
  }

  private classify(sourceDir: string, testDir: string): { kind: string; factor: number } | null {
    if (sourceDir === testDir) return { kind: 'same-dir', factor: 1 };

    const srcParts = sourceDir.split('/').filter(Boolean);
    const testParts = testDir.split('/').filter(Boolean);

    // __tests__ sibling: source dir + ".../__tests__"
    if (
      testParts[testParts.length - 1] === '__tests__' &&
      testParts.slice(0, -1).join('/') === srcParts.join('/')
    ) {
      return { kind: '__tests__-sibling', factor: 0.85 };
    }

    // source lives in parent of test dir, or vice versa (one hop).
    // Require shared prefix depth >= 2 so top-level umbrellas like `src/`
    // don't fire: `src/url.test.ts` vs `src/auth/Foo.tsx` is NOT colocation.
    if (
      srcParts.length === testParts.length - 1 &&
      testParts.slice(0, -1).join('/') === srcParts.join('/') &&
      srcParts.length >= 2
    ) {
      return { kind: 'test-in-child-dir', factor: 0.7 };
    }
    if (
      testParts.length === srcParts.length - 1 &&
      srcParts.slice(0, -1).join('/') === testParts.join('/') &&
      testParts.length >= 2
    ) {
      return { kind: 'source-in-child-dir', factor: 0.7 };
    }

    // shared ancestor within 2 levels — also require depth >= 3 to avoid
    // matching everything rooted at `src/*`.
    const shared = this.sharedPrefixLen(srcParts, testParts);
    const maxDepth = Math.max(srcParts.length, testParts.length);
    if (shared >= maxDepth - 2 && shared >= 3) {
      return { kind: 'near-ancestor', factor: 0.4 };
    }

    return null;
  }

  private sharedPrefixLen(a: string[], b: string[]): number {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  }
}
