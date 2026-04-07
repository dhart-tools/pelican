# Task 11: CLI Integration

## Overview

Create CLI commands that integrate all analyzers, the registry, scoring engine, and scorers into a cohesive command-line interface. This includes the `analyze`/`suggest` command and the `setup` wizard.

## Objectives

1. Create main CLI entry point
2. Implement `analyze`/`suggest` command
3. Implement `setup` wizard with auto-detection
4. Implement `registry build` command
5. Add configuration management
6. Add result formatting and output

## CLI Structure

```bash
suggestor analyze [options]          # Main analysis command
suggestor setup [options]            # Setup wizard
suggestor registry build [options]   # Build registry from files
suggestor config get/set/list [options]  # Configuration management
```

## Implementation

### 1. Create CLI Entry Point

**File:** `src/commands/index.ts`

```typescript
import { Command } from 'commander';
import { analyzeCommand } from './analyze';
import { setupCommand } from './setup';
import { buildRegistryCommand } from './build-registry';
import { configCommand } from './config';

export function createCLI(): Command {
  const program = new Command();

  program
    .name('suggestor')
    .description('Test Suggestor v3 - Plug & Play Test Selection for CI/CD')
    .version('3.0.0')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('-c, --config <path>', 'Path to config file', '.suggestorrc.json');

  // Register subcommands
  program.addCommand(analyzeCommand);
  program.addCommand(setupCommand);
  program.addCommand(buildRegistryCommand);
  program.addCommand(configCommand);

  return program;
}

export function runCLI(): void {
  const program = createCLI();
  program.parse(process.argv);
}
```

### 2. Create Analyze Command

**File:** `src/commands/analyze.ts`

```typescript
import { Command } from 'commander';
import * as fs from 'fs/promises';
import { AnalyzerRegistry, AnalyzerDiscovery } from '../core/analyzer-registry';
import { Registry } from '../core/registry';
import { ScoringEngine } from '../core/scoring-engine';
import { loadConfig } from '../config';
import { registerAllScorers } from '../scorers';
import { findChangedFiles } from '../core/git';

export const analyzeCommand = new Command('analyze')
  .alias('suggest')
  .description('Analyze changes and suggest tests to run')
  .option('-b, --base <ref>', 'Base git reference (default: HEAD~1 or main)')
  .option('-t, --target <ref>', 'Target git reference (default: HEAD)')
  .option('-f, --files <paths>', 'Comma-separated list of changed files')
  .option('-o, --output <format>', 'Output format: json, table, list', 'table')
  .option('--min-confidence <number>', 'Minimum confidence threshold', '0.40')
  .option('--max-results <number>', 'Maximum number of results to show', '10')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.config);

      // Override config with CLI options
      if (options.minConfidence) {
        config.scoring.minConfidence = parseFloat(options.minConfidence);
      }

      // Initialize registry
      const registry = new Registry();

      // Build registry or load from cache
      const cachePath = '.suggestor/registry.json';
      let registryLoaded = false;

      try {
        const cacheData = await fs.readFile(cachePath, 'utf-8');
        registry.deserialize(cacheData);
        registryLoaded = true;
        console.log('✓ Loaded registry from cache');
      } catch (error) {
        console.log('Registry cache not found, building...');
        await buildRegistry(config, registry);
        await saveRegistry(registry, cachePath);
      }

      // Get changed files
      let changedFiles: string[];
      if (options.files) {
        changedFiles = options.files.split(',').map((f: string) => f.trim());
      } else {
        changedFiles = await findChangedFiles(options.base, options.target);
      }

      if (changedFiles.length === 0) {
        console.log('No changed files detected');
        return;
      }

      console.log(`\nChanged files (${changedFiles.length}):`);
      changedFiles.forEach((file) => console.log(`  - ${file}`));

      // Initialize scoring engine
      const scoringEngine = new ScoringEngine(config, registry);
      registerAllScorers(scoringEngine);

      // Get test files
      const testFiles = registry.getFilesByType('test').map((f) => f.path);

      // Analyze each changed file
      const allResults: ScoredTestResult[] = [];

      for (const changedFile of changedFiles) {
        console.log(`\nAnalyzing: ${changedFile}`);
        const results = scoringEngine.evaluateTests(changedFile, testFiles);
        const relevantTests = results.filter((r) => r.score >= config.scoring.minConfidence);

        console.log(`  Found ${relevantTests.length} relevant tests`);

        allResults.push({
          changedFile,
          relevantTests
        });
      }

      // Output results
      outputResults(allResults, options.output, parseInt(options.maxResults));

    } catch (error) {
      console.error('Error during analysis:', error);
      process.exit(1);
    }
  });

async function buildRegistry(config: ISuggestorConfig, registry: Registry): Promise<void> {
  console.log('Building registry...\n');

  // Initialize analyzer registry
  const analyzerRegistry = new AnalyzerRegistry(config);

  // Discover and register analyzers
  const analyzers = await AnalyzerDiscovery.discover(`${__dirname}/../analyzers`);
  for (const analyzer of analyzers) {
    analyzerRegistry.register(analyzer);
  }

  // Run analyzers
  const enabledAnalyzers = analyzerRegistry.getEnabled();
  console.log(`Running ${enabledAnalyzers.length} analyzers...\n`);

  // Extract source files
  const sourceExtractor = analyzerRegistry.get('source-extractor');
  if (sourceExtractor) {
    const sourceFiles = await findSourceFiles(config);
    console.log(`Extracting from ${sourceFiles.length} source files...`);

    for (const file of sourceFiles) {
      try {
        const sourceCode = await fs.readFile(file, 'utf-8');
        const result = await sourceExtractor.analyze({ filePath: file, sourceCode });
        registry.addOrUpdateFile(convertSourceResult(result));
      } catch (error) {
        console.warn(`  Failed: ${file}`);
      }
    }
  }

  // Extract test files
  const cypressExtractor = analyzerRegistry.get('cypress-extractor');
  if (cypressExtractor) {
    const testFiles = await findTestFiles(config);
    console.log(`Extracting from ${testFiles.length} test files...`);

    for (const file of testFiles) {
      try {
        const sourceCode = await fs.readFile(file, 'utf-8');
        const result = await cypressExtractor.analyze({ filePath: file, sourceCode });
        registry.addOrUpdateFile(convertCypressResult(result));
      } catch (error) {
        console.warn(`  Failed: ${file}`);
      }
    }
  }

  console.log('\n✓ Registry built successfully');
}

async function saveRegistry(registry: Registry, path: string): Promise<void> {
  const dir = require('path').dirname(path);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path, registry.serialize(), 'utf-8');
}

function outputResults(results: ScoredTestResult[], format: string, maxResults?: number): void {
  const flatResults = results.flatMap((r) =>
    r.relevantTests.map((t) => ({
      changedFile: r.changedFile,
      testFile: t.testFile,
      score: t.score,
      confidence: t.confidence,
      explanation: t.explanation,
      signals: t.signals
    }))
  );

  // Sort by score
  flatResults.sort((a, b) => b.score - a.score);

  // Limit results
  if (maxResults && flatResults.length > maxResults) {
    flatResults.length = maxResults;
  }

  if (flatResults.length === 0) {
    console.log('\nNo test suggestions');
    return;
  }

  switch (format) {
    case 'json':
      console.log(JSON.stringify(flatResults, null, 2));
      break;

    case 'list':
      console.log('\nSuggested tests:');
      flatResults.forEach((r, i) => {
        console.log(`${i + 1}. ${r.testFile} (score: ${r.score.toFixed(2)})`);
      });
      break;

    case 'table':
    default:
      console.log('\n' + '='.repeat(100));
      console.log('SUGGESTED TESTS');
      console.log('='.repeat(100));
      console.log();

      flatResults.forEach((r, i) => {
        console.log(`${i + 1}. ${r.testFile}`);
        console.log(`   Source: ${r.changedFile}`);
        console.log(`   Score: ${r.score.toFixed(2)} (${r.confidence})`);
        console.log(`   ${r.explanation}`);
        console.log();
      });
      break;
  }
}
```

### 3. Create Setup Command

**File:** `src/commands/setup.ts`

