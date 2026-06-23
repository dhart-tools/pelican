import { BaseScorer } from '@/core/scoring/scorers/base';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import { IScorerContext, ISignal } from '@/types';
import { EScorerType } from '@/utils/enums';

/**
 * Files with more importers than this are treated as shared infrastructure
 * (constants, types, global hooks) and suppressed from transitive matching —
 * any test's imports eventually reach them, so a hit is noise not signal.
 */
const HIGH_FANOUT_IMPORTERS = 200;

export class TransitiveImportScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.TRANSITIVE_IMPORT));
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, registry } = context;

    const importerCount = registry.getDependents(changedFile).size;
    if (importerCount > HIGH_FANOUT_IMPORTERS) {
      return [
        this.createSignal(
          false,
          `High-fanout source (${importerCount} importers) — transitive match is noise`,
          {
            changedFile,
            testFile,
            importerCount,
          },
        ),
      ];
    }

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
