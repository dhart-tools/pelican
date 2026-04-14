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
  | 'analyzing'
  | 'scoring'
  | 'done'
  | 'error';

export interface IAnalyzeState {
  phase: AnalyzePhase;
  changedFiles: string[];
  results: IAnalyzeResult[];
  registryStats?: IRegistryStats;
  error?: string;
  /** Current file being processed (for progress display) */
  currentFile?: string;
  /** 0–100 progress percentage */
  progress: number;
}

export interface IAnalyzeResult {
  changedFile: string;
  suggestedTests: IScoreResult[];
  totalCandidates?: number;
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
  | 'done'
  | 'error';

export interface ISetupStep {
  name: string;
  status: 'idle' | 'loading' | 'success' | 'error';
  detail?: string;
}

export interface ISetupState {
  phase: SetupPhase;
  steps: ISetupStep[];
  detectedConfig: IProjectConfig | null;
  error?: string;
}

// ─── Config ──────────────────────────────────────────────────────

/**
 * Full project config — superset of what lives in .suggestorrc.json.
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
}

// ─── CLI Options ─────────────────────────────────────────────────

export interface IAnalyzeOptions {
  base?: string;
  target?: string;
  files?: string;
  output: 'tui' | 'json' | 'list';
  minConfidence: string;
  maxResults: string;
  config?: string;
  ci?: boolean;
  debug?: boolean;
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