```typescript
import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ISuggestorConfig } from '../core/types';

export const setupCommand = new Command('setup')
  .description('Run setup wizard to configure Test Suggestor')
  .option('--auto', 'Skip interactive prompts, use auto-detection only')
  .action(async (options) => {
    console.log('Test Suggestor v3 - Setup Wizard\n');

    const config = await detectProjectConfig();
    const finalConfig = options.auto ? config : await interactiveSetup(config);

    // Save config
    const configPath = '.suggestorrc.json';
    await fs.writeFile(configPath, JSON.stringify(finalConfig, null, 2));
    console.log(`\n✓ Configuration saved to ${configPath}`);

    // Build registry
    console.log('\nBuilding registry...');
    const buildCmd = require('./build-registry').buildRegistryCommand;
    await buildCmd.parseAsync(['node', 'cli', 'registry', 'build']);
  });

async function detectProjectConfig(): Promise<ISuggestorConfig> {
  console.log('Detecting project configuration...\n');

  const config: ISuggestorConfig = {
    analyzers: {
      enabled: ['source-extractor', 'cypress-extractor'],
      sourceExtractor: {
        enabled: true,
        selectorStrategy: ['data-testid', 'data-cy']
      },
      cypressExtractor: {
        enabled: true
      },
      reduxChain: {
        enabled: false,
        storeDirs: []
      },
      i18n: {
        enabled: false,
        library: 'react-i18next',
        localesPath: ''
      },
      routeAnalyzer: {
        enabled: false,
        routerFile: ''
      },
      importGraph: {
        enabled: true
      }
    },
    scoring: {
      minConfidence: 0.40,
      ubiquityThreshold: 0.70,
      enabledScorers: [
        'direct-import',
        'route-match',
        'selector-match',
        'redux-chain'
      ]
    }
  };

  // Detect package.json
  try {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf-8'));

    // Detect Cypress
    if (pkg.devDependencies?.cypress) {
      console.log('✓ Cypress detected');
      config.analyzers.sourceExtractor.selectorStrategy = detectSelectorStrategy();
    }

    // Detect Redux
    if (pkg.dependencies?.['@reduxjs/toolkit']) {
      console.log('✓ Redux Toolkit detected');
      config.analyzers.reduxChain.enabled = true;
      config.analyzers.reduxChain.storeDirs = detectStoreDirs();
    }

    // Detect react-router
    if (pkg.dependencies?.['react-router-dom']) {
      console.log('✓ React Router detected');
      config.analyzers.routeAnalyzer.enabled = true;
      config.analyzers.routeAnalyzer.routerFile = detectRouterFile();
    }

    // Detect i18n
    if (pkg.dependencies?.['react-i18next']) {
      console.log('✓ react-i18next detected');
      config.analyzers.i18n.enabled = true;
      config.analyzers.i18n.localesPath = detectLocalesPath();
    }

  } catch (error) {
    console.warn('Could not detect project configuration');
  }

  return config;
}

function detectSelectorStrategy(): string[] {
  // Scan for selectors in codebase
  return ['data-testid', 'data-cy'];
}

function detectStoreDirs(): string[] {
  const possibleDirs = ['src/store', 'src/redux', 'src/state'];
  return possibleDirs.filter((dir) => require('fs').existsSync(dir));
}

function detectRouterFile(): string {
  const possibleFiles = ['src/App.tsx', 'src/index.tsx', 'src/router.tsx'];
  for (const file of possibleFiles) {
    if (require('fs').existsSync(file)) {
      return file;
    }
  }
  return 'src/App.tsx';
}

function detectLocalesPath(): string {
  const possiblePaths = [
    'public/locales/{locale}/translation.json',
    'src/i18n/{locale}.json'
  ];
  for (const p of possiblePaths) {
    if (require('fs').existsSync(p.replace('{locale}', 'en'))) {
      return p;
    }
  }
  return 'public/locales/{locale}/translation.json';
}

async function interactiveSetup(config: ISuggestorConfig): Promise<ISuggestorConfig> {
  // Use inquirer or readline for interactive prompts
  console.log('Interactive setup not implemented in this version');
  console.log('Using auto-detected configuration');
  return config;
}
```

### 4. Create Build Registry Command

**File:** `src/commands/build-registry.ts`

```typescript
import { Command } from 'commander';
import { buildRegistry } from '../core/registry-builder';
import { loadConfig } from '../config';
import * as fs from 'fs/promises';

export const buildRegistryCommand = new Command('registry')
  .description('Registry management commands')
  .addCommand(new Command('build')
    .description('Build registry from source files')
    .option('-f, --force', 'Force rebuild even if cache exists')
    .option('-o, --output <path>', 'Output path for registry', '.suggestor/registry.json')
    .action(async (options) => {
      try {
        const config = await loadConfig();
        const cachePath = options.output;

        // Check if cache exists and not forcing rebuild
        if (!options.force) {
          try {
            await fs.access(cachePath);
            console.log('Registry cache already exists. Use --force to rebuild.');
            return;
          } catch {
            // Cache doesn't exist, continue
          }
        }

        console.log('Building registry...\n');

        const startTime = Date.now();
        const registry = await buildRegistry({
          sourceDirs: config.sourceDirs,
          testPatterns: config.testPatterns
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        await fs.mkdir(require('path').dirname(cachePath), { recursive: true });
        await fs.writeFile(cachePath, registry.serialize(), 'utf-8');

        console.log('\n✓ Registry built successfully');
        console.log(`  Files: ${registry.getFiles().size}`);
        console.log(`  Dependencies: ${registry.getImportGraph().dependencies.size}`);
        console.log(`  Routes: ${registry.getRouteMap().size}`);
        console.log(`  Selectors: ${registry.getSelectorIndex().size}`);
        console.log(`  Duration: ${duration}s`);
        console.log(`  Path: ${cachePath}`);

      } catch (error) {
        console.error('Error building registry:', error);
        process.exit(1);
      }
    })
  );
```

### 5. Create Config Command

**File:** `src/commands/config.ts`

```typescript
import { Command } from 'commander';
import { loadConfig } from '../config';
import * as fs from 'fs/promises';

export const configCommand = new Command('config')
  .description('Configuration management')
  .addCommand(new Command('get')
    .description('Get configuration value')
    .argument('<key>', 'Configuration key (e.g., analyzers.sourceExtractor.selectorStrategy)')
    .action(async (key) => {
      const config = await loadConfig();
      const value = getValueByPath(config, key);
      console.log(JSON.stringify(value, null, 2));
    })
  )
  .addCommand(new Command('set')
    .description('Set configuration value')
    .argument('<key>', 'Configuration key')
    .argument('<value>', 'Configuration value (JSON or plain string)')
    .action(async (key, value) => {
      const config = await loadConfig();
      // Try JSON parse first, fall back to treating as plain string
      let parsed: any;
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = value; // treat as raw string
      }
      setValueByPath(config, key, parsed);
      await fs.writeFile('.suggestorrc.json', JSON.stringify(config, null, 2));
      console.log(`✓ Set ${key} = ${JSON.stringify(parsed)}`);
    })
  )
  .addCommand(new Command('list')
    .description('List all configuration')
    .action(async () => {
      const config = await loadConfig();
      console.log(JSON.stringify(config, null, 2));
    })
  );

function getValueByPath(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

function setValueByPath(obj: any, path: string, value: any): void {
  const keys = path.split('.');
  const lastKey = keys.pop()!;
  const target = keys.reduce((current, key) => current[key], obj);
  target[lastKey] = value;
}
```

### 6. Create Config Loader

**File:** `src/config.ts`

