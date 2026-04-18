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
    const MAX_DEPTH = 3;

    for (const [sliceName, chain] of reduxChains) {
      const isInChain = Object.values(chain.files).includes(changedFile);
      if (!isInChain) continue;

      const consumerSet = new Set(chain.consumers);
      const testEntry = registry.getFile(testFile);
      const visitedRoutes = testEntry?.cypress?.visitedRoutes || [];
      const routeMap = registry.getRouteMap();

      for (const route of visitedRoutes) {
        const componentPath = routeMap.get(route);
        if (!componentPath) continue;

        // BFS from the route's component through its imports, looking for
        // a direct chain consumer. Depth-discount so deep chains don't
        // collide with obvious ones.
        const visited = new Set<string>([componentPath]);
        let frontier: string[] = [componentPath];
        for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
          const hit = frontier.find((f) => consumerSet.has(f));
          if (hit) {
            const factor = depth === 0 ? 1 : depth === 1 ? 0.7 : 0.45;
            const base = this.weight;
            (this as unknown as { __effectiveWeight?: number }).__effectiveWeight = base * factor;
            const sig = this.createSignal(
              true,
              `Test visits ${route}; consumer ${hit} of chain "${sliceName}" at depth ${depth}`,
              { changedFile, testFile, sliceName, route, consumer: hit, depth },
            );
            delete (this as unknown as { __effectiveWeight?: number }).__effectiveWeight;
            return [sig];
          }
          const next: string[] = [];
          for (const f of frontier) {
            const entry = registry.getFile(f);
            for (const imp of entry?.imports ?? []) {
              if (visited.has(imp)) continue;
              visited.add(imp);
              next.push(imp);
            }
          }
          frontier = next;
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
