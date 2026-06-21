import { ITemporalConfig } from '@/types/config';
import { IScoreResult } from '@/types/scorers';
import { EConfidenceLevel } from '@/utils/enums';

// ─── Theme Types ─────────────────────────────────────────────────

export interface IThemeColors {
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
  dim: string;
  muted: string;
}

export interface IThemeIcons {
  success: string;
  error: string;
  warning: string;
  info: string;
  arrow: string;
  bullet: string;
  circle: string;
  star: string;
  analyzing: string;
}

export interface ITheme {
  colors: IThemeColors;
  icons: IThemeIcons;
}

// ─── Analyze Command ─────────────────────────────────────────────

export type AnalyzePhase =
  | 'loading-config'
  | 'loading-registry'
  | 'building-registry'
  | 'detecting-changes'
  | 'checking-reranker'
  | 'analyzing'
  | 'scoring'
  | 'done'
  | 'error';

export interface IModelDownloadProgress {
  file: string;
  pct: number;
  loaded?: number;
  total?: number;
}

export interface IAnalyzeState {
  phase: AnalyzePhase;
  changedFiles: string[];
  results: IAnalyzeResult[];
  registryStats?: IRegistryStats;
  error?: string;
  /** Current file being processed (for progress display — sequential mode) */
  currentFile?: string;
  /** Files currently being scored in parallel */
  activeFiles?: string[];
  /** Files that have finished scoring */
  completedFiles?: string[];
  /** 0–100 progress percentage */
  progress: number;
  /** Maximum number of results to display */
  maxResults?: number;
  /** Set when Ollama reranker is unavailable — UI shows a warning, falls back to pelican-only + lock cache. */
  rerankerUnavailable?: boolean;
  rerankerError?: string;
  /** How many pairs the LLM has scored so far (for progress display). */
  rerankScored?: number;
  /** Total pairs queued for LLM scoring. */
  rerankTotal?: number;
  /** Per-file rerank progress. Needed because multiple files can rerank
   * concurrently (cross-file pLimit=2) and the global scored/total fields
   * would stomp on each other otherwise. */
  rerankProgress?: Record<string, { scored: number; total: number }>;
  /** Total wall-clock time in milliseconds (set when phase is 'done'). */
  elapsedMs?: number;
  /** When true, render the per-source-file breakdown; otherwise show dedup'd combined list. */
  expanded?: boolean;
}

export interface IAnalyzeResult {
  changedFile: string;
  suggestedTests: IScoreResult[];
  totalCandidates?: number;
  /** Number of candidates pelican scorers produced, before reranker filter. */
  preRerankCount?: number;
  /** Number of candidates after reranker filter. */
  postRerankCount?: number;
}

export interface IRegistryStats {
  totalFiles: number;
  sourceFiles: number;
  testFiles: number;
  dependencies: number;
  selectors: number;
  routes: number;
  duration: number; // ms
}

// ─── Registry Build Command ──────────────────────────────────────

export type RegistryBuildPhase =
  | 'scanning'
  | 'extracting-source'
  | 'extracting-tests'
  | 'building-indexes'
  | 'saving'
  | 'done'
  | 'error';

export interface IRegistryBuildState {
  phase: RegistryBuildPhase;
  totalFiles: number;
  processedFiles: number;
  currentFile?: string;
  stats?: IRegistryStats;
  error?: string;
}

// ─── Setup Command ───────────────────────────────────────────────

export type SetupPhase =
  | 'detecting'
  | 'confirming'
  | 'saving'
  | 'building-registry'
  | 'checking-ollama'
  | 'installing-ollama'
  | 'model-select'
  | 'pulling-model'
  | 'done'
  | 'error';

export interface ISetupStep {
  name: string;
  status: 'idle' | 'loading' | 'success' | 'error';
  detail?: string;
  /** Groups the step under a section header in SetupView. */
  section?: 'detected' | 'installed';
  /** Identity tag used by SetupView to attach the model-download progress bar. */
  kind?: 'model';
}

export interface ISetupState {
  phase: SetupPhase;
  steps: ISetupStep[];
  detectedConfig: IProjectConfig | null;
  error?: string;
  /** Populated while the reranker model is downloading. */
  modelProgress?: IModelDownloadProgress;
  /** Project root basename shown in the panel subtitle. */
  projectName?: string;
  /** Currently highlighted model index during model-select phase. */
  selectedModelIndex?: number;
  /** Measured internet speed in bytes/sec. Used to personalise download time estimates. */
  internetSpeedBps?: number;
  /** Models already present in the local Ollama store. */
  installedModels?: string[];
}

