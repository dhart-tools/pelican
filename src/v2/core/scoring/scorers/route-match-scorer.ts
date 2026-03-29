import { BaseScorer } from "@v2/core/scoring/scorers/base";
import { IScorerContext, ISignal, IRegistry } from "@v2/types";
import { getScorerConfig } from "@v2/core/scoring/scoring-config";
import { EScorerType } from "@v2/utils/enums";

export class RouteMatchScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.ROUTE_MATCH));
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, registry } = context;

    const visitedRoutes = testEntry.cypress?.visitedRoutes || [];
    if (visitedRoutes.length === 0) {
      return [this.createSignal(false, 'No routes visited')];
    }

    const routeMap = registry.getRouteMap();

    for (const route of visitedRoutes) {
      const componentPath = routeMap.get(route);

      if (componentPath === changedFile) {
        return [
          this.createSignal(
            true,
            `Test visits ${route} which renders ${changedFile}`,
            { changedFile, testFile, route, componentPath }
          )
        ];
      }

      if (componentPath) {
        const depth = this.findTransitiveDependencies(componentPath, changedFile, registry);
        if (depth !== null) {
          return [
            this.createSignal(
              true,
              `Test visits ${route}, component ${componentPath} imports ${changedFile} (depth ${depth})`,
              { changedFile, testFile, route, componentPath, depth }
            )
          ];
        }
      }
    }

    return [
      this.createSignal(false, `Test routes do not relate to ${changedFile}`, {
        changedFile,
        testFile,
        visitedRoutes
      })
    ];
  }

  private findTransitiveDependencies(
    basePath: string,
    targetPath: string,
    registry: IRegistry,
    depth: number = 1,
    maxDepth: number = 3
  ): number | null {
    if (depth > maxDepth) return null;

    const deps = registry.getDependencies(basePath);
    if (deps.has(targetPath)) return depth;

    for (const dep of deps) {
      const result = this.findTransitiveDependencies(dep, targetPath, registry, depth + 1, maxDepth);
      if (result !== null) return result;
    }

    return null;
  }
}
