import { createRegistry } from '@/core/registry/registry';
import {
  TemporalCoherenceScorer,
  TEMPORAL_DEFAULTS,
  creationProximity,
  updateCoupling,
} from '@/core/scoring/scorers/temporal-coherence-scorer';
import { ScoringEngine } from '@/core/scoring/scoring-engine';
import { ISignal } from '@/types/analyzers';
import { ISuggestorConfig } from '@/types/config';
import { IFileGitHistory, IRepoGitHistory } from '@/types/git';
import { IFileEntry, IRegistry } from '@/types/registry';
import { IScorer, IScorerContext } from '@/types/scorers';

const DAY = 86400;
const BASE = 1_600_000_000; // fixed reference instant (unix secs)
const cfg = TEMPORAL_DEFAULTS;

const fh = (createdAt: number, updatedAt: number, commitTimes: number[]): IFileGitHistory => ({
  createdAt,
  updatedAt,
  commitTimes,
});

// ─── A. creation proximity ───────────────────────────────────────
describe('creationProximity', () => {
  it('full weight inside the soft window', () => {
    const r = creationProximity(fh(BASE, BASE, [BASE]), fh(BASE + 7 * DAY, 0, [0]), cfg);
    expect(r.weight).toBeCloseTo(cfg.maxWeight, 5);
  });

  it('decays linearly between soft and hard (test after source)', () => {
    // 21d gap, window [14,28] → (28-21)/(28-14) = 0.5 of max
    const r = creationProximity(fh(BASE, BASE, [BASE]), fh(BASE + 21 * DAY, 0, [0]), cfg);
    expect(r.weight).toBeCloseTo(cfg.maxWeight * 0.5, 5);
  });

  it('zero beyond the hard window', () => {
    const r = creationProximity(fh(BASE, BASE, [BASE]), fh(BASE + 40 * DAY, 0, [0]), cfg);
    expect(r.weight).toBe(0);
  });

  it('is asymmetric — the "before source" side is tighter', () => {
    // 10d BEFORE source: before-side window is [7,14] → still inside, decayed
    const before = creationProximity(fh(BASE, BASE, [BASE]), fh(BASE - 10 * DAY, 0, [0]), cfg);
    // 10d AFTER source: after-side window is [14,28] → inside soft → full weight
    const after = creationProximity(fh(BASE, BASE, [BASE]), fh(BASE + 10 * DAY, 0, [0]), cfg);
    expect(after.weight).toBeGreaterThan(before.weight);
    expect(after.weight).toBeCloseTo(cfg.maxWeight, 5);

    // 20d before is past the tightened hard bound (14) → no signal
    const farBefore = creationProximity(fh(BASE, BASE, [BASE]), fh(BASE - 20 * DAY, 0, [0]), cfg);
    expect(farBefore.weight).toBe(0);
  });
});

// ─── B. update coupling (base-rate normalized) ───────────────────
describe('updateCoupling', () => {
  const win = (k: number) => BASE + k * cfg.updateWindowDays * DAY;

  it('fires when co-updates exceed chance (lift > 1)', () => {
    const changed = fh(win(0), win(5), [win(0), win(5)]); // 2 windows
    const test = fh(win(0), win(5), [win(0), win(5)]); // same 2 windows
    const r = updateCoupling(changed, test, cfg);
    expect(r.weight).toBeGreaterThan(0);
    expect((r.metadata as { lift: number }).lift).toBeGreaterThan(1);
  });

  it('normalizes away a ubiquitously-churning file (lift ≈ 1 → 0)', () => {
    const changed = fh(win(0), win(5), [win(0), win(5)]); // 2 windows
    const test = fh(win(0), win(5), [win(0), win(1), win(2), win(3), win(4), win(5)]); // every window
    const r = updateCoupling(changed, test, cfg);
    expect(r.weight).toBe(0);
    expect((r.metadata as { lift: number }).lift).toBeCloseTo(1, 5);
  });

  it('requires at least two shared windows (a single co-edit is coincidence)', () => {
    const changed = fh(win(0), win(9), [win(0)]);
    const test = fh(win(0), win(9), [win(0)]);
    const r = updateCoupling(changed, test, cfg);
    expect(r.weight).toBe(0);
  });
});

