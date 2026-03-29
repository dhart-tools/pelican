import { BaseScorer } from "@v2/core/scoring/scorers/base";
import { IScorerContext, ISignal } from "@v2/types";

export class DirectImportScorer extends BaseScorer {
  constructor() {
    super({
      name: 'direct-import',
      version: '1.0.0',
      description: 'Scores based on direct imports between test and source',
      type: 'direct-import',
      weight: 0.95
    });
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
          importType: 'direct'
        })
      ];
    }

    return [
      this.createSignal(false, 'Test does not directly import this file', {
        changedFile,
        testFile,
        importType: 'direct'
      })
    ];
  }
}
