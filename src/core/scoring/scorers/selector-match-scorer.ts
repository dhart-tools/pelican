import { BaseScorer } from '@/core/scoring/scorers/base';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import { IScorerContext, ISignal } from '@/types';
import { ESelectorAttr } from '@/utils/enums';
import { EScorerType } from '@/utils/enums';

export class SelectorMatchScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.SELECTOR_MATCH));
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, changedFile: changedEntry } = context;

    const testSelectors = testEntry.cypress?.selectors || [];
    if (testSelectors.length === 0) {
      return [this.createSignal(false, 'No selectors in test')];
    }

    const sourceSelectors = changedEntry.selectors || [];
    if (sourceSelectors.length === 0) {
      return [this.createSignal(false, 'No selectors in source file')];
    }

    const sourceSelectorValues = new Set(sourceSelectors.map((s) => s.value));

    const matches: string[] = [];
    for (const testSelector of testSelectors) {
      if (
        testSelector.type === ESelectorAttr.TEST_ID ||
        testSelector.type === ESelectorAttr.DATA_CY
      ) {
        if (sourceSelectorValues.has(testSelector.value)) {
          matches.push(testSelector.value);
        }
      }
    }

    if (matches.length > 0) {
      return [
        this.createSignal(true, `Test selectors match: ${matches.join(', ')}`, {
          changedFile,
          testFile,
          matchedSelectors: matches,
        }),
      ];
    }

    return [
      this.createSignal(false, 'No matching selectors', {
        changedFile,
        testFile,
        testSelectors,
        sourceSelectors: [...sourceSelectorValues],
      }),
    ];
  }
}
