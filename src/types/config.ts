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
  /** Ceiling on the temporal signal weight. It corroborates — it must never
   * dominate a real anchor. Default 0.45. */
  maxWeight: number;
}

/** LLM provider id. New providers are added to this union + the factory. */
export type RerankProvider = 'openrouter';

/**
 * LLM rerank block. An LLM reads the change (diff + source header) and each
 * candidate spec, and judges whether the spec actually EXERCISES the changed
 * behaviour — the one thing static scorers and embeddings can't do (they see
 * topical similarity; this reads intent). Disabled by default.
 */
export interface IRerankConfig {
  enabled: boolean;
  /** Which LLM backend to call. Only the value drives the factory; the shape is
   * provider-agnostic so more backends slot in later. */
  provider: RerankProvider;
  /** Provider model slug, e.g. 'anthropic/claude-sonnet-4.5' or 'z-ai/glm-4.6'. */
  model: string;
  /** Name of the env var holding the API key (preferred — keeps the secret out
   * of the config file). Default 'OPENROUTER_API_KEY'. */
  apiKeyEnv: string;
  /** API key inline. Convenient but RISKY — anything in the config file can be
   * committed/shared/logged. Prefer apiKeyEnv. When set, this wins over the env
   * var. Keep this config out of version control. */
  apiKey?: string;
  /** Provider base URL (override for proxies/self-host). */
  baseUrl: string;
  /** Only candidates whose pelican score falls in [min, max) are sent to the
   * LLM. Below min: already dropped. At/above max: auto-kept (strong structural
   * match never second-guessed — saves cost AND protects recall). */
  candidateBand: { min: number; max: number };
  /** Never drop a candidate carrying a narrow structural anchor (direct-import/
   * filename/colocation), regardless of the LLM verdict. Bounds recall risk. */
  protectAnchors: boolean;
  /** LLM relevance (0..1) at or above which a judged candidate is kept. */
  keepThreshold: number;
  /** Hard cap on candidates sent to the LLM per changed file (cost ceiling). */
  maxCandidates: number;
  /** GLOBAL concurrent LLM requests across the whole run (all changed files
   * share this cap, so parallel files never multiply into rate-limit blowouts).
   * Set to what the model's rate limit tolerates. */
  concurrency: number;
  /** Per-request timeout (ms). On timeout/error the candidate is KEPT (fail-open
   * → recall-safe). */
  timeoutMs: number;
  /** Retries on a rate-limit (429) or transient 5xx, with exponential backoff
   * honouring any Retry-After header. After these are exhausted the call
   * fails open (candidate kept). Default 3. */
  maxRetries: number;
  /** When true, the prompt includes the WHOLE changed source file (then the
   * diff, then the test) — maximum context for the judge, at more tokens and
   * slower/costlier calls. When false, only the diff is sent. Default false. */
  highPrecision: boolean;
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
    // A filename token appearing in more than this share (0..1) of files is
    // "ambiguous" (corpus-ubiquitous, e.g. `device`/`list` in a device app). A
    // filename match resting ONLY on ambiguous tokens stops being a standalone
    // anchor — it needs a real co-signal (route/selector/import) to survive.
    // Distinctive-token matches (e.g. `provisioning`) still anchor. Default 0.1.
    filenameAmbiguityShare?: number;
  };
}
