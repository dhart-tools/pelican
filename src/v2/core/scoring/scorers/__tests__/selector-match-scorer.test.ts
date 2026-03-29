import { SelectorMatchScorer } from '@v2/core/scoring/scorers/selector-match-scorer';
import { IScorerContext } from '@v2/types';
import { ESelectorAttr } from '@v2/utils/enums';

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
    expect(signals[0].weight).toBe(0.8);
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
});
