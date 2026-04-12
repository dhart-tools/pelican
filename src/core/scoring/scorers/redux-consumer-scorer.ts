import { BaseScorer } from '@/core/scoring/scorers/base';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import { IScorerContext, ISignal } from '@/types';
import { EScorerType } from '@/utils/enums';

export class ReduxConsumerScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.REDUX_CONSUMER));
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { registry } = context;
    const reduxChains = registry.getReduxChains();

    for (const [sliceName, chain] of reduxChains) {
      const isInChain = Object.values(chain.files).includes(changedFile);
      if (!isInChain) continue;

      const consumers = chain.consumers;
      const testEntry = registry.getFile(testFile);
      const visitedRoutes = testEntry?.cypress?.visitedRoutes || [];
      const routeMap = registry.getRouteMap();

      for (const route of visitedRoutes) {
        const componentPath = routeMap.get(route);
        if (componentPath && consumers.includes(componentPath)) {
          return [
            this.createSignal(
              true,
              `Test visits ${route}, component uses Redux chain "${sliceName}"`,
              {
                changedFile,
                testFile,
                sliceName,
                route,
                consumer: componentPath,
              },
            ),
          ];
        }
      }
    }

    return [
      this.createSignal(false, 'No Redux consumer relationship', {
        changedFile,
        testFile,
      }),
    ];
  }
}
