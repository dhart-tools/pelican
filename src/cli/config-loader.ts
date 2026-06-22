import * as fs from 'fs/promises';
import * as path from 'path';

import { ISuggestorConfig, ITemporalConfig } from '@/types/config';

import { IProjectConfig } from './types';

/** Universal directories never scanned (not user-configurable). */
const UNIVERSAL_IGNORES = ['node_modules', 'dist', 'build', '.next', 'coverage', '.git'];

const DEFAULT_CONFIG: IProjectConfig = {
  source: {
    // Placeholder — source.root is required from user config; validateConfig
    // rejects an empty root with a clear message.
    root: '',
    dirs: ['src'],
    ignoreDirs: [],
    pathAliases: {},
    selectorAttributes: ['data-testid', 'data-cy'],
    imports: true,
    routes: { enabled: true, routerFile: '' },
    redux: { enabled: false, storeDirs: [] },
    i18n: { enabled: true, library: 'react-i18next', localesPath: '' },
  },
  test: {
    // Broad default — covers Cypress, Jest/Vitest, Playwright, Testing Library,
    // and generic e2e / integration layouts.
    patterns: [
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
    pathAliases: { '@fixtures/': 'cypress/fixtures/' },
    exclude: [],
  },
  behaviour: {
    minConfidence: 0.4,
    highConfidence: 0.8,
    maxResults: 10,
    requireAnchor: true,
    ubiquityThreshold: 0.7,
    ubiquitousSelectorThreshold: 0.1,
    routeTrafficDampingExponent: 1,
    filenameAmbiguityShare: 0.1,
    temporal: {
      creationWindowSoftDays: 14,
      creationWindowHardDays: 28,
      updateWindowDays: 14,
      maxCommitFiles: 30,
      maxWeight: 0.45,
    },
  },
  rerank: {
    enabled: false,
    provider: 'openrouter',
    // Validated on the hard cases (case 05 + 10) at 8/8; a small MoE that's
    // cheap/fast yet reasons about behaviour well enough to separate
    // exercises-the-change from mentions-the-domain. Override per project.
    model: 'nvidia/nemotron-nano-3-30b-a3b',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    candidateBand: { min: 0.4, max: 0.9 },
    protectAnchors: true,
    keepThreshold: 0.5,
    maxCandidates: 40,
    concurrency: 4,
    timeoutMs: 30000,
    maxRetries: 3,
  },
};

/**
 * User-facing config — what users write in `.pelicanrc.json`. Same three-block
 * shape as IProjectConfig, but every field (and every block) is optional and
 * deep-merged onto the defaults.
 *
 * @example minimal config
 *   {
 *     "source": { "dirs": ["src"], "pathAliases": { "@/": "src/" } },
 *     "test": { "patterns": ["**\/*.cy.ts"] },
 *     "behaviour": { "maxResults": 10 }
 *   }
 */
interface IUserConfig {
  source?: DeepPartial<IProjectConfig['source']>;
  test?: DeepPartial<IProjectConfig['test']>;
  behaviour?: DeepPartial<IProjectConfig['behaviour']>;
  rerank?: DeepPartial<IProjectConfig['rerank']>;
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<unknown> ? T[K] : T[K] extends object ? Partial<T[K]> : T[K];
};

/**
 * Loads config from .pelicanrc.json and merges with defaults.
 * Accepts either the slim user-facing shape or the legacy verbose shape.
 *
 * @example
 *   const config = await loadProjectConfig();
 *   // config.scoring.minConfidence === 0.4 (from file or default)
 */
export async function loadProjectConfig(configPath?: string): Promise<IProjectConfig> {
  const cfgPath = configPath || '.pelicanrc.json';

  let raw: string | undefined;
  try {
    raw = await fs.readFile(cfgPath, 'utf-8');
  } catch {
    raw = undefined; // no config file — validateConfig surfaces the missing source.root
  }

  let userConfig: IUserConfig = {};
  if (raw !== undefined) {
    try {
      userConfig = JSON.parse(raw);
    } catch {
      throw new ConfigValidationError(`config at ${cfgPath} is not valid JSON`);
    }
  }

  const merged = mergeConfig(DEFAULT_CONFIG, userConfig);
  validateConfig(merged);
  resolveRoots(merged);
  return merged;
}

/**
 * Resolves source.root (and test.root, defaulting to source.root) to absolute
 * paths. Mutates in place — both roots are absolute after this runs.
 */
function resolveRoots(config: IProjectConfig): void {
  config.source.root = path.resolve(config.source.root);
  config.test.root = config.test.root ? path.resolve(config.test.root) : config.source.root;
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validates the config: source.root is required, and the confidence bands must
 * not be inverted (a real user once set highConfidence below minConfidence and
 * saw every result collapse into the HIGH band).
 */
function validateConfig(config: IProjectConfig): void {
  if (!config.source.root || config.source.root.trim() === '') {
    throw new ConfigValidationError(
      'config invalid: source.root is required (the path to your source repository). ' +
        'Set it in .pelicanrc.json under "source": { "root": "..." }.',
    );
  }
  const { minConfidence, highConfidence } = config.behaviour;
  if (highConfidence < minConfidence) {
    throw new ConfigValidationError(
      `highConfidence (${highConfidence}) must be >= minConfidence (${minConfidence}). ` +
        `Results below minConfidence are filtered out; anything kept needs a band between [min, high) → Medium and [high, 1] → High.`,
    );
  }
}

/**
 * The effective list of directory names to skip while scanning: the always-on
 * UNIVERSAL_IGNORES plus any extra `source.ignoreDirs` from config (deduped).
 * Single source of truth — every registry-builder caller passes this so both
 * repos honour the same ignore set (and `.git` is actually ignored).
 */
export function getIgnoreDirs(config: IProjectConfig): string[] {
  return [...new Set([...UNIVERSAL_IGNORES, ...(config.source.ignoreDirs ?? [])])];
}

/**
 * Merged source + test path aliases as ABSOLUTE targets — source aliases
 * resolved against source.root, test aliases against test.root. This lets the
 * builder resolve a cross-repo import (a spec's `@dm/...` → the source repo)
 * without knowing which root each alias belongs to. Call after roots are
 * resolved (i.e. on a config from loadProjectConfig).
 */
export function getMergedAliases(config: IProjectConfig): Record<string, string> {
  const testRoot = config.test.root ?? config.source.root;
  const out: Record<string, string> = {};
  for (const [prefix, target] of Object.entries(config.source.pathAliases ?? {})) {
    out[prefix] = path.isAbsolute(target) ? target : path.resolve(config.source.root, target);
  }
  for (const [prefix, target] of Object.entries(config.test.pathAliases ?? {})) {
    out[prefix] = path.isAbsolute(target) ? target : path.resolve(testRoot, target);
  }
  return out;
}

/**
 * Extracts the ISuggestorConfig subset (the `behaviour` thresholds) that the
 * ScoringEngine expects under a `scoring` key.
 */
export function toScoringConfig(config: IProjectConfig): ISuggestorConfig {
  return {
    scoring: {
      minConfidence: config.behaviour.minConfidence,
      highConfidence: config.behaviour.highConfidence,
      ubiquityThreshold: config.behaviour.ubiquityThreshold,
      requireAnchor: config.behaviour.requireAnchor,
      ubiquitousSelectorThreshold: config.behaviour.ubiquitousSelectorThreshold,
      routeTrafficDampingExponent: config.behaviour.routeTrafficDampingExponent,
      temporal: config.behaviour.temporal,
      filenameAmbiguityShare: config.behaviour.filenameAmbiguityShare,
    },
  };
}

function mergeConfig(defaults: IProjectConfig, user: IUserConfig): IProjectConfig {
  return {
    source: {
      ...defaults.source,
      ...user.source,
      routes: { ...defaults.source.routes, ...user.source?.routes },
      redux: { ...defaults.source.redux, ...user.source?.redux },
      i18n: { ...defaults.source.i18n, ...user.source?.i18n },
    },
    test: {
      ...defaults.test,
      ...user.test,
    },
    behaviour: {
      ...defaults.behaviour,
      ...user.behaviour,
      // Deep-merge temporal so a user can override one knob without dropping
      // the rest of the defaults. DEFAULT_CONFIG always supplies a full block,
      // so the spread is complete at runtime.
      temporal: {
        ...defaults.behaviour.temporal,
        ...user.behaviour?.temporal,
      } as ITemporalConfig,
    },
    rerank: {
      ...defaults.rerank,
      ...user.rerank,
      // candidateBand is nested — deep-merge so overriding one bound keeps the
      // other from the defaults.
      candidateBand: {
        ...defaults.rerank!.candidateBand,
        ...user.rerank?.candidateBand,
      },
    } as IProjectConfig['rerank'],
  };
}
