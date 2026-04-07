import * as fs from 'fs/promises';
import * as path from 'path';

import { ISuggestorConfig } from '@v2/types/config';

export const DEFAULT_CONFIG: ISuggestorConfig = {
  sourceDirs: ['src'],
  testPatterns: ['**/*.cy.ts', '**/*.cy.tsx'],
  ignorePatterns: ['node_modules', 'dist', '.git'],
  analyzers: {
    enabled: [
      'source-extractor',
      'cypress-extractor',
      'redux-chain-analyzer',
      'i18n-analyzer',
      'route-analyzer',
      'import-graph-analyzer',
    ],
    sourceExtractor: { enabled: true, selectorStrategy: ['data-testid'] },
    cypressExtractor: { enabled: true },
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
    ],
    ubiquityThreshold: 0.7,
    minConfidence: 0.4,
    highConfidence: 0.8,
  },
};

/**
 * Loads the suggestor configuration from the project root.
 * Merges with defaults if the file is missing or incomplete.
 */
export async function loadConfig(projectRoot: string): Promise<ISuggestorConfig> {
  const configPath = path.join(projectRoot, '.suggestorrc.json');

  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const userConfig = JSON.parse(raw);
    return mergeConfig(DEFAULT_CONFIG, userConfig);
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Saves a configuration object to .suggestorrc.json.
 */
export async function saveConfig(projectRoot: string, config: ISuggestorConfig): Promise<void> {
  const configPath = path.join(projectRoot, '.suggestorrc.json');
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Deep merges two config objects.
 */
function mergeConfig(base: any, user: any): any {
  const result = { ...base };
  for (const key in user) {
    if (Object.prototype.hasOwnProperty.call(user, key)) {
      const baseValue = base[key];
      const userValue = user[key];

      if (
        typeof userValue === 'object' &&
        userValue !== null &&
        !Array.isArray(userValue) &&
        typeof baseValue === 'object' &&
        baseValue !== null
      ) {
        result[key] = mergeConfig(baseValue, userValue);
      } else {
        result[key] = userValue;
      }
    }
  }
  return result;
}
