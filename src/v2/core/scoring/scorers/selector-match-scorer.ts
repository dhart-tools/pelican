import { BaseScorer } from "./base";
import { IScorerContext, ISignal } from "../../../types";
import { ESelectorAttr } from "@v2/utils/enums";

export class SelectorMatchScorer extends BaseScorer {
  constructor() {
    super({
      name: 'selector-match',
      version: '1.0.0',
      description: 'Scores based on selector (testid, data-cy) matches between test and source',
      type: 'selector-match',
      weight: 0.80
    });
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
      if (testSelector.type === ESelectorAttr.TEST_ID || testSelector.type === ESelectorAttr.DATA_CY) {
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
          matchedSelectors: matches
        })
      ];
    }

    return [
      this.createSignal(false, 'No matching selectors', {
        changedFile,
        testFile,
        testSelectors,
        sourceSelectors: [...sourceSelectorValues]
      })
    ];
  }
}
