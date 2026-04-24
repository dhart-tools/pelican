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
      'action-type',
      'usage-site',
    ],
    ubiquityThreshold: 0.7,
    minConfidence: 0.4,
    highConfidence: 0.8,
    maxResults: 10,
  },
};

/**
 * Slim user-facing config shape — what users actually write in `.pelicanrc.json`.
 *
 * Everything is optional. The legacy verbose shape (`analyzers`, `scoring`)
 * is still accepted for back-compat; advanced overrides live in `advanced`.
 *
 * @example minimal config
 *   {
 *     "sourceDirs": ["src"],
 *     "pathAliases": { "@/": "src/" },
 *     "rerank": { "model": "qwen2.5-coder:7b" }
 *   }
 */
interface IUserConfig {
  sourceDirs?: string[];
  testPatterns?: string[];
  ignorePatterns?: string[];

  /** Glob patterns for files to exclude from BOTH source and test discovery. */
  excludePatterns?: string[];

  /** Path alias map for resolving imports. Replaces `analyzers.cypressExtractor.pathAliases`. */
  pathAliases?: Record<string, string>;

  /** Filter floor. Below this, results are dropped. Default 0.4. */
  minConfidence?: number;
  /** Band threshold. ≥ this is "high"; below is "medium". Default 0.8. */
  highConfidence?: number;
  /** Cap on results. Default 10. Set on CLI via `--all` to disable. */
  maxResults?: number;

  /** LLM rerank settings. Whole block optional; sane defaults applied. */
  rerank?: IUserRerankConfig;

  /**
   * Escape hatch for power users who need to tune scorer weights, disable
   * specific analyzers, or override structural internals. Most users should
   * never set this.
   */
  advanced?: {
    enabledScorers?: string[];
    scorerWeights?: Record<string, number>;
    ubiquityThreshold?: number;
    routerFile?: string;
    storeDirs?: string[];
    selectorStrategy?: string[];
  };

  // ── Back-compat: legacy verbose shape still accepted ─────────────
  analyzers?: IProjectConfig['analyzers'];
  scoring?: Partial<IProjectConfig['scoring']>;
}

interface IUserRerankConfig {
  /** Run the LLM reranker. Default true. */
  enabled?: boolean;
  /** Ollama model. Default qwen2.5-coder:7b. */
  model?: string;
  /** Ollama host. Default http://localhost:11434. */
  host?: string;
  /** Embedding-based prefilter (drops candidates by cosine before LLM). Default true. */
  biEncoder?: boolean;
  /** Embedding model when biEncoder is on. Default mxbai-embed-large. */
  biEncoderModel?: string;
  /** Cap candidates that survive the bi-encoder. Default 30. */
  biEncoderTopK?: number;
  /** Prompt template. Default 'v2'. */
  promptVersion?: 'v1' | 'v2';
  /** Late-fusion weight on pelican prior in v2. Default 0.4. */
  pelicanWeight?: number;
  /** Ask LLM for explanations per candidate. Default false. */
  explanations?: boolean;

  // ── Legacy field names still accepted ─────────────────────────────
  ollamaModel?: string;
  ollamaHost?: string;
  biEncoderPrefilter?: boolean;
  fileContent?: IProjectConfig['rerank'] extends { fileContent?: infer T } ? T : never;
}

/**
 * Loads config from .pelicanrc.json and merges with defaults.
 * Accepts either the slim user-facing shape or the legacy verbose shape.
 *
 * @example
 *   const config = await loadProjectConfig();
 *   // config.scoring.minConfidence === 0.4 (from file or default)
 */