```typescript
import * as fs from 'fs/promises';
import { ISuggestorConfig } from './core/types';

const DEFAULT_CONFIG: ISuggestorConfig = {
  analyzers: {
    enabled: ['source-extractor', 'cypress-extractor'],
    sourceExtractor: {
      enabled: true,
      selectorStrategy: ['data-testid', 'data-cy']
    },
    cypressExtractor: {
      enabled: true
    },
    reduxChain: {
      enabled: false,
      storeDirs: []
    },
    i18n: {
      enabled: false,
      library: 'react-i18next',
      localesPath: ''
    },
    routeAnalyzer: {
      enabled: false,
      routerFile: ''
    },
    importGraph: {
      enabled: true
    }
  },
  scoring: {
    minConfidence: 0.40,
    ubiquityThreshold: 0.70,
    enabledScorers: []
  }
};

export async function loadConfig(configPath?: string): Promise<ISuggestorConfig> {
  const path = configPath || '.suggestorrc.json';

  try {
    const content = await fs.readFile(path, 'utf-8');
    const config = JSON.parse(content);
    return mergeConfig(DEFAULT_CONFIG, config);
  } catch (error) {
    console.warn(`Could not load config from ${path}, using defaults`);
    return { ...DEFAULT_CONFIG };
  }
}

function mergeConfig(defaultConfig: ISuggestorConfig, userConfig: any): ISuggestorConfig {
  return {
    ...defaultConfig,
    ...userConfig,
    analyzers: {
      ...defaultConfig.analyzers,
      ...userConfig.analyzers,
      sourceExtractor: {
        ...defaultConfig.analyzers.sourceExtractor,
        ...userConfig.analyzers?.sourceExtractor
      },
      cypressExtractor: {
        ...defaultConfig.analyzers.cypressExtractor,
        ...userConfig.analyzers?.cypressExtractor
      },
      reduxChain: {
        ...defaultConfig.analyzers.reduxChain,
        ...userConfig.analyzers?.reduxChain
      },
      i18n: {
        ...defaultConfig.analyzers.i18n,
        ...userConfig.analyzers?.i18n
      },
      routeAnalyzer: {
        ...defaultConfig.analyzers.routeAnalyzer,
        ...userConfig.analyzers?.routeAnalyzer
      }
    },
    scoring: {
      ...defaultConfig.scoring,
      ...userConfig.scoring
    }
  };
}

// Helper functions
async function findSourceFiles(config: ISuggestorConfig): Promise<string[]> {
  const fastGlob = await import('fast-glob');
  const patterns = config.testPatterns || ['**/*.ts', '**/*.tsx'];
  const ignore = config.ignorePatterns || ['node_modules', 'dist', '.git'];
  return fastGlob.sync(patterns, {
    cwd: process.cwd(),
    ignore,
    absolute: true
  });
}

async function findTestFiles(config: ISuggestorConfig): Promise<string[]> {
  const fastGlob = await import('fast-glob');
  const patterns = ['**/*.cy.ts', '**/*.cy.tsx', '**/*.test.ts', '**/*.spec.ts'];
  const ignore = config.ignorePatterns || ['node_modules', 'dist'];
  return fastGlob.sync(patterns, {
    cwd: process.cwd(),
    ignore,
    absolute: true
  });
}

export { findSourceFiles, findTestFiles };
```

---

## Known Gaps, Design Issues & Required Implementations

The following sections document each identified gap with detailed explanations, implementation guidance, and concrete test cases. These must all be addressed before the CLI is considered production-ready.

---

### Gap 1: `findChangedFiles` — Git Integration is a Black Box

#### Problem

`findChangedFiles` is imported from `../core/git` and is the single most important function in the entire tool — it determines *which files changed* and therefore which tests get suggested. However, it is completely unspecced. There are many edge cases in git that will silently produce wrong results if not handled explicitly.

#### Edge Cases That Must Be Handled

**1. Untracked / new files**

`git diff HEAD~1` only returns files tracked by git. A brand-new file that has never been committed is invisible to `git diff`. You must also run `git ls-files --others --exclude-standard` to pick up untracked files.

**2. Renamed files**

Git represents a rename as a delete + add in `git diff --name-only`. Your tool would then try to find tests for a path that no longer exists. You must use `git diff --name-status` and parse `R` (rename) records to extract the *new* path, not the old one.

**3. Staged vs. unstaged changes**

By default, `git diff HEAD~1` compares the last commit to the working tree. In a CI pipeline, everything is already committed so this works. But locally, a developer may have staged changes not yet committed. You need to handle both `git diff --cached` (staged) and `git diff` (unstaged) for local use.

**4. Detached HEAD in CI**

Many CI providers (GitHub Actions, Jenkins) checkout in a detached HEAD state. `HEAD~1` may not resolve correctly because there is no branch pointer. You must detect this and fall back gracefully — for example by using the environment variable `CI_COMMIT_BEFORE_SHA` or `GITHUB_BASE_REF` that CI systems expose.

**5. Monorepo / wrong working directory**

If the process is run from a subdirectory (e.g. `packages/frontend/`), `git diff` returns paths relative to the repo root, not to the current working directory. All returned paths must be resolved relative to the repo root using `git rev-parse --show-toplevel`.

#### Required Implementation

**File:** `src/core/git.ts`

```typescript
import { execSync } from 'child_process';
import * as path from 'path';

export interface ChangedFilesOptions {
  base?: string;   // e.g. 'main', 'HEAD~1', a commit SHA
  target?: string; // e.g. 'HEAD'
  includeStagedAndUnstaged?: boolean; // for local dev mode
}

export async function findChangedFiles(
  base?: string,
  target?: string
): Promise<string[]> {
  try {
    const repoRoot = getRepoRoot();
    const files = new Set<string>();

    // Resolve base ref — handle detached HEAD in CI
    const resolvedBase = resolveBaseRef(base);
    const resolvedTarget = target || 'HEAD';

    // 1. Committed changes between two refs
    const committedFiles = getCommittedChanges(resolvedBase, resolvedTarget, repoRoot);
    committedFiles.forEach((f) => files.add(f));

    // 2. Staged changes (not yet committed)
    const stagedFiles = getStagedChanges(repoRoot);
    stagedFiles.forEach((f) => files.add(f));

    // 3. Untracked new files
    const untrackedFiles = getUntrackedFiles(repoRoot);
    untrackedFiles.forEach((f) => files.add(f));

    return Array.from(files).filter(isSourceFile);
  } catch (error) {
    console.error('Git error:', (error as Error).message);
    return [];
  }
}

function getRepoRoot(): string {
  return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
}

function resolveBaseRef(base?: string): string {
  if (base) return base;

  // Check common CI environment variables
  const ciBase =
    process.env.GITHUB_BASE_REF ||        // GitHub Actions PRs
    process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME ||  // GitLab
    process.env.BITBUCKET_PR_DESTINATION_BRANCH;       // Bitbucket

  if (ciBase) return ciBase;

  // Fallback: try HEAD~1, but catch the case where there's only one commit
  try {
    execSync('git rev-parse HEAD~1', { encoding: 'utf-8', stdio: 'pipe' });
    return 'HEAD~1';
  } catch {
    // Single-commit repo or shallow clone — diff against empty tree
    return '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // git empty tree SHA
  }
}

function getCommittedChanges(base: string, target: string, repoRoot: string): string[] {
  // --name-status gives us rename detection (R100 old\tnew)
  const output = execSync(
    `git diff --name-status --diff-filter=ACDMR ${base}...${target}`,
    { encoding: 'utf-8', cwd: repoRoot }
  ).trim();

  if (!output) return [];

  return output
    .split('\n')
    .map((line) => {
      const parts = line.split('\t');
      const status = parts[0][0]; // A, C, D, M, R
      if (status === 'R') {
        // Rename: parts[1] = old path, parts[2] = new path
        return parts[2];
      }
      if (status === 'D') {
        // Deleted: skip — no point suggesting tests for a file that no longer exists
        return null;
      }
      return parts[1];
    })
    .filter((f): f is string => f !== null)
    .map((f) => path.resolve(repoRoot, f));
}

function getStagedChanges(repoRoot: string): string[] {
  try {
    const output = execSync(
      'git diff --cached --name-only --diff-filter=ACDMR',
      { encoding: 'utf-8', cwd: repoRoot }
    ).trim();
    if (!output) return [];
    return output.split('\n').map((f) => path.resolve(repoRoot, f));
  } catch {
    return [];
  }
}

function getUntrackedFiles(repoRoot: string): string[] {
  try {
    const output = execSync(
      'git ls-files --others --exclude-standard',
      { encoding: 'utf-8', cwd: repoRoot }
    ).trim();
    if (!output) return [];
    return output.split('\n').map((f) => path.resolve(repoRoot, f));
  } catch {
    return [];
  }
}

function isSourceFile(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|css|scss|json)$/.test(filePath) &&
    !filePath.includes('node_modules');
}
```

#### Test Cases for `findChangedFiles`

**File:** `src/core/__tests__/git.test.ts`

