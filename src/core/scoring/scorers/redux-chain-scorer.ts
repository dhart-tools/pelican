import { BaseScorer } from '@/core/scoring/scorers/base';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import { IScorerContext, ISignal, IRegistry } from '@/types';
import { EScorerType, ESelectorAttr } from '@/utils/enums';

export class ReduxChainScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.REDUX_CHAIN));
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { registry } = context;
    const reduxChains = registry.getReduxChains();

    for (const [sliceName, chain] of reduxChains) {
      const isInChain = Object.values(chain.files).includes(changedFile);
      if (!isInChain) continue;

      const testImports = this.getTestTestedFiles(testFile, registry);

      for (const testedFile of testImports) {
        const testedInChain = Object.values(chain.files).includes(testedFile);
        if (testedInChain) {
          return [
            this.createSignal(true, `Both files are in Redux chain "${sliceName}"`, {
              changedFile,
              testFile,
              sliceName,
              testedFile,
            }),
          ];
        }

        if (chain.consumers.includes(testedFile)) {
          return [
            this.createSignal(true, `Tested file uses Redux chain "${sliceName}"`, {
              changedFile,
              testFile,
              sliceName,
              testedFile,
            }),
          ];
        }
      }

      // E2E fallback: use selectors to find consumers
      const testEntry = registry.getFile(testFile);
      const testSelectors = testEntry?.cypress?.selectors || [];
      const selectorIndex = registry.getSelectorIndex();

      for (const testSel of testSelectors) {
        if (testSel.type !== ESelectorAttr.TEST_ID && testSel.type !== ESelectorAttr.DATA_CY)
          continue;

        const componentPaths = selectorIndex.get(testSel.value);
        if (!componentPaths) continue;

        for (const compPath of componentPaths) {
          if (chain.consumers.includes(compPath)) {
            return [
              this.createSignal(
                true,
                `E2E test uses selector '${testSel.value}' found in Redux consumer "${compPath}"`,
                { changedFile, testFile, sliceName, testedFile: compPath, selector: testSel.value },
              ),
            ];
          }
        }
      }
    }

    return [
      this.createSignal(false, 'No Redux chain relationship', {
        changedFile,
        testFile,
      }),
    ];
  }

  private getTestTestedFiles(testFile: string, registry: IRegistry): string[] {
    return Array.from(registry.getDependencies(testFile));
  }
}
