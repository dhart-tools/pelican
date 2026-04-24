import { UsageSiteScorer } from '@/core/scoring/scorers/usage-site-scorer';
import { IScorerContext } from '@/types';

describe('UsageSiteScorer', () => {
  let scorer: UsageSiteScorer;

  beforeEach(() => {
    scorer = new UsageSiteScorer();
  });

  function buildRegistry(deps: Map<string, Set<string>>) {
    return {
      getDependents: (p: string) => deps.get(p) ?? new Set<string>(),
    };
  }

  test('fires at depth 2: changed → mid → test imports mid', () => {
    const changed = 'src/utils/format-date.ts';
    const mid = 'src/components/Calendar.tsx';
    const test = 'src/components/Calendar.test.tsx';
    const deps = new Map<string, Set<string>>([
      [changed, new Set([mid])],
      [mid, new Set([test])],
    ]);
    const ctx: IScorerContext = {
      registry: buildRegistry(deps) as any,
      changedFile: { path: changed } as any,
      testFile: { path: test, imports: [mid] } as any,
    } as any;

    const [signal] = scorer.evaluate(changed, test, ctx);
    expect(signal.matched).toBe(true);
    expect(signal.metadata).toMatchObject({ depth: 1, via: mid });
  });

  test('fires at depth 3 with discount', () => {
    const changed = 'src/lib/a.ts';
    const dep1 = 'src/lib/b.ts';
    const dep2 = 'src/lib/c.ts';
    const test = 'src/lib/c.test.ts';
    const deps = new Map<string, Set<string>>([
      [changed, new Set([dep1])],
      [dep1, new Set([dep2])],
      [dep2, new Set([test])],
    ]);
    const ctx: IScorerContext = {
      registry: buildRegistry(deps) as any,
      changedFile: { path: changed } as any,
      testFile: { path: test, imports: [dep2] } as any,
    } as any;

    const [signal] = scorer.evaluate(changed, test, ctx);
    expect(signal.matched).toBe(true);
    expect(signal.metadata).toMatchObject({ depth: 2 });
  });

  test('does not fire when test imports nothing in cone', () => {
    const ctx: IScorerContext = {
      registry: buildRegistry(new Map([['src/util.ts', new Set(['src/A.tsx'])]])) as any,
      changedFile: { path: 'src/util.ts' } as any,
      testFile: { path: 'src/B.test.ts', imports: ['src/B.tsx'] } as any,
    } as any;
    const [signal] = scorer.evaluate('src/util.ts', 'src/B.test.ts', ctx);
    expect(signal.matched).toBe(false);
  });

  test('skips when changed file has high fanout', () => {
    const importers = new Set<string>();
    for (let i = 0; i < 250; i++) importers.add(`f${i}.ts`);
    const ctx: IScorerContext = {
      registry: buildRegistry(new Map([['src/constants.ts', importers]])) as any,
      changedFile: { path: 'src/constants.ts' } as any,
      testFile: { path: 'src/x.test.ts', imports: ['f0.ts'] } as any,
    } as any;
    const [signal] = scorer.evaluate('src/constants.ts', 'src/x.test.ts', ctx);
    expect(signal.matched).toBe(false);
    expect(signal.reason).toContain('High-fanout');
  });
});
