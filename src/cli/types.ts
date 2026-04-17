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
  /** Total wall-clock time in milliseconds (set when phase is 'done'). */
  elapsedMs?: number;
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
 * Full project config — superset of what lives in .pelicanrc.json.
 * This is NOT the same as ISuggestorConfig from @/types/config
 * which only contains the `scoring` block.
 *
 * ISuggestorConfig is embedded within IProjectConfig.scoring.
 */
export interface IProjectConfig {
  sourceDirs: string[];
  testPatterns: string[];
  ignorePatterns: string[];
  analyzers: {
    enabled: string[];
    sourceExtractor: { enabled: boolean; selectorStrategy: string[] };
    cypressExtractor: {
      enabled: boolean;
      /**
       * Path alias mappings for resolving test imports (e.g. JSON fixture files).
       * Keys are the alias prefix, values are the directory they map to (relative to project root).
       * Example: { "@fixtures/": "cypress/fixtures/", "@support/": "cypress/support/" }
       */
      pathAliases?: Record<string, string>;
    };
    reduxChain: { enabled: boolean; storeDirs: string[] };
    i18n: { enabled: boolean; library: string; localesPath: string };
    routeAnalyzer: { enabled: boolean; routerFile: string };
    importGraph: { enabled: boolean };
  };
  scoring: {
    enabledScorers: string[];
    ubiquityThreshold: number;
    minConfidence: number;
    highConfidence: number;
    scorerWeights?: Record<string, number>;
    maxResults?: number;
  };
  rerank?: {
    /** Enable Ollama LLM reranking. Default true. */
    enabled: boolean;
    /** Ollama model to use. Default: qwen3.5:latest */
    ollamaModel: string;
    /** Ollama host. Default: http://localhost:11434 */
    ollamaHost: string;
    fileContent?: {
      /**
       * Number of equal-width regions to sample from the file. Default: 8.
       * Higher = more coverage, larger prompt.
       */
      segments?: number;
      /**
       * Lines captured per region. Default: 30.
       * Higher = more context per region, larger prompt.
       */
      linesPerWindow?: number;
      /**
       * JS/TS keyword tokens stripped from each line before sending to the LLM.
       * Reduces boilerplate noise while preserving identifiers and structure.
       * Set to [] to disable filtering entirely.
       * Defaults to a broad set of JS/TS syntactic and modifier keywords.
       */
      stripKeywords?: string[];
    };
    /**
     * Ask the LLM for a short explanation per test. Default: false.
     * When false, results show files only, reranker runs much faster since
     * decode shrinks from ~25 tokens to ~3 per call.
     */
    explanations?: boolean;
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
  /** Set to false by --no-rerank flag. Skips Ollama reranking; still uses .pelican.lock cache. */
  rerank?: boolean;
  /** Set to false by --no-cache flag. Bypasses .pelican.lock for this run; nothing read or written. */
  cache?: boolean;
  /** Set by --all flag. Removes the result cap; every kept suggestion is shown. */
  all?: boolean;
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
}

// Re-export EConfidenceLevel for use within this module
export { EConfidenceLevel };
