import { BaseScorer } from '@/core/scoring/scorers/base';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import { IScorerContext, ISignal } from '@/types';
import { EScorerType } from '@/utils/enums';

export class DirectImportScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.DIRECT_IMPORT));
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry } = context;

    const testImports = testEntry.imports || [];
    const isDirectImport = testImports.includes(changedFile);

    if (isDirectImport) {
      return [
        this.createSignal(true, `Test directly imports ${changedFile}`, {
          changedFile,
          testFile,
          importType: 'direct',
        }),
      ];
    }

    return [
      this.createSignal(false, 'Test does not directly import this file', {
        changedFile,
        testFile,
        importType: 'direct',
      }),
    ];
  }
}
