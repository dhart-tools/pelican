import { BaseScorer } from '@/core/scoring/scorers/base';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import { IScorerContext, ISignal } from '@/types';
import { EScorerType } from '@/utils/enums';

// Cap on how many files one action-type string may appear in before it's
// considered too generic to score. Matches the noisy-string intuition of the
// existing describe-block IDF cutoff: if an action type is referenced by many
// files, matching on it tells us nothing.
const MAX_FILES_PER_ACTION = 25;

// Upper bound on action-type strings we inspect per scoring pass. Redux slices
// can declare dozens of case types; we only need a handful of hits to fire.
const MAX_ACTION_TYPES_PER_FILE = 40;

export class ActionTypeScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.ACTION_TYPE));
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { registry } = context;
    const changedEntry = registry.getFile(changedFile);
    const testEntry = registry.getFile(testFile);

    const changedActions = changedEntry?.actionTypeStrings ?? [];
    const testActions = testEntry?.actionTypeStrings ?? [];

    if (changedActions.length === 0 || testActions.length === 0) {
      return [this.createSignal(false, 'No action-type strings on one side')];
    }

    const index = registry.getActionTypeIndex();
    const testSet = new Set(testActions);
    const matched: string[] = [];

    for (const action of changedActions.slice(0, MAX_ACTION_TYPES_PER_FILE)) {
      if (!testSet.has(action)) continue;
      const owners = index.get(action);
      if (owners && owners.size > MAX_FILES_PER_ACTION) continue;
      matched.push(action);
      if (matched.length >= 3) break;
    }

    if (matched.length === 0) {
      return [this.createSignal(false, 'No shared action-type strings')];
    }

    const preview = matched.slice(0, 3).join(', ');
    return [
      this.createSignal(true, `Shares action-type string(s): ${preview}`, {
        changedFile,
        testFile,
        matched,
      }),
    ];
  }
}