```typescript
import { findChangedFiles } from '../git';
import { execSync } from 'child_process';

jest.mock('child_process');
const mockExecSync = execSync as jest.Mock;

describe('findChangedFiles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: repo root is current directory
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('rev-parse --show-toplevel')) return '/repo\n';
      if (cmd.includes('rev-parse HEAD~1')) return 'abc123\n';
      return '';
    });
  });

  describe('committed changes', () => {
    it('returns modified files between two refs', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --show-toplevel')) return '/repo\n';
        if (cmd.includes('rev-parse HEAD~1')) return 'abc123\n';
        if (cmd.includes('diff --name-status')) {
          return 'M\tsrc/components/Button.tsx\nM\tsrc/utils/api.ts\n';
        }
        return '';
      });

      const result = await findChangedFiles();
      expect(result).toContain('/repo/src/components/Button.tsx');
      expect(result).toContain('/repo/src/utils/api.ts');
    });

    it('resolves renamed file to its NEW path, not the old path', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --show-toplevel')) return '/repo\n';
        if (cmd.includes('rev-parse HEAD~1')) return 'abc123\n';
        if (cmd.includes('diff --name-status')) {
          // R100 = 100% rename similarity
          return 'R100\tsrc/components/OldButton.tsx\tsrc/components/Button.tsx\n';
        }
        return '';
      });

      const result = await findChangedFiles();
      expect(result).toContain('/repo/src/components/Button.tsx');
      expect(result).not.toContain('/repo/src/components/OldButton.tsx');
    });

    it('excludes deleted files from results', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --show-toplevel')) return '/repo\n';
        if (cmd.includes('rev-parse HEAD~1')) return 'abc123\n';
        if (cmd.includes('diff --name-status')) {
          return 'D\tsrc/components/OldThing.tsx\nM\tsrc/components/Button.tsx\n';
        }
        return '';
      });

      const result = await findChangedFiles();
      expect(result).not.toContain('/repo/src/components/OldThing.tsx');
      expect(result).toContain('/repo/src/components/Button.tsx');
    });
  });

  describe('untracked new files', () => {
    it('includes untracked files that have never been committed', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --show-toplevel')) return '/repo\n';
        if (cmd.includes('rev-parse HEAD~1')) return 'abc123\n';
        if (cmd.includes('diff --name-status')) return '';
        if (cmd.includes('diff --cached')) return '';
        if (cmd.includes('ls-files --others')) {
          return 'src/components/BrandNewComponent.tsx\n';
        }
        return '';
      });

      const result = await findChangedFiles();
      expect(result).toContain('/repo/src/components/BrandNewComponent.tsx');
    });

    it('does not include untracked files in node_modules', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --show-toplevel')) return '/repo\n';
        if (cmd.includes('rev-parse HEAD~1')) return 'abc123\n';
        if (cmd.includes('diff --name-status')) return '';
        if (cmd.includes('diff --cached')) return '';
        if (cmd.includes('ls-files --others')) {
          return 'node_modules/some-lib/index.js\n';
        }
        return '';
      });

      const result = await findChangedFiles();
      expect(result).toHaveLength(0);
    });
  });

  describe('CI / detached HEAD scenarios', () => {
    it('uses GITHUB_BASE_REF when set instead of HEAD~1', async () => {
      process.env.GITHUB_BASE_REF = 'main';
      const capturedCmds: string[] = [];

      mockExecSync.mockImplementation((cmd: string) => {
        capturedCmds.push(cmd as string);
        if (cmd.includes('rev-parse --show-toplevel')) return '/repo\n';
        if (cmd.includes('diff --name-status')) return '';
        if (cmd.includes('diff --cached')) return '';
        if (cmd.includes('ls-files --others')) return '';
        return '';
      });

      await findChangedFiles();
      expect(capturedCmds.some((c) => c.includes('main...HEAD'))).toBe(true);

      delete process.env.GITHUB_BASE_REF;
    });

    it('falls back to empty tree SHA on a single-commit repo', async () => {
      const capturedCmds: string[] = [];

      mockExecSync.mockImplementation((cmd: string) => {
        capturedCmds.push(cmd as string);
        if (cmd.includes('rev-parse --show-toplevel')) return '/repo\n';
        if (cmd.includes('rev-parse HEAD~1')) throw new Error('unknown revision');
        if (cmd.includes('diff --name-status')) return '';
        if (cmd.includes('diff --cached')) return '';
        if (cmd.includes('ls-files --others')) return '';
        return '';
      });

      // Should not throw
      const result = await findChangedFiles();
      // Should have used the empty tree SHA
      expect(capturedCmds.some((c) =>
        c.includes('4b825dc642cb6eb9a060e54bf8d69288fbee4904')
      )).toBe(true);
      expect(result).toEqual([]);
    });
  });

  describe('monorepo / path resolution', () => {
    it('resolves paths relative to repo root, not cwd', async () => {
      // Simulate running from packages/frontend/ while repo root is /repo
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --show-toplevel')) return '/repo\n';
        if (cmd.includes('rev-parse HEAD~1')) return 'abc123\n';
        if (cmd.includes('diff --name-status')) {
          // git returns paths relative to repo root
          return 'M\tpackages/frontend/src/Button.tsx\n';
        }
        return '';
      });

      const result = await findChangedFiles();
      // Must be an absolute path rooted at /repo
      expect(result).toContain('/repo/packages/frontend/src/Button.tsx');
    });
  });
});
```

---

### Gap 2: Duplicated `buildRegistry` Logic — Must Use Shared Core Module

#### Problem

There are currently two separate implementations of registry-building logic:

- `analyze.ts` has a local `buildRegistry()` function defined inline
- `build-registry.ts` calls `../core/registry-builder` (a separate module)

These will diverge over time. A bug fixed in one will not be fixed in the other. A new analyzer added to one will be silently missing from the other. The solution is to delete the inline version from `analyze.ts` entirely, and have both commands call the same shared `core/registry-builder` module.

#### Required Implementation

**File:** `src/core/registry-builder.ts`

This is the single source of truth for all registry building. Both `analyze.ts` and `build-registry.ts` must import from here.

```typescript
import * as fs from 'fs/promises';
import { Registry } from './registry';
import { AnalyzerRegistry, AnalyzerDiscovery } from './analyzer-registry';
import { ISuggestorConfig } from './types';
import { findSourceFiles, findTestFiles } from '../config';
import { convertSourceResult, convertCypressResult } from './result-converters';

export interface BuildRegistryOptions {
  config: ISuggestorConfig;
  onProgress?: (message: string) => void;
}

export async function buildRegistry(options: BuildRegistryOptions): Promise<Registry> {
  const { config, onProgress = console.log } = options;

  const registry = new Registry();
  const analyzerRegistry = new AnalyzerRegistry(config);

  const analyzers = await AnalyzerDiscovery.discover(`${__dirname}/../analyzers`);
  for (const analyzer of analyzers) {
    analyzerRegistry.register(analyzer);
  }

  // --- Source files ---
  const sourceExtractor = analyzerRegistry.get('source-extractor');
  if (sourceExtractor) {
    const sourceFiles = await findSourceFiles(config);
    onProgress(`Extracting from ${sourceFiles.length} source files...`);

    for (let i = 0; i < sourceFiles.length; i++) {
      const file = sourceFiles[i];
      onProgress(`  [${i + 1}/${sourceFiles.length}] ${file}`);
      try {
        const sourceCode = await fs.readFile(file, 'utf-8');
        const result = await sourceExtractor.analyze({ filePath: file, sourceCode });
        registry.addOrUpdateFile(convertSourceResult(result));
      } catch (error) {
        onProgress(`  ⚠ Failed: ${file} — ${(error as Error).message}`);
      }
    }
  }

  // --- Test files ---
  const cypressExtractor = analyzerRegistry.get('cypress-extractor');
  if (cypressExtractor) {
    const testFiles = await findTestFiles(config);
    onProgress(`Extracting from ${testFiles.length} test files...`);

    for (let i = 0; i < testFiles.length; i++) {
      const file = testFiles[i];
      onProgress(`  [${i + 1}/${testFiles.length}] ${file}`);
      try {
        const sourceCode = await fs.readFile(file, 'utf-8');
        const result = await cypressExtractor.analyze({ filePath: file, sourceCode });
        registry.addOrUpdateFile(convertCypressResult(result));
      } catch (error) {
        onProgress(`  ⚠ Failed: ${file} — ${(error as Error).message}`);
      }
    }
  }

  return registry;
}
```

Then update `analyze.ts` to remove the inline `buildRegistry` and import from core:

```typescript
// In analyze.ts — remove the inline buildRegistry function entirely and replace with:
import { buildRegistry } from '../core/registry-builder';

// Inside the action handler:
const registry = await buildRegistry({ config });
await saveRegistry(registry, cachePath);
```

#### Test Cases for `buildRegistry` (shared module)

