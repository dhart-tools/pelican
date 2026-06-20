export interface ISuggestorConfig {
  scoring: {
    enabledScorers: string[];
    ubiquityThreshold: number; // default 0.7
    minConfidence: number; // default 0.4  — medium/low boundary
    highConfidence: number; // default 0.8  — high/medium boundary
    scorerWeights?: Record<string, number>; // per-scorer weight overrides
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
  };
}
