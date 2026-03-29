import { SelectorIdMatchScorer } from '@v2/core/scoring/scorers/selector-id-match-scorer';
import { IScorerContext } from '@v2/types';
import { ESelectorAttr } from '@v2/utils/enums';

describe('SelectorIdMatchScorer', () => {
  let scorer: SelectorIdMatchScorer;

  beforeEach(() => {
    scorer = new SelectorIdMatchScorer();
  });

  test('should match when test ID selector matches source ID attribute', () => {
    const changedFile = 'Modal.tsx';
    const testFile = 'modal.cy.ts';
    const id = 'confirm-modal';

    const context: IScorerContext = {
      changedFile: {
        path: changedFile,
        selectors: [{ attr: ESelectorAttr.ID, value: id, raw: '...' }],
      } as any,
      testFile: {
        path: testFile,
        cypress: {
          selectors: [{ type: ESelectorAttr.ID, value: id, raw: '...' }],
        },
      } as any,
    } as any;

    const signals = scorer.evaluate(changedFile, testFile, context);

    expect(signals[0].matched).toBe(true);
    expect((signals[0].metadata as any).matchedIds).toEqual([id]);
  });

  test('should not match when source ID is missing', () => {
    const changedFile = 'Modal.tsx';
    const testFile = 'modal.cy.ts';
    const id = 'confirm-modal';

    const context: IScorerContext = {
      changedFile: {
        path: changedFile,
        selectors: [],
      } as any,
      testFile: {
        path: testFile,
        cypress: {
          selectors: [{ type: ESelectorAttr.ID, value: id, raw: '...' }],
        },
      } as any,
    } as any;

    const signals = scorer.evaluate(changedFile, testFile, context);

    expect(signals[0].matched).toBe(false);
  });
});
