import path from 'path';

import { BaseScorer } from '@/core/scoring/scorers/base';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import { IScorerContext, ISignal } from '@/types';
import { EScorerType } from '@/utils/enums';

export class FilenameConventionScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.FILENAME_MATCH));
  }

  evaluate(changedFile: string, testFile: string, _context: IScorerContext): ISignal[] {
    const changedBasename = path.basename(changedFile).replace(/\.(tsx?|jsx?)$/, '');
    // TODO: Handle the case for `.test.ts` / `.spec.ts` files
    const testBasename = path.basename(testFile).replace(/\.(cy|spec)\.(ts|js)x?$/, '');

    // Normalize: lowercase and strip all non-alphanumeric characters (-, _, spaces)
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

    const normalizedChanged = normalize(changedBasename);
    const normalizedTest = normalize(testBasename);

    const matches = normalizedChanged === normalizedTest;

    return [
      this.createSignal(
        matches,
        matches
          ? `Filename convention match: ${changedBasename} ↔ ${testBasename}`
          : 'No filename match',
        {
          changedFile,
          testFile,
          changedBasename,
          testBasename,
        },
      ),
    ];
  }
}
