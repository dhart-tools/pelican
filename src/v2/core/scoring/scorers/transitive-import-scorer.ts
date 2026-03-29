import { BaseScorer } from '@v2/core/scoring/scorers/base';
import { getScorerConfig } from '@v2/core/scoring/scoring-config';
import { IScorerContext, ISignal } from '@v2/types';
import { EScorerType } from '@v2/utils/enums';

export class TransitiveImportScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.TRANSITIVE_IMPORT));
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, registry } = context;

    const testImports = testEntry.imports || [];

    for (const importPath of testImports) {
      const deps = registry.getDependencies(importPath);
      if (deps.has(changedFile)) {
        return [
          this.createSignal(true, `Test imports ${importPath}, which imports ${changedFile}`, {
            changedFile,
            testFile,
            intermediate: importPath,
          }),
        ];
      }
    }

    return [
      this.createSignal(false, 'No transitive import', {
        changedFile,
        testFile,
      }),
    ];
  }
}
