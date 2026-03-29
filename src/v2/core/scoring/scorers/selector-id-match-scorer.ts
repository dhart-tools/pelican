import { BaseScorer } from '@v2/core/scoring/scorers/base';
import { getScorerConfig } from '@v2/core/scoring/scoring-config';
import { IScorerContext, ISignal } from '@v2/types';
import { EScorerType, ESelectorAttr } from '@v2/utils/enums';

export class SelectorIdMatchScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.SELECTOR_ID_MATCH));
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, changedFile: changedEntry } = context;

    const testSelectors = testEntry.cypress?.selectors || [];
    const sourceSelectors = changedEntry.selectors || [];

    const testIdSelectors = testSelectors.filter((s) => s.type === ESelectorAttr.ID);
    const sourceIds = sourceSelectors.filter((s) => s.attr === ESelectorAttr.ID);

    const matches: string[] = [];
    for (const testSel of testIdSelectors) {
      if (sourceIds.some((s) => s.value === testSel.value)) {
        matches.push(testSel.value);
      }
    }

    return [
      this.createSignal(
        matches.length > 0,
        matches.length > 0 ? `Matching IDs: ${matches.join(', ')}` : 'No ID matches',
        {
          changedFile,
          testFile,
          matchedIds: matches,
        },
      ),
    ];
  }
}
