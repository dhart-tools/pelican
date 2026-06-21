import { DirectImportScorer } from '@/core/scoring/scorers/direct-import-scorer';
import { ScoringEngine } from '@/core/scoring/scoring-engine';
import { ISuggestorConfig, IRegistry, IFileEntry, IScorer, ISignal } from '@/types';
import { EConfidenceLevel } from '@/utils/enums';

/**
 * Minimal scorer that always emits one matched signal of the given type/weight.
 * Lets engine-level tests exercise gating without pulling in real scorer internals.
 */
function makeFakeScorer(type: string, weight: number): IScorer {
  return {
    name: type,
    version: '1.0.0',
    description: `fake ${type}`,
    type,
    weight,
    evaluate(): ISignal[] {
      return [{ source: 'fake', type, weight, matched: true, reason: `${type} matched` }];
    },
  };
}

describe('ScoringEngine', () => {
  let engine: ScoringEngine;
  let mockRegistry: Partial<IRegistry>;
  let mockConfig: ISuggestorConfig;

  beforeEach(() => {
    mockConfig = {
      scoring: {
        ubiquityThreshold: 0.7,
        minConfidence: 0.4,
        highConfidence: 0.8,
      },
    };

    mockRegistry = {
      getFile: jest.fn(),
      getDependents: jest.fn().mockReturnValue(new Set()),
      getFilesByType: jest.fn().mockReturnValue([]),
    };

    engine = new ScoringEngine(mockConfig as any, mockRegistry as any);
    engine.register(new DirectImportScorer());
  });

  /**
   * @description Verifies that a single strong signal (direct import) results in a high score and 'high' confidence.
   *
   * @example
   * changedFile: "src/Button.tsx"
   * testFile: "src/__tests__/Button.test.tsx" (imports Button.tsx)
   *
   * @expected Score >= 0.95, Confidence: EConfidenceLevel.HIGH
   */
  test('evaluateTests(): should score a direct import match highly', () => {
    const changedFile = 'src/Button.tsx';
    const testFile = 'src/__tests__/Button.test.tsx';

    (mockRegistry.getFile as jest.Mock).mockImplementation((path: string) => {
      if (path === changedFile) return { path: changedFile, type: 'source' } as IFileEntry;
      if (path === testFile)
        return { path: testFile, type: 'test', imports: [changedFile] } as IFileEntry;
      return undefined;
    });

    (mockRegistry.getDependents as jest.Mock).mockReturnValue(new Set(['some-other-file']));
    (mockRegistry.getFilesByType as jest.Mock).mockReturnValue([
      { path: 'file1' },
      { path: 'file2' },
    ]);

    const results = engine.evaluateTests(changedFile, [testFile]);

    expect(results.length).toBe(1);
    expect(results[0].score).toBeGreaterThanOrEqual(0.95);
    expect(results[0].confidence).toBe(EConfidenceLevel.HIGH);
    expect(results[0].signals[0].matched).toBe(true);
  });

  /**
   * @description Validates the ubiquity dampener. If a file is imported by > ubiquityThreshold of source files, its signal weight is significantly reduced.
   *
   * @example
   * changedFile: "src/utils.ts" (imported by 90% of files)
   * threshold: 0.7
   *
   * @expected Original weight 0.95 dampened to 0.285 (0.95 * 0.3), Confidence: EConfidenceLevel.LOW
   */
  test('evaluateTests(): should dampen scores for ubiquitous files', () => {
    const changedFile = 'src/utils.ts';
    const testFile = 'src/__tests__/utils.test.ts';

    (mockRegistry.getFile as jest.Mock).mockImplementation((path: string) => {
      if (path === changedFile) return { path: changedFile, type: 'source' } as IFileEntry;
      if (path === testFile)
        return { path: testFile, type: 'test', imports: [changedFile] } as IFileEntry;
      return undefined;
    });

    // Ubiquity: 9/10 = 0.9 > 0.7
    (mockRegistry.getDependents as jest.Mock).mockReturnValue(
      new Set(['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9']),
    );
    (mockRegistry.getFilesByType as jest.Mock).mockReturnValue(new Array(10).fill({}));

    const results = engine.evaluateTests(changedFile, [testFile]);

    expect(results[0].score).toBeLessThan(0.4);
    expect(results[0].confidence).toBe(EConfidenceLevel.LOW);
    expect(results[0].signals[0].reason).toContain('ubiquitous component');
  });

  /**
   * @description Tests noisy-or signal combination.
   * Matched signals combine as an independent-evidence union:
   *   score = 1 - ∏(1 - w_i)
   *
   * @example
   * Signal 1: 0.8
   * Signal 2: 0.4
   *
   * @expected finalScore = 1 - (1 - 0.8) * (1 - 0.4) = 1 - 0.12 = 0.88
   */
  test('calculateScore(): should combine signals via noisy-or', () => {
    const signals = [
      { source: 's1', type: 't1', weight: 0.8, matched: true },
      { source: 's2', type: 't2', weight: 0.4, matched: true },
    ];

    // @ts-ignore - reaching into private method for test
    const score = engine.calculateScore(signals);
    expect(score).toBeCloseTo(0.88);
  });

  /**
   * @description Ensures the engine respects the enabledScorers configuration.
   *
   * @expected Only signals from 'direct-import' should be present even if others are registered.
   */
  /**
   * Anchor gate: a candidate matched only by a broad/domain signal
   * (e.g. redux-chain) and no file-identity anchor is suppressed to score 0.
   */
  test('evaluateTests(): anchor gate drops redux-only matches (no anchor)', () => {
    const changedFile = 'src/dm/sagas/manageDevices.ts';
    const testFile = 'cypress/e2e/loadingIcons.cy.ts';

    (mockRegistry.getFile as jest.Mock).mockImplementation((path: string) => {
      if (path === changedFile)
        return { path: changedFile, name: 'manageDevices.ts', type: 'source' } as IFileEntry;
      if (path === testFile)
        return { path: testFile, name: 'loadingIcons.cy.ts', type: 'test' } as IFileEntry;
      return undefined;
    });

    engine.register(makeFakeScorer('redux-chain', 0.75));

    const results = engine.evaluateTests(changedFile, [testFile]);
    expect(results[0].score).toBe(0);
    expect(results[0].signals.every((s) => !s.matched)).toBe(true);
  });

  /**
   * The same redux-chain signal survives when a narrow anchor (filename) also
   * fires — recall for genuinely related specs is preserved.
   */
  test('evaluateTests(): anchor gate keeps redux match when a filename anchor co-fires', () => {
    const changedFile = 'src/dm/sagas/manageDevices.ts';
    const testFile = 'cypress/e2e/manageDevices.cy.ts';

    (mockRegistry.getFile as jest.Mock).mockImplementation((path: string) => {
      if (path === changedFile)
        return { path: changedFile, name: 'manageDevices.ts', type: 'source' } as IFileEntry;
      if (path === testFile)
        return { path: testFile, name: 'manageDevices.cy.ts', type: 'test' } as IFileEntry;
      return undefined;
    });

    engine.register(makeFakeScorer('redux-chain', 0.75));
    engine.register(makeFakeScorer('filename-match', 0.82));

    const results = engine.evaluateTests(changedFile, [testFile]);
    expect(results[0].score).toBeGreaterThan(0.4);
    expect(results[0].signals.some((s) => s.matched)).toBe(true);
  });

  test('evaluateTests(): requireAnchor=false disables the gate', () => {
    const changedFile = 'src/dm/sagas/manageDevices.ts';
    const testFile = 'cypress/e2e/loadingIcons.cy.ts';
    mockConfig.scoring.requireAnchor = false;

    (mockRegistry.getFile as jest.Mock).mockImplementation((path: string) => {
      if (path === changedFile)
        return { path: changedFile, name: 'manageDevices.ts', type: 'source' } as IFileEntry;
      if (path === testFile)
        return { path: testFile, name: 'loadingIcons.cy.ts', type: 'test' } as IFileEntry;
      return undefined;
    });

    engine.register(makeFakeScorer('redux-chain', 0.75));

    const results = engine.evaluateTests(changedFile, [testFile]);
    expect(results[0].score).toBeCloseTo(0.75);
  });

  test('evaluateTests(): runs only registered scorers (none → no signals)', () => {
    engine.unregister('direct-import'); // beforeEach registered it; remove → nothing runs

    const changedFile = 'src/Button.tsx';
    const testFile = 'src/__tests__/Button.test.tsx';

    (mockRegistry.getFile as jest.Mock).mockImplementation((path: string) => {
      if (path === changedFile) return { path: changedFile, type: 'source' } as IFileEntry;
      if (path === testFile)
        return { path: testFile, type: 'test', imports: [changedFile] } as IFileEntry;
      return undefined;
    });

    const results = engine.evaluateTests(changedFile, [testFile]);
    expect(results[0].signals).toHaveLength(0);
    expect(results[0].score).toBe(0);
  });
});