// ─── scorer: no-op guards + combined signal ──────────────────────
describe('TemporalCoherenceScorer.evaluate', () => {
  const scorer = new TemporalCoherenceScorer();

  const entry = (over: Partial<IFileEntry>): IFileEntry => ({
    name: 'x',
    type: 'source',
    path: 'x',
    exports: [],
    imports: [],
    classes: [],
    functions: [],
    interfaces: [],
    keywords: [],
    ...over,
  });

  const ctx = (over: Partial<IScorerContext>): IScorerContext => ({
    registry: {} as unknown as IRegistry,
    config: {
      scoring: { ubiquityThreshold: 0.7, minConfidence: 0.4, highConfidence: 0.8, temporal: cfg },
    },
    changedFile: entry({ path: 'src/a.ts', repoRoot: '/src' }),
    testFile: entry({ path: 'e2e/a.cy.ts', repoRoot: '/test', type: 'test' }),
    ...over,
  });

  const onlySig = (s: ISignal[]) => s[0];

  it('no-ops when histories are absent', () => {
    const sig = onlySig(
      scorer.evaluate('src/a.ts', 'e2e/a.cy.ts', ctx({ gitHistories: new Map() })),
    );
    expect(sig.matched).toBe(false);
    expect(sig.weight).toBe(0);
  });

  it('no-ops when a repo history is unavailable (e.g. shallow clone)', () => {
    const gitHistories = new Map<string, IRepoGitHistory>([
      ['/src', { repoRoot: '/src', available: false, files: new Map() }],
      ['/test', { repoRoot: '/test', available: false, files: new Map() }],
    ]);
    const sig = onlySig(scorer.evaluate('src/a.ts', 'e2e/a.cy.ts', ctx({ gitHistories })));
    expect(sig.matched).toBe(false);
  });

  it('no-ops when a file is not in history yet (uncommitted)', () => {
    const gitHistories = new Map<string, IRepoGitHistory>([
      ['/src', { repoRoot: '/src', available: true, files: new Map() }], // a.ts absent
      [
        '/test',
        {
          repoRoot: '/test',
          available: true,
          files: new Map([['e2e/a.cy.ts', fh(BASE, BASE, [BASE])]]),
        },
      ],
    ]);
    const sig = onlySig(scorer.evaluate('src/a.ts', 'e2e/a.cy.ts', ctx({ gitHistories })));
    expect(sig.matched).toBe(false);
  });

  it('bumps across repos when creation timing tracks, capped at maxWeight', () => {
    const gitHistories = new Map<string, IRepoGitHistory>([
      [
        '/src',
        {
          repoRoot: '/src',
          available: true,
          files: new Map([['src/a.ts', fh(BASE, BASE, [BASE])]]),
        },
      ],
      [
        '/test',
        {
          repoRoot: '/test',
          available: true,
          files: new Map([['e2e/a.cy.ts', fh(BASE + 5 * DAY, BASE + 5 * DAY, [BASE + 5 * DAY])]]),
        },
      ],
    ]);
    const sig = onlySig(scorer.evaluate('src/a.ts', 'e2e/a.cy.ts', ctx({ gitHistories })));
    expect(sig.matched).toBe(true);
    expect(sig.weight).toBeGreaterThan(0);
    expect(sig.weight).toBeLessThanOrEqual(cfg.maxWeight);
  });
});

// ─── engine integration: corroborator, never an anchor ───────────
describe('temporal scorer inside the ScoringEngine', () => {
  class FakeAnchorScorer implements IScorer {
    name = 'fake-anchor';
    version = '1.0.0';
    description = 'test';
    type = 'direct-import'; // a narrow anchor type
    weight = 0.5;
    constructor(private readonly fire: boolean) {}
    evaluate(): ISignal[] {
      return [
        {
          source: this.name,
          type: this.type,
          weight: 0.5,
          matched: this.fire,
          reason: 'fake anchor',
        },
      ];
    }
  }

  const config: ISuggestorConfig = {
    scoring: {
      ubiquityThreshold: 0.7,
      minConfidence: 0.4,
      highConfidence: 0.8,
      requireAnchor: true,
      temporal: cfg,
    },
  };

  const buildRegistry = (): IRegistry => {
    const reg = createRegistry();
    reg.buildFromFileEntries([
      {
        name: 'a.ts',
        type: 'source',
        path: 'src/a.ts',
        repoRoot: '/src',
        exports: [],
        imports: [],
        classes: [],
        functions: [],
        interfaces: [],
        keywords: [],
      },
      {
        name: 'a.cy.ts',
        type: 'test',
        path: 'e2e/a.cy.ts',
        repoRoot: '/test',
        exports: [],
        imports: [],
        classes: [],
        functions: [],
        interfaces: [],
        keywords: [],
      },
    ]);
    return reg;
  };

  const coupled = new Map<string, IRepoGitHistory>([
    [
      '/src',
      { repoRoot: '/src', available: true, files: new Map([['src/a.ts', fh(BASE, BASE, [BASE])]]) },
    ],
    [
      '/test',
      {
        repoRoot: '/test',
        available: true,
        files: new Map([['e2e/a.cy.ts', fh(BASE + 5 * DAY, BASE + 5 * DAY, [BASE + 5 * DAY])]]),
      },
    ],
  ]);
  const farApart = new Map<string, IRepoGitHistory>([
    [
      '/src',
      { repoRoot: '/src', available: true, files: new Map([['src/a.ts', fh(BASE, BASE, [BASE])]]) },
    ],
    [
      '/test',
      {
        repoRoot: '/test',
        available: true,
        files: new Map([
          ['e2e/a.cy.ts', fh(BASE + 365 * DAY, BASE + 365 * DAY, [BASE + 365 * DAY])],
        ]),
      },
    ],
  ]);

  const scoreWith = (anchorFires: boolean, histories: Map<string, IRepoGitHistory>): number => {
    const engine = new ScoringEngine(config, buildRegistry(), histories);
    engine.register(new FakeAnchorScorer(anchorFires));
    engine.register(new TemporalCoherenceScorer());
    return engine.evaluateTests('src/a.ts', ['e2e/a.cy.ts'])[0].score;
  };

  it('lifts an anchored candidate when temporally coupled', () => {
    expect(scoreWith(true, coupled)).toBeGreaterThan(scoreWith(true, farApart));
  });

  it('does nothing for a far-apart candidate (anchor score unchanged)', () => {
    expect(scoreWith(true, farApart)).toBeCloseTo(0.5, 5);
  });

  it('cannot admit a candidate on its own — no anchor → suppressed despite coupling', () => {
    expect(scoreWith(false, coupled)).toBe(0);
  });
});
