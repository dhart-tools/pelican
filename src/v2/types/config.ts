export interface ISuggestorConfig {
  /** Directories to scan for source files. Default: ['src'] */
  sourceDirs?: string[];
  /** Glob patterns to find test files. Default: ['**\/*.cy.ts', '**\/*.cy.tsx'] */
  testPatterns?: string[];
  /** Directories to ignore during scanning. Default: ['node_modules', 'dist', '.git'] */
  ignorePatterns?: string[];

  analyzers: {
    /** List of enabled analyzer names */
    enabled: string[];
    sourceExtractor: {
      enabled: boolean;
      /** List of attribute names to pick up as selectors (e.g., data-testid) */
      selectorStrategy: string[];
    };
    cypressExtractor: {
      enabled: boolean;
    };
    reduxChain: {
      enabled: boolean;
      /** Directories where Redux store/slices are defined */
      storeDirs: string[];
    };
    i18n: {
      enabled: boolean;
      /** e.g., 'react-i18next' */
      library: string;
      /** Path pattern to locales, e.g., 'public/locales/{locale}/translation.json' */
      localesPath: string;
    };
    routeAnalyzer: {
      enabled: boolean;
      /** Path to the main router file (e.g., App.tsx) */
      routerFile: string;
    };
    importGraph: {
      enabled: boolean;
    };
  };

  scoring: {
    /** List of enabled scorer names */
    enabledScorers: string[];
    /** Threshold for ubiquity dampener (0.0 - 1.0) */
    ubiquityThreshold: number;
    /** Minimum score for 'medium' confidence */
    minConfidence: number;
    /** Minimum score for 'high' confidence */
    highConfidence: number;
    /** Optional overrides for individual scorer weights */
    scorerWeights?: Record<string, number>;
  };
}
