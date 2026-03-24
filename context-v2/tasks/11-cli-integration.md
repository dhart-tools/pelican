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
      const allResults: any[] = [];

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

function outputResults(results: any[], format: string, maxResults?: number): void {
  const flatResults = results.flatMap((r) =>
    r.relevantTests.map((t: any) => ({
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
    .argument('<value>', 'Configuration value')
    .action(async (key, value) => {
      const config = await loadConfig();
      setValueByPath(config, key, JSON.parse(value));
      await fs.writeFile('.suggestorrc.json', JSON.stringify(config, null, 2));
      console.log(`✓ Set ${key} = ${value}`);
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

## Usage Examples

### Analyze Commands

```bash
# Analyze recent changes
suggestor analyze

# Analyze specific files
suggestor analyze -f src/components/Button.tsx,src/utils/api.ts

# Analyze between commits
suggestor analyze --base main --HEAD

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

# Set value
suggestor config set scoring.minConfidence 0.50
```

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
- Registry caching improves performance
- Multiple output formats supported
- Config can be overridden via CLI options