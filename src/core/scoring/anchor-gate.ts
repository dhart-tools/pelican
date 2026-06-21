import { ISignal } from '@/types';
import { EScorerType } from '@/utils/enums';

/**
 * Anchor gate — the primary precision lever.
 *
 * Empirically, true-positive specs are matched by **file-identity** signals
 * (the spec is named after, colocated with, or directly imports the changed
 * file). These stay narrow. False-positive floods ride on **domain-membership**
 * signals (shares a redux slice, a route table, a re-export barrel), which go
 * broad whenever the changeset touches a hub file.
 *
 * The gate keeps a candidate only if it carries at least one *anchor* signal;
 * otherwise every matched signal is suppressed and the candidate scores 0.
 * This mirrors the engine's existing describe-block co-signal gate, generalized.
 *
 * Two anchor tiers:
 *  - **Narrow anchors** — `direct-import`, `filename-match`, `colocation`.
 *    Always trustworthy: they point at *the* dedicated test. They anchor even
 *    when the changed file is a hub (e.g. a barrel's own `index.test.ts`).
 *  - **Medium anchors** — `route-match`, `selector-match`, `selector-id-match`,
 *    `transitive-import`. Trustworthy normally, but they go broad from a hub
 *    (every spec matches the Router's routes; every importer "imports" a
 *    barrel). So they anchor only when the changed file is **not** a hub.
 *
 * Everything else (`redux-chain`, `redux-consumer`, `action-type`,
 * `describe-block`, `usage-site`, `dependent-selector`) is a weak/domain signal
 * that can support a match but never stand alone.
 */

export const NARROW_ANCHOR_TYPES: ReadonlySet<string> = new Set<string>([
  EScorerType.DIRECT_IMPORT,
  EScorerType.FILENAME_MATCH,
  EScorerType.COLOCATION,
]);

export const MEDIUM_ANCHOR_TYPES: ReadonlySet<string> = new Set<string>([
  EScorerType.ROUTE_MATCH,
  EScorerType.SELECTOR_MATCH,
  EScorerType.SELECTOR_ID_MATCH,
  EScorerType.TRANSITIVE_IMPORT,
]);

export interface IAnchorGateOptions {
  /** True when the changed file is a hub (barrel/router). Demotes medium anchors. */
  changedIsHub: boolean;
  /** Override the narrow-anchor type set (advanced). */
  narrowAnchorTypes?: ReadonlySet<string>;
  /** Override the medium-anchor type set (advanced). */
  mediumAnchorTypes?: ReadonlySet<string>;
}

/** Does this matched signal qualify as an anchor under the given options? */
function isAnchorSignal(signal: ISignal, options: IAnchorGateOptions): boolean {
  if (!signal.matched) return false;
  // A scorer can opt a specific match out of anchoring (e.g. filename-match on
  // ambiguous, corpus-ubiquitous tokens) even when its type is normally narrow.
  if (signal.anchorEligible === false) return false;
  const narrow = options.narrowAnchorTypes ?? NARROW_ANCHOR_TYPES;
  const medium = options.mediumAnchorTypes ?? MEDIUM_ANCHOR_TYPES;
  if (narrow.has(signal.type)) return true;
  if (!options.changedIsHub && medium.has(signal.type)) return true;
  return false;
}

/**
 * Returns true if the signal set carries at least one qualifying anchor.
 */
export function hasAnchor(signals: readonly ISignal[], options: IAnchorGateOptions): boolean {
  return signals.some((s) => isAnchorSignal(s, options));
}

/**
 * Applies the anchor gate to a signal set. If no anchor is present, returns a
 * copy with every matched signal suppressed (so the candidate scores 0).
 * Otherwise returns the signals unchanged.
 *
 * Pure: never mutates its input.
 */
export function applyAnchorGate(signals: ISignal[], options: IAnchorGateOptions): ISignal[] {
  if (hasAnchor(signals, options)) return signals;

  return signals.map((s) =>
    s.matched
      ? {
          ...s,
          matched: false,
          reason: `${s.reason || 'Unknown'} — suppressed: no anchor signal (file-identity match required)`,
        }
      : s,
  );
}
