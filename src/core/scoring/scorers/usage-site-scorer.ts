import { BaseScorer } from '@/core/scoring/scorers/base';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import { IScorerContext, ISignal } from '@/types';
import { EScorerType } from '@/utils/enums';

// Walk depth ceiling. TransitiveImportScorer already covers the depth-2
// test → intermediate → changed path; this scorer extends the reverse cone
// up to MAX_DEPTH so deeper usage chains still surface.
const MAX_DEPTH = 3;

// Mirror TransitiveImportScorer's high-fanout suppression: a util imported
// everywhere will have a dependent cone that touches every test, so any hit
// is meaningless.
const HIGH_FANOUT_IMPORTERS = 200;

// If the dependent cone itself grows past this many files we treat the
// changed file as utility-shaped: the scorer would otherwise match nearly
// every test through some path. The cone size also feeds the weight: smaller
// cones produce stronger signals.
const MAX_CONE_SIZE = 80;

export class UsageSiteScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.USAGE_SITE));
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const { testFile: testEntry, registry } = context;

    const directImporters = registry.getDependents(changedFile).size;
    if (directImporters > HIGH_FANOUT_IMPORTERS) {
      return [
        this.createSignal(false, `High-fanout source (${directImporters} importers) — usage cone is noise`),
      ];
    }

    // E2E specs often have zero imports (they hit the app via cy.visit),
    // so the reverse-dep cone would never fire for them. Fall back to the
    // components resolved from the spec's visited routes — those act as the
    // entry points the test exercises and can seed the same cone walk.
    let anchorFiles: string[] = testEntry.imports || [];
    if (anchorFiles.length === 0) {
      const routes = testEntry.cypress?.visitedRoutes ?? [];
      if (routes.length === 0) {
        return [this.createSignal(false, 'Test has no imports')];
      }
      const routeMap = registry.getRouteMap();
      const fromRoutes: string[] = [];
      for (const r of routes) {
        const comp = routeMap.get(r);
        if (comp) fromRoutes.push(comp);
      }
      if (fromRoutes.length === 0) {
        return [this.createSignal(false, 'Test has no imports; routes unresolved')];
      }
      anchorFiles = fromRoutes;
    }

    // BFS the dependent cone with depth tracking. The first hit on a test-imported
    // file wins (BFS guarantees shortest path).
    const depthByFile = new Map<string, number>();
    depthByFile.set(changedFile, 0);
    const queue: Array<[string, number]> = [[changedFile, 0]];
    let head = 0;
    while (head < queue.length && depthByFile.size <= MAX_CONE_SIZE) {
      const [file, depth] = queue[head++];
      if (depth >= MAX_DEPTH) continue;
      for (const dep of registry.getDependents(file)) {
        if (depthByFile.has(dep)) continue;
        depthByFile.set(dep, depth + 1);
        queue.push([dep, depth + 1]);
      }
    }

    if (depthByFile.size > MAX_CONE_SIZE) {
      return [
        this.createSignal(false, `Usage cone too large (>${MAX_CONE_SIZE} files) — match would be noise`),
      ];
    }

    let bestDepth = Infinity;
    let bestVia: string | null = null;
    for (const imp of anchorFiles) {
      const d = depthByFile.get(imp);
      if (d === undefined) continue;
      if (d === 0) {
        // Anchor is the changed file itself — treat as depth 1 so it still
        // fires. Happens when a spec visits a route that renders the
        // changed component directly.
        bestDepth = 1;
        bestVia = imp;
        break;
      }
      if (d < bestDepth) {
        bestDepth = d;
        bestVia = imp;
      }
    }

    if (bestVia === null) {
      return [this.createSignal(false, 'Test imports no file in usage cone')];
    }

    // Depth 1 (test imports a direct dependent) is the same hop pattern as
    // transitive-import, so emit a noticeably weaker signal there to avoid
    // double-counting. Depth 2/3 is genuinely new coverage.
    let factor = 1;
    if (bestDepth === 1) factor = 0.4;
    else if (bestDepth === 2) factor = 0.85;
    else if (bestDepth === 3) factor = 0.6;

    // Penalize broad cones: 5 dependents → trustworthy, 50 → diluted.
    const coneSize = depthByFile.size - 1;
    if (coneSize > 0) {
      factor *= Math.max(0.3, 1 - coneSize / MAX_CONE_SIZE);
    }

    const sig = this.createSignal(
      true,
      `Test imports ${bestVia} which uses ${changedFile} (depth ${bestDepth}, cone=${coneSize})`,
      { changedFile, testFile, via: bestVia, depth: bestDepth, coneSize },
    );
    sig.weight = this.weight * factor;
    return [sig];
  }
}
