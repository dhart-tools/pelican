import { IFileEntry } from '@/types';

/**
 * Hub-file detection.
 *
 * A "hub" is a source file with app-wide fan-out whose signals, if treated as
 * trustworthy anchors, light up against most of the test suite:
 *
 *  - **Barrel** — an `index.ts` that mostly re-exports a directory. A spec that
 *    imports the barrel structurally "imports" everything behind it, so
 *    import-based matching from a barrel goes broad.
 *  - **Router** — the file that owns the route table. Every spec that visits a
 *    page matches its routes, so route-based matching from the router goes broad.
 *
 * Detection is intentionally *structural and measurable* (re-export breadth,
 * route-table size) rather than path-based. Empirically, path heuristics like
 * "anything under `sagas/`" misfire — a niche feature saga is scoped, while a
 * top-level slice saga is app-wide, and the two are indistinguishable by path.
 * Those broad redux/text matches are instead handled by the anchor gate, which
 * drops weak-signal-only candidates regardless of hub status.
 *
 * When a file is a hub, the scoring engine demotes its signals so they cannot
 * act as anchors (see `anchor-gate.ts`), collapsing the hub-file flood while
 * leaving a hub's own dedicated unit test (matched by filename/colocation,
 * which stay anchors) untouched.
 */

export enum EHubRole {
  BARREL = 'barrel',
  ROUTER = 'router',
}

/** Tunable thresholds for hub detection. Overridable via scoring config. */
export interface IHubFileThresholds {
  /**
   * Minimum number of exports for an `index.*` file to count as a re-export
   * barrel. Leaf barrels (a component folder's `index.ts` re-exporting one
   * component) sit well below this; top-level barrels (`dm/components/index.ts`,
   * `dm/containers/index.ts`) sit well above. Default 8.
   */
  barrelMinExports: number;
  /**
   * Minimum number of routes defined for a file to count as a router hub,
   * when its name doesn't already match a router filename. Default 5.
   */
  routerMinRoutes: number;
}

export const DEFAULT_HUB_THRESHOLDS: IHubFileThresholds = {
  barrelMinExports: 8,
  routerMinRoutes: 5,
};

const INDEX_FILE = /^index\.(t|j)sx?$/i;
const ROUTER_FILE = /^router\.(t|j)sx?$/i;

/**
 * Returns the hub role of a source file, or `undefined` if it is not a hub.
 * Tests aren't hubs. Returning the role (not a boolean) lets callers log *why*.
 */
export function getHubRole(
  entry: IFileEntry,
  thresholds: IHubFileThresholds = DEFAULT_HUB_THRESHOLDS,
): EHubRole | undefined {
  if (entry.type !== 'source') return undefined;

  const name = entry.name ?? '';

  // Router: by filename, or by owning a large route table.
  if (ROUTER_FILE.test(name)) return EHubRole.ROUTER;
  if ((entry.routesDefined?.length ?? 0) >= thresholds.routerMinRoutes) return EHubRole.ROUTER;

  // Barrel: an index file that re-exports a directory's worth of modules.
  // Require both many exports and many imports so a hand-written index with
  // real logic (few imports) isn't misclassified as a pass-through barrel.
  if (INDEX_FILE.test(name)) {
    const exportCount = entry.exports?.length ?? 0;
    const importCount = entry.imports?.length ?? 0;
    if (exportCount >= thresholds.barrelMinExports && importCount >= thresholds.barrelMinExports) {
      return EHubRole.BARREL;
    }
  }

  return undefined;
}

/** Convenience boolean wrapper around {@link getHubRole}. */
export function isHubFile(
  entry: IFileEntry,
  thresholds: IHubFileThresholds = DEFAULT_HUB_THRESHOLDS,
): boolean {
  return getHubRole(entry, thresholds) !== undefined;
}