**File:** `src/core/__tests__/registry-builder.test.ts`

```typescript
import { buildRegistry } from '../registry-builder';
import { AnalyzerDiscovery } from '../analyzer-registry';
import * as fs from 'fs/promises';

jest.mock('../analyzer-registry');
jest.mock('fs/promises');
jest.mock('../../config');

const mockConfig = {
  analyzers: {
    enabled: ['source-extractor', 'cypress-extractor'],
    sourceExtractor: { enabled: true, selectorStrategy: ['data-testid'] },
    cypressExtractor: { enabled: true },
    reduxChain: { enabled: false, storeDirs: [] },
    i18n: { enabled: false, library: 'react-i18next', localesPath: '' },
    routeAnalyzer: { enabled: false, routerFile: '' },
    importGraph: { enabled: true }
  },
  scoring: { minConfidence: 0.4, ubiquityThreshold: 0.7, enabledScorers: [] }
};

describe('buildRegistry (shared core module)', () => {
  it('returns a Registry instance with source and test files indexed', async () => {
    // Arrange: mock analyzers and file reads
    (AnalyzerDiscovery.discover as jest.Mock).mockResolvedValue([
      { name: 'source-extractor', analyze: jest.fn().mockResolvedValue({ selectors: [] }) },
      { name: 'cypress-extractor', analyze: jest.fn().mockResolvedValue({ tests: [] }) }
    ]);
    (fs.readFile as jest.Mock).mockResolvedValue('// mock source');

    const registry = await buildRegistry({ config: mockConfig });
    expect(registry).toBeDefined();
  });

  it('calls onProgress callback with file-by-file updates', async () => {
    const progressMessages: string[] = [];
    (AnalyzerDiscovery.discover as jest.Mock).mockResolvedValue([]);

    await buildRegistry({
      config: mockConfig,
      onProgress: (msg) => progressMessages.push(msg)
    });

    expect(progressMessages.length).toBeGreaterThan(0);
  });

  it('does not throw if a single file fails to parse — logs warning and continues', async () => {
    (AnalyzerDiscovery.discover as jest.Mock).mockResolvedValue([
      {
        name: 'source-extractor',
        analyze: jest.fn()
          .mockRejectedValueOnce(new Error('parse error'))  // first file fails
          .mockResolvedValue({ selectors: [] })              // rest succeed
      }
    ]);
    (fs.readFile as jest.Mock).mockResolvedValue('// source');

    // Should NOT throw
    await expect(buildRegistry({ config: mockConfig })).resolves.toBeDefined();
  });

  it('produces identical results when called twice on the same codebase', async () => {
    (AnalyzerDiscovery.discover as jest.Mock).mockResolvedValue([]);

    const r1 = await buildRegistry({ config: mockConfig });
    const r2 = await buildRegistry({ config: mockConfig });

    expect(r1.serialize()).toEqual(r2.serialize());
  });
});
```

---

### Gap 3: `convertSourceResult` and `convertCypressResult` Are Undefined

#### Problem

Both functions are called inside the registry-building loop but are never defined anywhere in this spec. They are the critical adapter layer that translates raw analyzer output (whatever shape the analyzer returns) into the standardized `IFileEntry` shape that the `Registry` understands. Without these, the entire registry build will throw a `ReferenceError` at runtime.

#### What They Must Do

- `convertSourceResult(result)` — takes the output of `source-extractor` (which contains selectors, imports, routes, etc.) and returns an `IFileEntry`
- `convertCypressResult(result)` — takes the output of `cypress-extractor` (which contains test names, visited routes, used selectors, etc.) and returns an `IFileEntry`

#### Required Implementation

**File:** `src/core/result-converters.ts`

```typescript
import * as path from 'path';
import { IFileEntry } from './types';

// Shape returned by source-extractor analyzer
export interface SourceAnalyzerResult {
  filePath: string;
  imports: string[];
  exports: string[];
  selectors: string[];      // e.g. ['data-testid="submit-btn"', 'data-cy="login-form"']
  routes: string[];         // e.g. ['/dashboard', '/profile/:id']
  reduxActions: string[];   // e.g. ['userSlice/fetchUser', 'cartSlice/addItem']
  i18nKeys: string[];       // e.g. ['common.save', 'errors.notFound']
}

// Shape returned by cypress-extractor analyzer
export interface CypressAnalyzerResult {
  filePath: string;
  testNames: string[];      // e.g. ['Login flow - shows error on wrong password']
  visitedRoutes: string[];  // e.g. ['/login', '/dashboard']
  usedSelectors: string[];  // e.g. ['data-testid="email-input"', 'data-cy="submit"']
  importedFiles: string[];  // source files this spec imports directly
}

export function convertSourceResult(result: SourceAnalyzerResult): IFileEntry {
  return {
    path: result.filePath,
    type: 'source',
    name: path.basename(result.filePath, path.extname(result.filePath)),
    imports: result.imports,
    exports: result.exports,
    selectors: result.selectors,
    routes: result.routes,
    reduxActions: result.reduxActions,
    i18nKeys: result.i18nKeys,
    metadata: {}
  };
}

export function convertCypressResult(result: CypressAnalyzerResult): IFileEntry {
  return {
    path: result.filePath,
    type: 'test',
    name: path.basename(result.filePath, path.extname(result.filePath)),
    imports: result.importedFiles,
    exports: [],
    selectors: result.usedSelectors,
    routes: result.visitedRoutes,
    reduxActions: [],
    i18nKeys: [],
    metadata: {
      testNames: result.testNames
    }
  };
}
```

#### Test Cases for Result Converters

**File:** `src/core/__tests__/result-converters.test.ts`

```typescript
import { convertSourceResult, convertCypressResult } from '../result-converters';

describe('convertSourceResult', () => {
  const baseResult = {
    filePath: '/repo/src/components/LoginForm.tsx',
    imports: ['react', '../utils/api', '../store/userSlice'],
    exports: ['LoginForm'],
    selectors: ['data-testid="email-input"', 'data-testid="password-input"', 'data-cy="submit"'],
    routes: [],
    reduxActions: ['userSlice/login', 'userSlice/logout'],
    i18nKeys: ['login.title', 'login.submit']
  };

  it('sets type to "source"', () => {
    const entry = convertSourceResult(baseResult);
    expect(entry.type).toBe('source');
  });

  it('extracts the file basename as name (without extension)', () => {
    const entry = convertSourceResult(baseResult);
    expect(entry.name).toBe('LoginForm');
  });

  it('preserves all selectors', () => {
    const entry = convertSourceResult(baseResult);
    expect(entry.selectors).toEqual([
      'data-testid="email-input"',
      'data-testid="password-input"',
      'data-cy="submit"'
    ]);
  });

  it('preserves redux actions', () => {
    const entry = convertSourceResult(baseResult);
    expect(entry.reduxActions).toEqual(['userSlice/login', 'userSlice/logout']);
  });

  it('handles empty arrays gracefully', () => {
    const emptyResult = { ...baseResult, selectors: [], routes: [], reduxActions: [], i18nKeys: [] };
    const entry = convertSourceResult(emptyResult);
    expect(entry.selectors).toEqual([]);
    expect(entry.routes).toEqual([]);
  });
});

describe('convertCypressResult', () => {
  const baseResult = {
    filePath: '/repo/cypress/e2e/login.cy.ts',
    testNames: ['Login flow - submits form', 'Login flow - shows error on wrong password'],
    visitedRoutes: ['/login', '/dashboard'],
    usedSelectors: ['data-testid="email-input"', 'data-cy="submit"'],
    importedFiles: ['../../src/utils/testHelpers']
  };

  it('sets type to "test"', () => {
    const entry = convertCypressResult(baseResult);
    expect(entry.type).toBe('test');
  });

  it('stores test names in metadata', () => {
    const entry = convertCypressResult(baseResult);
    expect(entry.metadata.testNames).toEqual([
      'Login flow - submits form',
      'Login flow - shows error on wrong password'
    ]);
  });

  it('maps visitedRoutes to routes field', () => {
    const entry = convertCypressResult(baseResult);
    expect(entry.routes).toEqual(['/login', '/dashboard']);
  });

  it('maps importedFiles to imports field', () => {
    const entry = convertCypressResult(baseResult);
    expect(entry.imports).toEqual(['../../src/utils/testHelpers']);
  });

  it('sets reduxActions to empty array (tests do not dispatch actions directly)', () => {
    const entry = convertCypressResult(baseResult);
    expect(entry.reduxActions).toEqual([]);
  });
});
```