// ─── Config ──────────────────────────────────────────────────────

/**
 * Full project config — exactly what lives in .pelicanrc.json, organized into
 * three blocks: SOURCE (how app code is found & read), TEST (how specs are found
 * & read), and BEHAVIOUR (how pelican scores & decides what to return).
 */
export interface IProjectConfig {
  /** How pelican finds your application code and what it extracts from it. */
  source: {
    /** Absolute or relative path to the source repository root. REQUIRED.
     * Relative paths are resolved against cwd at load time. */
    root: string;
    /** Directories to scan for source files, relative to `root`. */
    dirs: string[];
    /** Extra directory names never scanned (in EITHER repo), on top of the
     * always-ignored set (node_modules, dist, build, .next, coverage, .git).
     * e.g. ["storybook-static", "cypress/videos"]. */
    ignoreDirs?: string[];
    /** Alias map for resolving source→source imports (e.g. `@dm/` → `src/dm/`). */
    pathAliases?: Record<string, string>;
    /** Attributes treated as selectors when extracting from source. */
    selectorAttributes: string[];
    /** Build the import graph. */
    imports: boolean;
    /** Extract React Router routes. `routerFile` "" = auto-detect. */
    routes: { enabled: boolean; routerFile?: string };
    /** Extract Redux slices/actions/selectors. */
    redux: { enabled: boolean; storeDirs: string[] };
    /** Extract i18n translation keys. */
    i18n: { enabled: boolean; library: string; localesPath: string };
  };
  /** How pelican finds your tests and what it extracts from them. */
  test: {
    /** Absolute or relative path to the test repository root. Optional —
     * defaults to `source.root` (single-repo). Relative paths resolved at load. */
    root?: string;
    /** Glob patterns that match your spec files, relative to `root`. */
    patterns: string[];
    /** Alias map for resolving spec→fixture/support imports (e.g. `@fixtures/`). */
    pathAliases?: Record<string, string>;
    /** Specs/suites pelican must never suggest (globs or basenames). */
    exclude: string[];
  };
  /** How pelican scores candidates and decides what to return. All scorers are
   * always on; tune only the thresholds and result cap here. */
  behaviour: {
    minConfidence: number;
    highConfidence: number;
    maxResults: number;
    /** Drop candidates with no file-identity anchor signal. Default true. */
    requireAnchor: boolean;
    /** Component-fanout dampener threshold. Default 0.7. */
    ubiquityThreshold: number;
    /** Share (0..1) above which a test selector is treated as ubiquitous and
     * disqualified as a match/anchor. Default 0.1. */
    ubiquitousSelectorThreshold: number;
    /** Strength of route-traffic damping on transitive route-match signals
     * (scaled by (1 - routeShare)^exponent). 0 disables. Default 1. */
    routeTrafficDampingExponent: number;
    /** Temporal-coherence scorer tunables (git creation/update timing).
     * Populated from defaults by the config loader; the scorer also falls back
     * to built-in defaults if absent. */
    temporal?: ITemporalConfig;
    /** Filename token doc-frequency share (0..1) above which a token is treated
     * as ambiguous/corpus-ubiquitous. A filename match on ambiguous tokens only
     * loses anchor status (needs a co-signal). Default 0.1. */
    filenameAmbiguityShare?: number;
  };
}

// ─── CLI Options ─────────────────────────────────────────────────

export interface IAnalyzeOptions {
  base?: string;
  target?: string;
  files?: string | string[];
  output: 'tui' | 'json' | 'list';
  minConfidence: string;
  maxResults: string;
  config?: string;
  ci?: boolean;
  debug?: boolean;
  /** Set to true by --rerank flag. Off by default — pelican structural scoring + .pelican.lock cache only. */
  rerank?: boolean;
  /** Set to false by --no-cache flag. Bypasses .pelican.lock for this run; nothing read or written. */
  cache?: boolean;
  /** Set by --all flag. Removes the result cap; every kept suggestion is shown. */
  all?: boolean;
  /** Set by --expanded flag. Shows the per-source-file breakdown instead of the dedup'd combined list. */
  expanded?: boolean;
  /** Set to false by --no-bi-encoder. Skips embedding cosine prefilter; pelican structural rank acts as the prefilter. */
  biEncoder?: boolean;
}

export interface IRegistryBuildOptions {
  force?: boolean;
  output: string;
  config?: string;
  debug?: boolean;
}

export interface ISetupOptions {
  auto?: boolean;
  config?: string;
  debug?: boolean;
}

// Re-export EConfidenceLevel for use within this module
export { EConfidenceLevel };
