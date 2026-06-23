import { SelectorMatchScorer } from '@/core/scoring/scorers/selector-match-scorer';
import { IScorerContext } from '@/types';
import { ESelectorAttr } from '@/utils/enums';

describe('SelectorMatchScorer', () => {
  let scorer: SelectorMatchScorer;
  let mockContext: Partial<IScorerContext>;

  beforeEach(() => {
    scorer = new SelectorMatchScorer();
    mockContext = {
      testFile: {
        cypress: {
          selectors: [
            {
              type: ESelectorAttr.TEST_ID,
              value: 'login-submit',
              raw: '[data-testid="login-submit"]',
            },
          ],
        },
      } as any,
      changedFile: {
        selectors: [{ attr: ESelectorAttr.TEST_ID, value: 'login-submit' }],
      } as any,
    };
  });

  /**
   * @description Verifies that matching testids between test and source files are identified as a positive signal (0.80 weight).
   *
   * @example
   * changedFile selectors: [{ attr: 'data-testid', value: 'login-submit' }]
   * testFile selectors: [{ type: 'data-testid', value: 'login-submit' }]
   *
   * @expected Matched signal should be returned with weight 0.80 and reason listing the matches.
   */
  test('evaluate(): should detect matching data-testid selectors', () => {
    const signals = scorer.evaluate('src/Login.tsx', 'test.cy.ts', mockContext as IScorerContext);

    expect(signals[0].matched).toBe(true);
    // Single match scales via density floor (1 match vs 3-match cap → 0.35 floor).
    // 0.8 * 0.35 = 0.28
    expect(signals[0].weight).toBeCloseTo(0.28, 2);
    expect(signals[0].reason).toContain('Test selectors match: login-submit');
  });

  /**
   * @description Validates that the scorer correctly handles data-cy attributes.
   *
   * @example
   * changedFile selectors: [{ attr: 'data-cy', value: 'submit-button' }]
   * testFile selectors: [{ type: 'data-cy', value: 'submit-button' }]
   *
   * @expected Matched signal should be returned.
   */
  test('evaluate(): should detect matching data-cy selectors', () => {
    mockContext.testFile!.cypress!.selectors = [
      { type: ESelectorAttr.DATA_CY, value: 'submit-button', raw: '[data-cy="submit-button"]' },
    ];
    mockContext.changedFile!.selectors = [{ attr: ESelectorAttr.DATA_CY, value: 'submit-button' }];

    const signals = scorer.evaluate('src/Login.tsx', 'test.cy.ts', mockContext as IScorerContext);
    expect(signals[0].matched).toBe(true);
  });

  /**
   * @description Ensures no match is reported when selectors do not overlap.
   *
   * @expected Unmatched signal with reason "No matching selectors".
   */
  test('evaluate(): should report no match when selectors do not overlap', () => {
    mockContext.changedFile!.selectors = [{ attr: ESelectorAttr.TEST_ID, value: 'other-id' }];

    const signals = scorer.evaluate('src/Login.tsx', 'test.cy.ts', mockContext as IScorerContext);
    expect(signals[0].matched).toBe(false);
    expect(signals[0].reason).toBe('No matching selectors');
  });

  /**
   * @description Checks that the scorer reports no match if the source file has no selectors.
   *
   * @expected Unmatched signal with reason "No selectors in source file".
   */
  test('evaluate(): should handle missing source selectors gracefully', () => {
    mockContext.changedFile!.selectors = [];
    const signals = scorer.evaluate('src/Login.tsx', 'test.cy.ts', mockContext as IScorerContext);
    expect(signals[0].matched).toBe(false);
    expect(signals[0].reason).toBe('No selectors in source file');
  });

  // Fix #2: ubiquitous-selector disqualification. Requires a registry providing
  // test-selector frequencies; without one (the cases above) no check applies.
  const mockRegistry = (freqs: Record<string, number>, total: number) =>
    ({
      getDependencies: () => new Set<string>(),
      getFile: () => undefined,
      getTestFileCount: () => total,
      getTestSelectorFrequency: (v: string) => freqs[v] ?? 0,
    }) as any;

  test('evaluate(): disqualifies a match carried only by a ubiquitous selector', () => {
    mockContext.changedFile!.selectors = [{ attr: ESelectorAttr.TEST_ID, value: 'Type_' }];
    mockContext.testFile!.cypress!.selectors = [
      { type: ESelectorAttr.TEST_ID, value: 'Type_', raw: '' },
    ];
    mockContext.registry = mockRegistry({ Type_: 50 }, 100); // 50% of specs → ubiquitous
    mockContext.config = { scoring: { ubiquitousSelectorThreshold: 0.1 } } as any;

    const signals = scorer.evaluate('src/Grid.tsx', 'firmware.cy.ts', mockContext as IScorerContext);
    expect(signals[0].matched).toBe(false);
    expect(signals[0].reason).toContain('ubiquitous');
  });

  test('evaluate(): keeps the match on a discriminating selector, ignoring ubiquitous ones', () => {
    mockContext.changedFile!.selectors = [
      { attr: ESelectorAttr.TEST_ID, value: 'Type_' },
      { attr: ESelectorAttr.TEST_ID, value: 'facility-name-input' },
    ];
    mockContext.testFile!.cypress!.selectors = [
      { type: ESelectorAttr.TEST_ID, value: 'Type_', raw: '' },
      { type: ESelectorAttr.TEST_ID, value: 'facility-name-input', raw: '' },
    ];
    mockContext.registry = mockRegistry({ Type_: 50, 'facility-name-input': 2 }, 100);
    mockContext.config = { scoring: { ubiquitousSelectorThreshold: 0.1 } } as any;

    const signals = scorer.evaluate('src/Grid.tsx', 'facility.cy.ts', mockContext as IScorerContext);
    expect(signals[0].matched).toBe(true);
    expect(signals[0].reason).toContain('facility-name-input');
    expect(signals[0].reason).not.toContain('Type_');
    expect(signals[0].reason).toContain('ubiquitous ignored');
  });
});