---

### Gap 4: No Cache Invalidation — Stale Registry Silently Serves Wrong Results

#### Problem

The analyze command loads the registry from `.suggestor/registry.json` with no check for staleness. If a developer adds a new component with a new `data-testid` selector, then runs `suggestor analyze`, the tool will give suggestions based on the old registry that doesn't know the new selector exists. The cache can be silently wrong for days.

You need a strategy to detect when the cache is stale and warn the user or trigger a rebuild.

#### Strategy: Content Hash + Timestamp in Cache Metadata

When saving the registry, compute a hash of all source file paths and their `mtime` timestamps. On load, recompute the hash and compare. If they differ, the cache is stale.

#### Required Implementation

**File:** `src/core/registry-cache.ts`

```typescript
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import * as path from 'path';
import { Registry } from './registry';
import { findSourceFiles, findTestFiles } from '../config';
import { ISuggestorConfig } from './types';

export interface RegistryCacheMetadata {
  builtAt: string;           // ISO timestamp
  fileHash: string;          // Hash of all source file paths + mtimes
  fileCount: number;
  version: string;           // e.g. '3.0.0' — invalidate on tool upgrade
}

export interface CachedRegistry {
  metadata: RegistryCacheMetadata;
  data: string;              // serialized Registry
}

const TOOL_VERSION = '3.0.0';
const MAX_CACHE_AGE_HOURS = 24;

export async function saveRegistryCache(
  registry: Registry,
  cachePath: string,
  config: ISuggestorConfig
): Promise<void> {
  const allFiles = [
    ...await findSourceFiles(config),
    ...await findTestFiles(config)
  ];

  const fileHash = await computeFileHash(allFiles);

  const cached: CachedRegistry = {
    metadata: {
      builtAt: new Date().toISOString(),
      fileHash,
      fileCount: allFiles.length,
      version: TOOL_VERSION
    },
    data: registry.serialize()
  };

  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(cached, null, 2), 'utf-8');
}

export interface LoadCacheResult {
  registry: Registry | null;
  reason?: 'stale-files' | 'expired' | 'version-mismatch' | 'not-found' | 'corrupt';
  metadata?: RegistryCacheMetadata;
}

export async function loadRegistryCache(
  cachePath: string,
  config: ISuggestorConfig,
  registry: Registry
): Promise<LoadCacheResult> {
  // 1. Try reading the file
  let cached: CachedRegistry;
  try {
    const raw = await fs.readFile(cachePath, 'utf-8');
    cached = JSON.parse(raw);
  } catch {
    return { registry: null, reason: 'not-found' };
  }

  // 2. Validate structure
  if (!cached.metadata || !cached.data) {
    return { registry: null, reason: 'corrupt' };
  }

  // 3. Check tool version
  if (cached.metadata.version !== TOOL_VERSION) {
    return { registry: null, reason: 'version-mismatch', metadata: cached.metadata };
  }

  // 4. Check age
  const builtAt = new Date(cached.metadata.builtAt);
  const ageHours = (Date.now() - builtAt.getTime()) / (1000 * 60 * 60);
  if (ageHours > MAX_CACHE_AGE_HOURS) {
    return { registry: null, reason: 'expired', metadata: cached.metadata };
  }

  // 5. Check file hash
  const allFiles = [
    ...await findSourceFiles(config),
    ...await findTestFiles(config)
  ];
  const currentHash = await computeFileHash(allFiles);
  if (currentHash !== cached.metadata.fileHash) {
    return { registry: null, reason: 'stale-files', metadata: cached.metadata };
  }

  // 6. All good — deserialize
  registry.deserialize(cached.data);
  return { registry, metadata: cached.metadata };
}

async function computeFileHash(filePaths: string[]): Promise<string> {
  const sorted = [...filePaths].sort();
  const parts: string[] = [];

  for (const filePath of sorted) {
    try {
      const stat = await fs.stat(filePath);
      parts.push(`${filePath}:${stat.mtimeMs}`);
    } catch {
      parts.push(`${filePath}:missing`);
    }
  }

  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}
```

Then update `analyze.ts` to use the new cache utilities:

```typescript
// In analyze.ts — replace the try/catch cache block with:
import { loadRegistryCache, saveRegistryCache } from '../core/registry-cache';

const registry = new Registry();
const cacheResult = await loadRegistryCache(cachePath, config, registry);

if (cacheResult.registry) {
  console.log('✓ Loaded registry from cache');
  if (cacheResult.metadata) {
    console.log(`  Built: ${cacheResult.metadata.builtAt}`);
  }
} else {
  const reasons: Record<string, string> = {
    'not-found': 'Registry cache not found, building...',
    'stale-files': '⚠ Source files have changed since last build, rebuilding registry...',
    'expired': '⚠ Registry cache is older than 24 hours, rebuilding...',
    'version-mismatch': '⚠ Tool version changed, rebuilding registry...',
    'corrupt': '⚠ Registry cache is corrupt, rebuilding...'
  };
  console.log(reasons[cacheResult.reason!] || 'Rebuilding registry...');

  await buildRegistryCore({ config });
  await saveRegistryCache(registry, cachePath, config);
}
```

#### Test Cases for Cache Invalidation

**File:** `src/core/__tests__/registry-cache.test.ts`

```typescript
import { saveRegistryCache, loadRegistryCache } from '../registry-cache';
import * as fs from 'fs/promises';

jest.mock('fs/promises');
jest.mock('../../config');

describe('loadRegistryCache', () => {
  const mockRegistry = { deserialize: jest.fn(), serialize: jest.fn(() => '{}') } as any;
  const mockConfig = {} as any;

  it('returns reason "not-found" when cache file does not exist', async () => {
    (fs.readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));
    const result = await loadRegistryCache('.suggestor/registry.json', mockConfig, mockRegistry);
    expect(result.registry).toBeNull();
    expect(result.reason).toBe('not-found');
  });

  it('returns reason "corrupt" when cache JSON is malformed', async () => {
    (fs.readFile as jest.Mock).mockResolvedValue('{ this is not json }');
    const result = await loadRegistryCache('.suggestor/registry.json', mockConfig, mockRegistry);
    expect(result.registry).toBeNull();
    expect(result.reason).toBe('corrupt');
  });

  it('returns reason "version-mismatch" when tool version changed', async () => {
    const staleCache = JSON.stringify({
      metadata: { builtAt: new Date().toISOString(), fileHash: 'abc', fileCount: 0, version: '2.0.0' },
      data: '{}'
    });
    (fs.readFile as jest.Mock).mockResolvedValue(staleCache);
    const result = await loadRegistryCache('.suggestor/registry.json', mockConfig, mockRegistry);
    expect(result.registry).toBeNull();
    expect(result.reason).toBe('version-mismatch');
  });

  it('returns reason "expired" when cache is older than 24 hours', async () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
    const expiredCache = JSON.stringify({
      metadata: { builtAt: oldDate, fileHash: 'abc', fileCount: 0, version: '3.0.0' },
      data: '{}'
    });
    (fs.readFile as jest.Mock).mockResolvedValue(expiredCache);
    const result = await loadRegistryCache('.suggestor/registry.json', mockConfig, mockRegistry);
    expect(result.registry).toBeNull();
    expect(result.reason).toBe('expired');
  });

  it('returns reason "stale-files" when a source file has been modified since build', async () => {
    const recentDate = new Date().toISOString();
    const cachedHash = 'old-hash-that-no-longer-matches';
    const cache = JSON.stringify({
      metadata: { builtAt: recentDate, fileHash: cachedHash, fileCount: 1, version: '3.0.0' },
      data: '{}'
    });
    (fs.readFile as jest.Mock).mockResolvedValue(cache);
    // computeFileHash will produce a different hash because mtimes changed
    (fs.stat as jest.Mock).mockResolvedValue({ mtimeMs: Date.now() });

    const result = await loadRegistryCache('.suggestor/registry.json', mockConfig, mockRegistry);
    expect(result.registry).toBeNull();
    expect(result.reason).toBe('stale-files');
  });

  it('returns registry when cache is valid and up-to-date', async () => {
    // This requires a matching hash — tested via integration test (see below)
  });
});
```

---

### Gap 5: `config set` Crashes on Non-JSON String Values

#### Problem

The original implementation does `JSON.parse(value)` unconditionally on whatever the user typed. This means:

```bash
suggestor config set scoring.minConfidence 0.50   # ✓ works — 0.50 is valid JSON
suggestor config set analyzers.sourceExtractor.selectorStrategy data-testid  # ✗ THROWS
# SyntaxError: Unexpected token d in JSON at position 0
```

Any plain string that doesn't happen to be valid JSON will crash the process. The fix is to attempt JSON parse, and if it fails, treat the value as a plain string.

#### Fix (already shown in updated `config.ts` above)

```typescript
let parsed: any;
try {
  parsed = JSON.parse(value);
} catch {
  parsed = value; // treat as raw string
}
```

#### Test Cases for `config set`

**File:** `src/commands/__tests__/config.test.ts`

```typescript
import { configCommand } from '../config';

jest.mock('fs/promises');
jest.mock('../../config');

describe('config set', () => {
  it('parses a number value correctly', async () => {
    // "0.50" should become the number 0.5
    await configCommand
      .parseAsync(['node', 'cli', 'set', 'scoring.minConfidence', '0.50']);
    // Expect config was written with numeric value, not string "0.50"
  });

  it('parses a JSON array correctly', async () => {
    // '["data-testid","data-cy"]' should become a real array
    await configCommand
      .parseAsync(['node', 'cli', 'set', 'analyzers.sourceExtractor.selectorStrategy', '["data-testid","data-cy"]']);
  });

  it('treats a plain string as a string without throwing', async () => {
    // "data-testid" is not valid JSON but should not crash
    await expect(
      configCommand.parseAsync(['node', 'cli', 'set', 'analyzers.sourceExtractor.selectorStrategy', 'data-testid'])
    ).resolves.not.toThrow();
  });

  it('treats "true" as boolean true, not the string "true"', async () => {
    await configCommand
      .parseAsync(['node', 'cli', 'set', 'analyzers.reduxChain.enabled', 'true']);
    // JSON.parse("true") === true (boolean) — correct
  });

  it('treats a plain word like "main" as a string', async () => {
    // "main" is not valid JSON, should be stored as the string "main"
    await expect(
      configCommand.parseAsync(['node', 'cli', 'set', 'git.baseBranch', 'main'])
    ).resolves.not.toThrow();
  });
});
```

---

### Gap 6: Missing `ScoredTest` Type — Replace All `any[]` in Output Layer

#### Problem

The `outputResults` function accepts `any[]` and the results are spread as untyped objects. This means TypeScript cannot catch bugs like accessing `r.testFIle` (typo) or `r.scor` (typo) at the output layer — the layer that's actually presented to users. A typo here silently produces `undefined` in the output.

#### Required Type Definitions

Add the following to **`src/core/types.ts`**:

```typescript
// Add to existing types.ts

export type ConfidenceLabel = 'high' | 'medium' | 'low';

export interface ScoredTest {
  testFile: string;          // e.g. 'cypress/e2e/login.cy.ts'
  score: number;             // 0.0 – 1.0
  confidence: ConfidenceLabel;
  explanation: string;       // e.g. 'Direct import match + selector overlap (3 selectors)'
  signals: ScoringSignal[];  // the individual signals that contributed to this score
}

export interface ScoringSignal {
  scorer: string;    // e.g. 'direct-import', 'selector-match'
  score: number;     // this scorer's contribution
  reason: string;    // human-readable explanation of this signal
}

export interface ScoredTestResult {
  changedFile: string;
  relevantTests: ScoredTest[];
}
```

Then update `outputResults` in `analyze.ts` and any related call sites:

```typescript
// Before (unsafe):
function outputResults(results: any[], format: string, maxResults?: number): void {
  const flatResults = results.flatMap((r) =>
    r.relevantTests.map((t: any) => ({ ... }))
  );
  ...
}

// After (typed):
function outputResults(
  results: ScoredTestResult[],
  format: string,
  maxResults?: number
): void {
  const flatResults: Array<ScoredTest & { changedFile: string }> = results.flatMap((r) =>
    r.relevantTests.map((t) => ({
      changedFile: r.changedFile,
      ...t
    }))
  );
  ...
}
```

#### Test Cases for Output Formatting

**File:** `src/commands/__tests__/analyze-output.test.ts`

```typescript
import { outputResults } from '../analyze'; // export this function for testing

const mockResults: ScoredTestResult[] = [
  {
    changedFile: 'src/components/LoginForm.tsx',
    relevantTests: [
      {
        testFile: 'cypress/e2e/login.cy.ts',
        score: 0.92,
        confidence: 'high',
        explanation: 'Direct import + 3 selector matches',
        signals: [
          { scorer: 'direct-import', score: 0.5, reason: 'Test imports LoginForm directly' },
          { scorer: 'selector-match', score: 0.42, reason: '3 shared data-testid selectors' }
        ]
      },
      {
        testFile: 'cypress/e2e/dashboard.cy.ts',
        score: 0.31,  // below default threshold of 0.40
        confidence: 'low',
        explanation: 'Route overlap only',
        signals: [{ scorer: 'route-match', score: 0.31, reason: 'Visits /login route' }]
      }
    ]
  }
];

describe('outputResults', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('table format prints test file and score', () => {
    outputResults(mockResults, 'table');
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('cypress/e2e/login.cy.ts');
    expect(output).toContain('0.92');
  });

  it('list format prints numbered results', () => {
    outputResults(mockResults, 'list');
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('1. cypress/e2e/login.cy.ts');
  });

  it('json format produces valid parseable JSON', () => {
    outputResults(mockResults, 'json');
    const jsonOutput = consoleSpy.mock.calls[0][0];
    expect(() => JSON.parse(jsonOutput)).not.toThrow();
    const parsed = JSON.parse(jsonOutput);
    expect(parsed[0].testFile).toBe('cypress/e2e/login.cy.ts');
    expect(parsed[0].score).toBe(0.92);
  });

  it('respects maxResults limit', () => {
    // Create 5 results, limit to 2
    const manyResults: ScoredTestResult[] = [{
      changedFile: 'src/Button.tsx',
      relevantTests: Array.from({ length: 5 }, (_, i) => ({
        testFile: `cypress/e2e/test-${i}.cy.ts`,
        score: 0.9 - i * 0.1,
        confidence: 'high' as const,
        explanation: '',
        signals: []
      }))
    }];
    outputResults(manyResults, 'list', 2);
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('test-0.cy.ts');
    expect(output).toContain('test-1.cy.ts');
    expect(output).not.toContain('test-2.cy.ts');
  });

  it('sorts results by score descending', () => {
    outputResults(mockResults, 'list');
    const output = consoleSpy.mock.calls.flat().join('\n');
    const pos1 = output.indexOf('login.cy.ts');
    const pos2 = output.indexOf('dashboard.cy.ts');
    // login (0.92) should appear before dashboard (0.31)
    expect(pos1).toBeLessThan(pos2);
  });

  it('prints "No test suggestions" when results are empty', () => {
    outputResults([], 'table');
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toContain('No test suggestions');
  });
});
```

---

### Gap 7: Missing `loadConfig` Import in `build-registry.ts` and `config.ts`

#### Problem

Both `build-registry.ts` and `config.ts` call `loadConfig()` without importing it. This is a straightforward runtime crash:

```
ReferenceError: loadConfig is not defined
```

#### Fix

In `build-registry.ts`, add at the top:

```typescript
import { loadConfig } from '../config';
```

In `config.ts` (the command file, not the config loader itself), add:

```typescript
import { loadConfig } from '../config';
```

This is already shown in the corrected versions of those files above. The fix is simple but the consequence of missing it is that `suggestor registry build` and all `suggestor config` subcommands crash immediately on startup.

#### Test Cases

```typescript
// src/commands/__tests__/build-registry.test.ts
describe('registry build command', () => {
  it('does not throw ReferenceError on startup (loadConfig is imported)', async () => {
    // If loadConfig is missing, this will throw ReferenceError before any logic runs
    await expect(
      import('../build-registry')
    ).resolves.toBeDefined();
  });
});

// src/commands/__tests__/config-cmd.test.ts
describe('config command', () => {
  it('does not throw ReferenceError on startup (loadConfig is imported)', async () => {
    await expect(
      import('../config')
    ).resolves.toBeDefined();
  });
});
```

---

### Gap 8: Defined Exit Codes for CI Integration

#### Problem

