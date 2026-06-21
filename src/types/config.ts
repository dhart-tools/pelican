/**
 * Tunables for the temporal-coherence scorer. All knobs live here so behaviour
 * is data-driven, not hardcoded in the scorer.
 */
export interface ITemporalConfig {
  /** Creation gap (days) within which two files are treated as fully co-created.
   * Full creation weight inside this window. Default 14. */
  creationWindowSoftDays: number;
  /** Creation gap (days) at which the creation signal decays to zero on the
   * "test created after source" side; the "before" side is tightened to half.
   * Default 28. */
  creationWindowHardDays: number;
  /** Bucket size (days) for update-coupling: commits landing in the same bucket
   * count as a co-update. Default 14. */
  updateWindowDays: number;
  /** Commits touching more than this many files are treated as bulk/refactor
   * passes (migrations, mass formatting) and excluded from update-coupling —
   * they aren't logical co-changes and otherwise drown real coupling. Creation
   * and update timestamps still use all commits. Default 30. */
  maxCommitFiles: number;
  /** Ceiling on the temporal signal weight. Default 0.45 (corroborator). Raise
   * toward 1 to let temporal dominate (see frontSeat). */
  maxWeight: number;
  /** EXPERIMENT — give temporal the front seat. When true, temporal becomes an
   * anchor (co-change coupling alone can select a candidate) and every
   * non-temporal matched signal is scaled down by `othersWeight`, so the score
   * is driven by temporal. Trades recall for a pure co-change view. Default
   * false. */
  frontSeat?: boolean;
  /** Multiplier applied to non-temporal matched weights when frontSeat is on.
   * Default 0.15. */
  othersWeight?: number;
}

export interface ISuggestorConfig {
  scoring: {
    ubiquityThreshold: number; // default 0.7
    minConfidence: number; // default 0.4  — medium/low boundary
    highConfidence: number; // default 0.8  — high/medium boundary
    requireAnchor?: boolean; // default true — drop candidates with no file-identity anchor signal
    // Share (0..1) above which a test selector is treated as ubiquitous UI
    // infrastructure and disqualified as a match/anchor. Default 0.1.
    ubiquitousSelectorThreshold?: number;
    // Strength of route-traffic damping on TRANSITIVE route-match signals: a
    // transitive match through a route visited by share `s` of all specs is
    // scaled by (1 - s)^exponent. 0 disables; 1 = linear; higher = harsher.
    // Direct route matches (the route's page IS the changed file) are never
    // damped. Default 1.
    routeTrafficDampingExponent?: number;
    // Temporal-coherence scorer tunables (git creation/update timing).
    temporal?: ITemporalConfig;
  };
}
