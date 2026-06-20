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
  };
}