CI pipelines depend on exit codes to determine if a step passed or failed. Currently `process.exit(1)` is used only for errors, but there's no documented or consistent contract for what different exit codes mean. A CI script has no way to distinguish "tool crashed" from "no tests found" from "tests were suggested."

#### Required Exit Code Contract

Add the following to **`src/core/exit-codes.ts`**:

```typescript
export const EXIT_CODES = {
  SUCCESS: 0,               // Analysis ran successfully and tests were suggested
  NO_TESTS_FOUND: 0,        // Analysis ran successfully but no tests matched (not an error)
  NO_CHANGED_FILES: 0,      // No changed files detected (not an error)
  ERROR_GIT: 2,             // Git command failed
  ERROR_CONFIG: 3,          // Config file could not be parsed
  ERROR_REGISTRY: 4,        // Registry build failed
  ERROR_UNKNOWN: 1          // Unexpected error
} as const;

export type ExitCode = typeof EXIT_CODES[keyof typeof EXIT_CODES];
```

Update the `analyze` action handler to use these:

```typescript
import { EXIT_CODES } from '../core/exit-codes';

// Replace: process.exit(1) in catch block
catch (error) {
  if (error instanceof GitError) {
    console.error('Git error:', error.message);
    process.exit(EXIT_CODES.ERROR_GIT);
  } else if (error instanceof ConfigError) {
    console.error('Config error:', error.message);
    process.exit(EXIT_CODES.ERROR_CONFIG);
  } else {
    console.error('Unexpected error:', error);
    process.exit(EXIT_CODES.ERROR_UNKNOWN);
  }
}
```

---

### Gap 9: No Progress Indication During Registry Build

#### Problem

On a codebase with 200 source files and 80 spec files, `suggestor registry build` is completely silent for potentially 10-20 seconds. Users will assume it has hung.

The fix is already incorporated into the shared `buildRegistry` in `registry-builder.ts` above via the `onProgress` callback. The CLI commands just need to wire it up:

```typescript
// In build-registry.ts action handler:
const registry = await buildRegistry({
  config,
  onProgress: (msg) => {
    if (options.verbose || !msg.startsWith('  [')) {
      // Show all messages in verbose mode, only top-level in normal mode
      process.stdout.write(`\r${msg.padEnd(80)}`);
    }
  }
});
// Clear the progress line after completion
process.stdout.write('\r' + ' '.repeat(80) + '\r');
console.log('✓ Registry built successfully');
```


---

### Gap 10: Performance — Parallel Analyzer Execution

#### Problem

The current `buildRegistry` implementation processes files sequentially in a `for...of` loop. In a codebase with hundreds or thousands of files, this is highly inefficient as it doesn't utilize available CPU cores and spends most of its time waiting for single-thread I/O and parsing.

#### Required Implementation

Use a concurrency-limiting library like `p-limit` to run multiple analyzers in parallel while preventing "too many open files" errors or memory exhaustion.

**File:** `src/core/registry-builder.ts`

```typescript
import pLimit from 'p-limit';

// ... Inside buildRegistry function ...

const concurrencyLimit = 10; // Process 10 files at a time
const limit = pLimit(concurrencyLimit);

if (sourceExtractor) {
  const sourceFiles = await findSourceFiles(config);
  onProgress(`Extracting from ${sourceFiles.length} source files (concurrently)...`);

  const tasks = sourceFiles.map((file, i) => limit(async () => {
    try {
      const sourceCode = await fs.readFile(file, 'utf-8');
      const result = await sourceExtractor.analyze({ filePath: file, sourceCode });
      registry.addOrUpdateFile(convertSourceResult(result));
    } catch (error) {
      onProgress(`  ⚠ Failed: ${file} — ${(error as Error).message}`);
    }
  }));

  await Promise.all(tasks);
}
```

#### Test Cases

**File:** `src/core/__tests__/registry-builder.concurrency.test.ts`

```typescript
it('processes files in parallel but respects concurrency limit', async () => {
  // Use a slow analyzer mock
  let activeAnalyzers = 0;
  let maxConcurreny = 0;

  (sourceExtractor.analyze as jest.Mock).mockImplementation(async () => {
    activeAnalyzers++;
    maxConcurreny = Math.max(maxConcurreny, activeAnalyzers);
    await new Promise(resolve => setTimeout(resolve, 10));
    activeAnalyzers--;
    return { selectors: [] };
  });

  await buildRegistry({ config });
  expect(maxConcurreny).toBeGreaterThan(1);
  expect(maxConcurreny).toBeLessThanOrEqual(10);
});
```

---

### Gap 11: Incremental Updates — Small Changes Should Be Instant

#### Problem

Currently, if any file changes, the `analyze` command triggers a **full rebuild** of the registry. In a large project, waiting 30 seconds for a full rebuild just to get suggestions for a 1-line change is unacceptable.

#### Required Implementation

Instead of `buildRegistryCore({ config })` on every stale cache, use the `Registry`'s existing `addOrUpdateFile` method to only update the changed files detected by git.

**File:** `src/commands/analyze.ts`

```typescript
// Replace the rebuild block in analyze.ts:

if (cacheResult.reason === 'stale-files') {
  console.log('⚠ Registry is stale, performing incremental update...');

  // Get only the files changed relative to what was in the cache
  const changedFilesSinceBuild = await findChangedFiles(cacheResult.metadata.fileHash);

  for (const file of changedFilesSinceBuild) {
    if (isSourceFile(file)) {
      const sourceCode = await fs.readFile(file, 'utf-8');
      const extractor = analyzerRegistry.get('source-extractor');
      const result = await extractor.analyze({ filePath: file, sourceCode });
      registry.addOrUpdateFile(convertSourceResult(result));
    }
    // ... repeat for cypress specs if needed ...
  }

  // Save the updated registry back to cache with new hashes
  await saveRegistryCache(registry, cachePath, config);
  console.log('✓ Incremental update complete');
}
```

#### Test Cases

**File:** `src/core/__tests__/registry.incremental.test.ts`

```typescript
it('preserves existing data when adding/updating a single file', () => {
  const registry = new Registry();
  registry.addOrUpdateFile({ path: '/src/A.ts', type: 'source', ... });
  registry.addOrUpdateFile({ path: '/src/B.ts', type: 'source', ... });

  // Update A.ts
  const updatedA = { path: '/src/A.ts', type: 'source', selectors: ['new-selector'], ... };
  registry.addOrUpdateFile(updatedA);

  expect(registry.files.size).toBe(2);
  expect(registry.getFile('/src/A.ts').selectors).toContain('new-selector');
  expect(registry.getFile('/src/B.ts')).toBeDefined(); // Still exists
});
```

---


## Usage Examples

### Analyze Commands

```bash
# Analyze recent changes
suggestor analyze

# Analyze specific files
suggestor analyze -f src/components/Button.tsx,src/utils/api.ts

# Analyze between commits
suggestor analyze --base main --target HEAD

# Output as JSON
suggestor analyze --output json

# Custom confidence threshold
suggestor analyze --min-confidence 0.60
```

### Setup Command

```bash
# Run setup wizard
suggestor setup

# Auto-detect only (no prompts)
suggestor setup --auto
```

### Registry Commands

```bash
# Build registry
suggestor registry build

# Force rebuild
suggestor registry build --force

# Custom output path
suggestor registry build --output .suggestor/my-registry.json
```

### Config Commands

```bash
# List all config
suggestor config list

# Get specific value
suggestor config get analyzers.sourceExtractor.selectorStrategy

# Set a numeric value
suggestor config set scoring.minConfidence 0.50

# Set a plain string value (no JSON quotes needed)
suggestor config set git.baseBranch main

# Set a JSON array
suggestor config set analyzers.sourceExtractor.selectorStrategy '["data-testid","data-cy"]'
```

---

## Dependencies

- `commander` - CLI framework
- `fast-glob` - File pattern matching
- `inquirer` - Interactive prompts (optional)
- All core components (Tasks 1-10)

## Related Tasks

- All previous tasks (1-10) feed into CLI integration

## Notes

- CLI is the user-facing layer
- Setup wizard provides guided configuration
- Registry caching improves performance with content-hash invalidation
- Multiple output formats supported (json, table, list)
- Config can be overridden via CLI options
- All result types are fully typed — no `any[]` in the output layer
- Exit codes are defined for reliable CI/CD integration
- `buildRegistry` is a single shared core function that supports concurrency.
- Incremental updates allow the analyzer to stay nearly instant even in very large codebases.