export async function loadProjectConfig(configPath?: string): Promise<IProjectConfig> {
  const path = configPath || '.pelicanrc.json';

  try {
    const content = await fs.readFile(path, 'utf-8');
    const userConfig: IUserConfig = JSON.parse(content);
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
 * collapse into the HIGH band (anything ≥ min was also ≥ high).
 */
function validateScoringThresholds(config: IProjectConfig): void {
  const { minConfidence, highConfidence } = config.scoring;
  if (highConfidence < minConfidence) {
    throw new ConfigValidationError(
      `highConfidence (${highConfidence}) must be >= minConfidence (${minConfidence}). ` +
        `Results below minConfidence are filtered out; anything kept needs a band between [min, high) → Medium and [high, 1] → High.`,
    );
  }
}

/**
 * Extracts the ISuggestorConfig subset that the ScoringEngine expects.
 */
export function toScoringConfig(config: IProjectConfig): ISuggestorConfig {
  return {
    scoring: config.scoring,
  };
}

function mergeConfig(defaults: IProjectConfig, user: IUserConfig): IProjectConfig {
  // Top-level path aliases beat the legacy nested location.
  const pathAliases =
    user.pathAliases ??
    user.analyzers?.cypressExtractor?.pathAliases ??
    defaults.analyzers.cypressExtractor.pathAliases;

  return {
    sourceDirs: user.sourceDirs ?? defaults.sourceDirs,
    testPatterns: user.testPatterns ?? defaults.testPatterns,
    ignorePatterns: user.ignorePatterns ?? defaults.ignorePatterns,
    excludePatterns: user.excludePatterns ?? defaults.excludePatterns,
    analyzers: {
      ...defaults.analyzers,
      ...user.analyzers,
      sourceExtractor: {
        ...defaults.analyzers.sourceExtractor,
        ...user.analyzers?.sourceExtractor,
        ...(user.advanced?.selectorStrategy && {
          selectorStrategy: user.advanced.selectorStrategy,
        }),
      },
      cypressExtractor: {
        ...defaults.analyzers.cypressExtractor,
        ...user.analyzers?.cypressExtractor,
        pathAliases,
      },
      reduxChain: {
        ...defaults.analyzers.reduxChain,
        ...user.analyzers?.reduxChain,
        ...(user.advanced?.storeDirs && { storeDirs: user.advanced.storeDirs }),
      },
      i18n: {
        ...defaults.analyzers.i18n,
        ...user.analyzers?.i18n,
      },
      routeAnalyzer: {
        ...defaults.analyzers.routeAnalyzer,
        ...user.analyzers?.routeAnalyzer,
        ...(user.advanced?.routerFile && { routerFile: user.advanced.routerFile }),
      },
      importGraph: {
        ...defaults.analyzers.importGraph,
        ...user.analyzers?.importGraph,
      },
    },
    scoring: {
      ...defaults.scoring,
      ...user.scoring,
      ...(user.advanced?.enabledScorers && { enabledScorers: user.advanced.enabledScorers }),
      ...(user.advanced?.scorerWeights && { scorerWeights: user.advanced.scorerWeights }),
      ...(user.advanced?.ubiquityThreshold !== undefined && {
        ubiquityThreshold: user.advanced.ubiquityThreshold,
      }),
      ...(user.minConfidence !== undefined && { minConfidence: user.minConfidence }),
      ...(user.highConfidence !== undefined && { highConfidence: user.highConfidence }),
      ...(user.maxResults !== undefined && { maxResults: user.maxResults }),
    },
    rerank: normalizeRerankConfig(user.rerank),
  };
}

/**
 * Map the slim user-facing rerank shape (and legacy field names) onto the
 * internal `IProjectConfig['rerank']` shape consumed by SemanticReranker.
 */
function normalizeRerankConfig(user: IUserRerankConfig | undefined): IProjectConfig['rerank'] {
  if (!user) return undefined;
  return {
    enabled: user.enabled ?? true,
    ollamaModel: user.model ?? user.ollamaModel ?? 'qwen2.5-coder:7b',
    ollamaHost: user.host ?? user.ollamaHost ?? 'http://localhost:11434',
    biEncoder: user.biEncoder ?? user.biEncoderPrefilter,
    biEncoderModel: user.biEncoderModel,
    biEncoderTopK: user.biEncoderTopK,
    promptVersion: user.promptVersion,
    pelicanWeight: user.pelicanWeight,
    explanations: user.explanations,
    fileContent: user.fileContent,
  };
}
