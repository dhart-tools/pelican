import * as fs from 'fs/promises';

import { ISuggestorConfig } from '@/types/config';

import { IProjectConfig } from './types';

const DEFAULT_CONFIG: IProjectConfig = {
  sourceDirs: ['src'],
  // Broad default — covers Cypress, Jest/Vitest, Playwright, Testing Library,
  // and generic e2e / integration layouts. Matches the `registry-builder`
  // fallback so empty-config and default-config behavior stay identical.
  testPatterns: [
    '**/*.cy.ts',
    '**/*.cy.tsx',
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.test.js',
    '**/*.test.jsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
    '**/*.spec.js',
    '**/*.spec.jsx',
    '**/*.e2e.ts',
    '**/*.e2e.tsx',
    '**/*.integration.ts',
    '**/*.integration.tsx',
    '**/*.int.ts',
    '**/*.int.tsx',
  ],
  ignorePatterns: ['node_modules', 'dist', '.git', 'coverage'],
  analyzers: {
    enabled: [
      'source-extractor',
      'cypress-extractor',
      'import-graph-analyzer',
      'route-analyzer',
      'i18n-analyzer',
    ],
    sourceExtractor: { enabled: true, selectorStrategy: ['data-testid', 'data-cy'] },
    cypressExtractor: {
      enabled: true,
      pathAliases: {
        '@fixtures/': 'cypress/fixtures/',
      },
    },
    reduxChain: { enabled: false, storeDirs: [] },
    i18n: { enabled: true, library: 'react-i18next', localesPath: '' },
    routeAnalyzer: { enabled: true, routerFile: '' },
    importGraph: { enabled: true },
  },
  scoring: {
    enabledScorers: [
      'direct-import',
      'selector-match',
      'selector-id-match',
      'route-match',
      'filename-match',
      'transitive-import',
      'api-intercept',
      'colocation',
      'describe-block',
      'translation-match',
      'dependent-selector',
    ],
    ubiquityThreshold: 0.7,
    minConfidence: 0.4,
    highConfidence: 0.8,
    maxResults: 10,
  },
};

/**
 * Loads config from .pelicanrc.json and merges with defaults.
 * CLI option overrides are applied by the command action, not here.
 *
 * @example
 *   const config = await loadProjectConfig();
 *   // config.scoring.minConfidence === 0.4 (from file or default)
 *
 *   const config = await loadProjectConfig('/path/to/custom.json');
 *   // config loaded from specified path
 */
export async function loadProjectConfig(configPath?: string): Promise<IProjectConfig> {
  const path = configPath || '.pelicanrc.json';

  try {
    const content = await fs.readFile(path, 'utf-8');
    const userConfig = JSON.parse(content);
    const merged = mergeConfig(DEFAULT_CONFIG, userConfig);
    validateScoringThresholds(merged);
    return merged;
  } catch (err) {
    if (err instanceof ConfigValidationError) throw err;
    return { ...DEFAULT_CONFIG };
  }
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Guard against the "inverted bands" mis-config where highConfidence is
 * set below minConfidence — a real user hit this and saw every result
 * collapse into the HIGH band (anything ≥ min was also ≥ high). Silent
 * misconfig here manifests as confusing tiering, not an obvious error.
 */
function validateScoringThresholds(config: IProjectConfig): void {
  const { minConfidence, highConfidence } = config.scoring;
  if (highConfidence < minConfidence) {
    throw new ConfigValidationError(
      `scoring.highConfidence (${highConfidence}) must be >= scoring.minConfidence (${minConfidence}). ` +
        `Results below minConfidence are filtered out; anything kept needs a band between [min, high) → Medium and [high, 1] → High.`,
    );
  }
}

/**
 * Extracts the ISuggestorConfig subset that the ScoringEngine expects.
 *
 * @example
 *   const projectConfig = await loadProjectConfig();
 *   const scoringConfig = toScoringConfig(projectConfig);
 *   const engine = new ScoringEngine(scoringConfig, registry);
 */
export function toScoringConfig(config: IProjectConfig): ISuggestorConfig {
  return {
    scoring: config.scoring,
  };
}

function mergeConfig(defaults: IProjectConfig, user: Partial<IProjectConfig>): IProjectConfig {
  return {
    sourceDirs: user.sourceDirs ?? defaults.sourceDirs,
    testPatterns: user.testPatterns ?? defaults.testPatterns,
    ignorePatterns: user.ignorePatterns ?? defaults.ignorePatterns,
    analyzers: {
      ...defaults.analyzers,
      ...user.analyzers,
      sourceExtractor: {
        ...defaults.analyzers.sourceExtractor,
        ...user.analyzers?.sourceExtractor,
      },
      cypressExtractor: {
        ...defaults.analyzers.cypressExtractor,
        ...user.analyzers?.cypressExtractor,
      },
      reduxChain: {
        ...defaults.analyzers.reduxChain,
        ...user.analyzers?.reduxChain,
      },
      i18n: {
        ...defaults.analyzers.i18n,
        ...user.analyzers?.i18n,
      },
      routeAnalyzer: {
        ...defaults.analyzers.routeAnalyzer,
        ...user.analyzers?.routeAnalyzer,
      },
      importGraph: {
        ...defaults.analyzers.importGraph,
        ...user.analyzers?.importGraph,
      },
    },
    scoring: {
      ...defaults.scoring,
      ...user.scoring,
    },
    rerank: user.rerank
      ? {
          ...user.rerank,
          fileContent: user.rerank.fileContent
            ? { ...user.rerank.fileContent }
            : undefined,
          explanations: user.rerank.explanations,
        }
      : undefined,
  };
}
