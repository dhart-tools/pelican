import * as fs from 'fs/promises';

import { ISuggestorConfig } from '@/types/config';

import { IProjectConfig } from './types';

const DEFAULT_CONFIG: IProjectConfig = {
  sourceDirs: ['src'],
  testPatterns: ['**/*.cy.ts', '**/*.cy.tsx'],
  ignorePatterns: ['node_modules', 'dist', '.git', 'coverage'],
  analyzers: {
    enabled: ['source-extractor', 'cypress-extractor', 'import-graph-analyzer'],
    sourceExtractor: { enabled: true, selectorStrategy: ['data-testid', 'data-cy'] },
    cypressExtractor: {
      enabled: true,
      pathAliases: {
        '@fixtures/': 'cypress/fixtures/',
      },
    },
    reduxChain: { enabled: false, storeDirs: [] },
    i18n: { enabled: false, library: 'react-i18next', localesPath: '' },
    routeAnalyzer: { enabled: false, routerFile: '' },
    importGraph: { enabled: true },
  },
  scoring: {
    enabledScorers: [
      'direct-import',
      'selector-match',
      'route-match',
      'filename-match',
      'transitive-import',
      'colocation',
      'describe-block',
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
    return mergeConfig(DEFAULT_CONFIG, userConfig);
  } catch {
    return { ...DEFAULT_CONFIG };
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
  };
}
