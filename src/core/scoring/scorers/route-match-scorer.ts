import { BaseScorer } from '@/core/scoring/scorers/base';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import { IScorerContext, ISignal, IRegistry } from '@/types';
import { EScorerType } from '@/utils/enums';

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

    for (const visited of visitedRoutes) {
      // Normalize visited URL: strip query string and leading hash-router prefix.
      const normalizedVisited = visited.replace(/\?.*$/, '').replace(/^\/?#/, '');

      const resolved = this.resolveComponentForRoute(normalizedVisited, routeMap);
      if (!resolved) continue;
      const { componentPath, specificity } = resolved;

      if (componentPath === changedFile) {
        const sig = this.createSignal(true, `Test visits ${visited} which renders ${changedFile}`, {
          changedFile,
          testFile,
          route: visited,
          componentPath,
          specificity,
        });
        // Exact/specific routes keep full weight; wildcard-only matches fall off.
        sig.weight = this.weight * (0.5 + 0.5 * specificity);
        return [sig];
      }

      const depth = this.findTransitiveDependencies(componentPath, changedFile, registry);
      if (depth !== null) {
        const sig = this.createSignal(
          true,
          `Test visits ${visited}, component ${componentPath} imports ${changedFile} (depth ${depth})`,
          { changedFile, testFile, route: visited, componentPath, depth, specificity },
        );
        // Penalize both low specificity AND transitive depth. A `/*` wildcard
        // 3 hops deep shouldn't beat a direct colocated test.
        const depthFactor = 1 / (depth + 1);
        sig.weight = this.weight * (0.3 + 0.7 * specificity) * depthFactor;
        return [sig];
      }
    }

    return [
      this.createSignal(false, `Test routes do not relate to ${changedFile}`, {
        changedFile,
        testFile,
        visitedRoutes,
      }),
    ];
  }

  /**
   * Matches a visited concrete URL against the route map, first via exact
   * lookup, then via dynamic route patterns (`:param`, wildcard `*`).
   *
   *   visited: "/user/123"
   *   routeMap keys: ["/user/:id", "/dashboard"]
   *   → returns componentPath registered under "/user/:id"
   */
  private resolveComponentForRoute(
    visited: string,
    routeMap: Map<string, string>,
  ): { componentPath: string; specificity: number } | undefined {
    const direct = routeMap.get(visited);
    if (direct) return { componentPath: direct, specificity: 1 };

    // Prefer the most-specific pattern match. Specificity = literal segments / total.
    // This kills the "wildcard `/*` catches everything → every spec gets 0.85"
    // false-positive seen in real React Router apps.
    let best: { componentPath: string; specificity: number } | undefined;
    for (const [pattern, componentPath] of routeMap) {
      if (!pattern.includes(':') && !pattern.includes('*')) continue;
      const regex = this.patternToRegex(pattern);
      if (!regex.test(visited)) continue;
      const specificity = this.routeSpecificity(pattern);
      if (!best || specificity > best.specificity) {
        best = { componentPath, specificity };
      }
    }
    if (best) return best;

    // Nested-route fallback: React Router parents like `/:team/integrations`
    // render regardless of child URL. A test visiting
    // `/:team/integrations/incoming_webhooks/add` navigates INTO the parent's
    // tree, so the parent still renders. Without this we miss every spec that
    // lives deeper than the registered route.
    //
    // We match as a path-prefix (segment boundary) and scale specificity down
    // to avoid this stealing specific-route matches. All parents (including
    // non-dynamic like `/admin_console`) participate.
    for (const [pattern, componentPath] of routeMap) {
      const regex = this.patternToPrefixRegex(pattern);
      if (!regex.test(visited)) continue;
      const base = this.routeSpecificity(pattern);
      const specificity = base * 0.5;
      if (!best || specificity > best.specificity) {
        best = { componentPath, specificity };
      }
    }
    return best;
  }

  private patternToPrefixRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const body = escaped
      .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '[^/]+')
      .replace(/\*/g, '.*');
    // Require a segment boundary after the pattern so `/:team/integrations`
    // doesn't match `/:team/integrations_foo`.
    return new RegExp(`^${body}/.+$`);
  }

  private routeSpecificity(pattern: string): number {
    const segs = pattern.split('/').filter(Boolean);
    if (segs.length === 0) return 0;
    let literal = 0;
    for (const s of segs) {
      if (s === '*' || s === '**') continue;
      if (s.startsWith(':')) continue;
      literal += 1;
    }
    return literal / segs.length;
  }

  private patternToRegex(pattern: string): RegExp {
    // Escape regex metachars, then swap `:param` and `*` back in.
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const body = escaped
      .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '[^/]+')
      .replace(/\*/g, '.*');
    return new RegExp(`^${body}/?$`);
  }

  private findTransitiveDependencies(
    basePath: string,
    targetPath: string,
    registry: IRegistry,
    depth: number = 1,
    maxDepth: number = 3,
  ): number | null {
    if (depth > maxDepth) return null;

    const deps = registry.getDependencies(basePath);
    if (deps.has(targetPath)) return depth;

    for (const dep of deps) {
      const result = this.findTransitiveDependencies(
        dep,
        targetPath,
        registry,
        depth + 1,
        maxDepth,
      );
      if (result !== null) return result;
    }

    return null;
  }
}
