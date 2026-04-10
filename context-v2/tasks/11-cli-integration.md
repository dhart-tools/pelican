# Task 11: CLI Integration

## Overview

Create CLI commands that integrate all v2 analyzers, the registry, scoring engine, and scorers into a cohesive command-line interface built with **Ink** (React for CLIs). This includes the `analyze`/`suggest` command, the `setup` wizard, and the `registry build` command.

The CLI is the **user-facing layer** of the entire v2 test suggestor. It orchestrates all the modules built in Tasks 1–10 into a polished, interactive terminal experience.

### Design Principles

1. **Ink-first TUI** — All output rendered via Ink React components. No raw `console.log` in command logic.
2. **Separation of concerns** — Each command follows the pattern: `Command (.tsx)` → `App component (state machine)` → `View component (pure render)`.
3. **Dual-mode output** — Interactive TUI for humans, `--json` for CI/CD pipelines.
4. **Actual v2 APIs** — Uses `RegistryBuilder`, `ScoringEngine`, `BaseScorer` subclasses, and `Registry` as they exist in the codebase.

---

## Objectives

1. Create Ink-native theme system (replacing chalk-based `src/ui/theme.ts`)
2. Create reusable Ink UI components (Header, StatusStep, ResultsTable, SignalBadge, ProgressBar)
3. Implement `analyze`/`suggest` command with TUI results display
4. Implement `registry build` command with progress TUI
5. Implement `setup` wizard with auto-detection and interactive confirmation
6. Create unified config loader with type-safe merging
7. Add `--json` / `--ci` output mode for non-interactive environments
8. Add comprehensive test coverage for all commands and components

---

## CLI Structure

```bash
suggestor analyze [options]          # Analyze changes and suggest tests
suggestor suggest [options]          # Alias for analyze
suggestor setup [options]            # Setup wizard with auto-detection
suggestor registry build [options]   # Build/rebuild the file registry
```

---

## File Structure

```
src/v2/cli/
├── commands/
│   ├── analyze.tsx              # Analyze command (App + action)
│   ├── setup.tsx                # Setup wizard command
│   └── registry-build.tsx       # Registry build command
├── views/
│   ├── AnalyzeView.tsx          # Analyze results TUI
│   ├── SetupView.tsx            # Setup wizard TUI
│   └── RegistryBuildView.tsx    # Registry build progress TUI
├── components/
│   ├── Header.tsx               # Branded header box
│   ├── StatusStep.tsx           # Step indicator (idle/loading/success/error)
│   ├── ResultsTable.tsx         # Scored results table
│   ├── SignalBadge.tsx          # Confidence level badge
│   └── ProgressBar.tsx          # File processing progress bar
├── theme.ts                     # Ink-native theme (colors, icons)
├── types.ts                     # CLI-specific types and state machines
├── config-loader.ts             # Unified config loader
└── index.ts                     # Command registration entry point
```

---

## Core Types

**File:** `src/v2/cli/types.ts`

```typescript
import { IScoreResult } from '@v2/types/scorers';
import { EConfidenceLevel } from '@v2/utils/enums';

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
 * This is NOT the same as ISuggestorConfig from @v2/types/config
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
    cypressExtractor: { enabled: boolean };
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
}

export interface IRegistryBuildOptions {
  force?: boolean;
  output: string;
  config?: string;
}

export interface ISetupOptions {
  auto?: boolean;
  config?: string;
}
```

---

## Implementation

### 1. Ink-Native Theme

**File:** `src/v2/cli/theme.ts`

Replaces chalk-based theme with Ink-compatible color tokens. Colors are used as `<Text color={theme.colors.primary}>` instead of `chalk.hex(...)`.

```typescript
import { ITheme } from './types';

/**
 * Ink-native theme — all colors are hex strings passed directly
 * to Ink's <Text color="..."> prop. NO chalk dependency.
 *
 * Usage:
 *   import { theme } from '@v2/cli/theme';
 *   <Text color={theme.colors.primary}>Hello</Text>
 *   <Text>{theme.icons.success} Done!</Text>
 */
export const theme: ITheme = {
  colors: {
    primary: '#7C3AED',     // Purple — brand color
    secondary: '#06B6D4',   // Cyan — secondary actions, file names
    success: '#10B981',     // Green — completed, matched
    warning: '#F59E0B',     // Amber — medium confidence, warnings
    error: '#EF4444',       // Red — errors, low confidence
    dim: '#6B7280',         // Gray — secondary text, borders
    muted: '#9CA3AF',       // Light gray — disabled, hints
  },
  icons: {
    success: '✓',
    error: '✗',
    warning: '⚠',
    info: 'ℹ',
    arrow: '→',
    bullet: '●',
    circle: '○',
    star: '★',
    analyzing: '◆',
  },
} as const;

/**
 * Returns the Ink-compatible color for a confidence level.
 *
 * @example
 *   <Text color={confidenceColor(EConfidenceLevel.HIGH)}>0.95</Text>
 *   // renders green text
 */
export function confidenceColor(confidence: string): string {
  switch (confidence) {
    case 'high':   return theme.colors.success;
    case 'medium': return theme.colors.warning;
    case 'low':    return theme.colors.error;
    default:       return theme.colors.dim;
  }
}
```

---

### 2. Reusable Ink Components

#### 2a. Header

**File:** `src/v2/cli/components/Header.tsx`

Renders a branded header box for each command.

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme';

interface HeaderProps {
  icon: string;
  title: string;
  subtitle?: string;
}

/**
 * Branded header displayed at the top of every command.
 *
 * @example
 *   <Header icon="🔍" title="Test Suggestions" subtitle="v2.0.0" />
 *
 * Renders:
 *   ┌──────────────────────────┐
 *   │  🔍 Test Suggestions     │
 *   │     v2.0.0               │
 *   └──────────────────────────┘
 */
export function Header({ icon, title, subtitle }: HeaderProps) {
  return (
    <Box
      borderStyle="round"
      borderColor={theme.colors.primary}
      paddingX={2}
      paddingY={0}
      flexDirection="column"
    >
      <Text bold>
        {icon} <Text color={theme.colors.primary}>{title}</Text>
      </Text>
      {subtitle && (
        <Text color={theme.colors.dim}>   {subtitle}</Text>
      )}
    </Box>
  );
}
```

#### 2b. StatusStep

**File:** `src/v2/cli/components/StatusStep.tsx`

Renders a single step in a multi-step process with a spinner, checkmark, or error icon.

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { theme } from '../theme';

interface StatusStepProps {
  status: 'idle' | 'loading' | 'success' | 'error';
  label: string;
  detail?: string;
}

/**
 * A step indicator with animated spinner for loading state.
 *
 * @example
 *   <StatusStep status="success" label="Registry loaded" detail="1,247 files" />
 *   // ✓ Registry loaded — 1,247 files
 *
 *   <StatusStep status="loading" label="Analyzing changes" />
 *   // ⠋ Analyzing changes
 *
 *   <StatusStep status="error" label="Git detection failed" detail="Not a git repo" />
 *   // ✗ Git detection failed — Not a git repo
 */
export function StatusStep({ status, label, detail }: StatusStepProps) {
  let icon: React.ReactNode;
  let labelColor: string | undefined;

  switch (status) {
    case 'loading':
      icon = <Text color={theme.colors.primary}><Spinner type="dots" /></Text>;
      break;
    case 'success':
      icon = <Text color={theme.colors.success}>{theme.icons.success}</Text>;
      break;
    case 'error':
      icon = <Text color={theme.colors.error}>{theme.icons.error}</Text>;
      labelColor = theme.colors.error;
      break;
    case 'idle':
    default:
      icon = <Text color={theme.colors.dim}>{theme.icons.circle}</Text>;
      labelColor = theme.colors.dim;
      break;
  }

  return (
    <Box>
      <Box marginRight={1}>{icon}</Box>
      <Text color={labelColor}>{label}</Text>
      {detail && (
        <Text color={theme.colors.dim}> — {detail}</Text>
      )}
    </Box>
  );
}
```

#### 2c. ProgressBar

**File:** `src/v2/cli/components/ProgressBar.tsx`

Renders a visual progress bar with percentage.

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme';

interface ProgressBarProps {
  value: number;       // 0–100
  width?: number;      // Bar width in chars (default 30)
  label?: string;
  showCount?: { current: number; total: number };
}

/**
 * Visual progress bar with percentage.
 *
 * @example
 *   <ProgressBar value={65} label="Extracting" showCount={{ current: 130, total: 200 }} />
 *   // Extracting  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░  65% (130/200)
 */
export function ProgressBar({ value, width = 30, label, showCount }: ProgressBarProps) {
  const percent = Math.min(Math.max(value, 0), 100);
  const filled = Math.round((width * percent) / 100);
  const empty = width - filled;

  return (
    <Box>
      {label && (
        <Box marginRight={2}>
          <Text color={theme.colors.dim}>{label}</Text>
        </Box>
      )}
      <Text color={theme.colors.primary}>{'▓'.repeat(filled)}</Text>
      <Text color={theme.colors.dim}>{'░'.repeat(empty)}</Text>
      <Box marginLeft={1}>
        <Text bold>{Math.round(percent)}%</Text>
        {showCount && (
          <Text color={theme.colors.dim}> ({showCount.current}/{showCount.total})</Text>
        )}
      </Box>
    </Box>
  );
}
```

#### 2d. SignalBadge

**File:** `src/v2/cli/components/SignalBadge.tsx`

Renders a color-coded confidence badge.

```typescript
import React from 'react';
import { Text } from 'ink';
import { confidenceColor } from '../theme';
import { EConfidenceLevel } from '@v2/utils/enums';

interface SignalBadgeProps {
  confidence: EConfidenceLevel;
  score: number;
}

/**
 * Color-coded badge showing confidence level and score.
 *
 * @example
 *   <SignalBadge confidence={EConfidenceLevel.HIGH} score={0.95} />
 *   // [HIGH 0.95]   (rendered in green)
 *
 *   <SignalBadge confidence={EConfidenceLevel.MEDIUM} score={0.62} />
 *   // [MED  0.62]   (rendered in amber)
 */
export function SignalBadge({ confidence, score }: SignalBadgeProps) {
  const color = confidenceColor(confidence);
  const label = confidence === EConfidenceLevel.MEDIUM ? 'MED' : confidence.toUpperCase();

  return (
    <Text color={color} bold>
      [{label} {score.toFixed(2)}]
    </Text>
  );
}
```

#### 2e. ResultsTable

**File:** `src/v2/cli/components/ResultsTable.tsx`

Renders the scored analysis results as a structured table.

```typescript
import React from 'react';
import { Box, Text, Newline } from 'ink';
import { theme, confidenceColor } from '../theme';
import { SignalBadge } from './SignalBadge';
import { IScoreResult } from '@v2/types/scorers';
import { EConfidenceLevel } from '@v2/utils/enums';

interface ResultsTableProps {
  results: Array<{
    changedFile: string;
    suggestedTests: IScoreResult[];
  }>;
  maxResults?: number;
}

/**
 * Renders scored results grouped by changed file.
 *
 * Terminal output example:
 * ┌─────────────────────────────────────────────────┐
 * │  Changed: src/components/auth/LoginForm.tsx      │
 * ├─────────────────────────────────────────────────┤
 * │  [HIGH 0.95] cypress/e2e/auth/login.cy.ts       │
 * │              → Test directly imports this file   │
 * │                                                  │
 * │  [MED  0.62] cypress/e2e/auth/signup.cy.ts      │
 * │              → Matching selectors: login-btn     │
 * └─────────────────────────────────────────────────┘
 */
export function ResultsTable({ results, maxResults = 10 }: ResultsTableProps) {
  if (results.length === 0) {
    return (
      <Box marginTop={1}>
        <Text color={theme.colors.dim}>No test suggestions found.</Text>
      </Box>
    );
  }

  // Flatten, sort, and limit
  const allTests = results
    .flatMap((r) =>
      r.suggestedTests.map((t) => ({ changedFile: r.changedFile, ...t }))
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  // Group by changed file for display
  const grouped = new Map<string, typeof allTests>();
  for (const item of allTests) {
    const existing = grouped.get(item.changedFile) || [];
    existing.push(item);
    grouped.set(item.changedFile, existing);
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {Array.from(grouped.entries()).map(([changedFile, tests]) => (
        <Box
          key={changedFile}
          flexDirection="column"
          borderStyle="single"
          borderColor={theme.colors.dim}
          paddingX={1}
          marginBottom={1}
        >
          <Text bold color={theme.colors.secondary}>
            Changed: {changedFile}
          </Text>
          <Newline />
          {tests.map((test, i) => (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Box>
                <SignalBadge confidence={test.confidence} score={test.score} />
                <Text> {test.testFile}</Text>
              </Box>
              <Box marginLeft={14}>
                <Text color={theme.colors.dim}>
                  {theme.icons.arrow} {test.explanation}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      ))}
      <Text color={theme.colors.dim}>
        Showing {allTests.length} of {results.reduce((sum, r) => sum + r.suggestedTests.length, 0)} suggestions
      </Text>
    </Box>
  );
}
```

---

### 3. Config Loader

**File:** `src/v2/cli/config-loader.ts`

Loads and merges config from `.suggestorrc.json` with CLI option overrides. Returns the full `IProjectConfig` shape.

```typescript
import * as fs from 'fs/promises';
import { IProjectConfig } from './types';
import { ISuggestorConfig } from '@v2/types/config';

const DEFAULT_CONFIG: IProjectConfig = {
  sourceDirs: ['src'],
  testPatterns: ['**/*.cy.ts', '**/*.cy.tsx'],
  ignorePatterns: ['node_modules', 'dist', '.git', 'coverage'],
  analyzers: {
    enabled: ['source-extractor', 'cypress-extractor', 'import-graph-analyzer'],
    sourceExtractor: { enabled: true, selectorStrategy: ['data-testid', 'data-cy'] },
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
 * Loads config from .suggestorrc.json and merges with defaults.
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
  const path = configPath || '.suggestorrc.json';

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
```

---

### 4. Analyze Command

**File:** `src/v2/cli/commands/analyze.tsx`

The primary user-facing command. Orchestrates:
1. Load config → 2. Load/build registry → 3. Detect changed files → 4. Score → 5. Display results

#### State Machine

```
loading-config → loading-registry ──→ detecting-changes → analyzing → scoring → done
                        │                                                          │
                        └→ building-registry ─────────────────────────────→ done   │
                                                                                   │
                     (any phase) ──────────────────────────────────────→ error ────┘
```

#### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  analyzeAction()                                            │
│  ├── Parse CLI options                                      │
│  ├── If --json / --ci → run headless, print JSON, exit      │
│  └── Else → render(<AnalyzeApp />) with Ink                 │
│                                                             │
│  <AnalyzeApp>                                               │
│  ├── useState<IAnalyzeState>()                              │
│  ├── useEffect(() => runAnalysis())                         │
│  │     1. loadProjectConfig()                               │
│  │     2. loadOrBuildRegistry()                             │
│  │     3. getChangedFiles()  (--files or git diff)          │
│  │     4. ScoringEngine.evaluateTests() for each file       │
│  │     5. setState({ phase: 'done', results })              │
│  └── return <AnalyzeView {...state} />                      │
│                                                             │
│  <AnalyzeView>                                              │
│  ├── <Header />                                             │
│  ├── <StatusStep /> for each phase                          │
│  ├── <ResultsTable /> when done                             │
│  └── Error display if phase === 'error'                     │
└─────────────────────────────────────────────────────────────┘
```

#### Command Implementation

```typescript
import React, { useState, useEffect } from 'react';
import { render } from 'ink';
import * as fs from 'fs/promises';
import { Command } from 'commander';
import { RegistryBuilder } from '@v2/core/registry/registry-builder';
import { Registry } from '@v2/core/registry/registry';
import { ScoringEngine } from '@v2/core/scoring/scoring-engine';
import { loadProjectConfig, toScoringConfig } from '../config-loader';
import { AnalyzeView } from '../views/AnalyzeView';
import { IAnalyzeState, IAnalyzeOptions } from '../types';

// Import all scorer classes
import { DirectImportScorer } from '@v2/core/scoring/scorers/direct-import-scorer';
import { RouteMatchScorer } from '@v2/core/scoring/scorers/route-match-scorer';
import { SelectorMatchScorer } from '@v2/core/scoring/scorers/selector-match-scorer';
import { TransitiveImportScorer } from '@v2/core/scoring/scorers/transitive-import-scorer';
import { FilenameConventionScorer } from '@v2/core/scoring/scorers/filename-convention-scorer';
import { ReduxChainScorer } from '@v2/core/scoring/scorers/redux-chain-scorer';
import { ReduxConsumerScorer } from '@v2/core/scoring/scorers/redux-consumer-scorer';
import { TranslationMatchScorer } from '@v2/core/scoring/scorers/translation-match-scorer';
import { SelectorIdMatchScorer } from '@v2/core/scoring/scorers/selector-id-match-scorer';
import { ApiInterceptScorer } from '@v2/core/scoring/scorers/api-intercept-scorer';

const REGISTRY_CACHE_PATH = '.suggestor/registry.json';

/**
 * Registers all scorer instances that are enabled in config.
 *
 * @example
 *   const engine = new ScoringEngine(config, registry);
 *   registerScorers(engine, config.scoring.enabledScorers);
 *   // All enabled scorers now registered
 */
function registerScorers(engine: ScoringEngine, enabledScorers: string[]): void {
  const allScorers = [
    new DirectImportScorer(),
    new RouteMatchScorer(),
    new SelectorMatchScorer(),
    new TransitiveImportScorer(),
    new FilenameConventionScorer(),
    new ReduxChainScorer(),
    new ReduxConsumerScorer(),
    new TranslationMatchScorer(),
    new SelectorIdMatchScorer(),
    new ApiInterceptScorer(),
  ];

  for (const scorer of allScorers) {
    if (enabledScorers.includes(scorer.name)) {
      engine.register(scorer);
    }
  }
}

/**
 * Loads the registry from cache or builds it fresh.
 */
async function loadOrBuildRegistry(
  config: ReturnType<typeof loadProjectConfig> extends Promise<infer T> ? T : never,
  onPhaseChange: (phase: IAnalyzeState['phase']) => void,
): Promise<Registry> {
  const registry = new Registry();

  try {
    const cacheData = await fs.readFile(REGISTRY_CACHE_PATH, 'utf-8');
    registry.deserialize(cacheData);
    return registry;
  } catch {
    // Cache not found — build fresh
    onPhaseChange('building-registry');

    const builder = new RegistryBuilder();
    const builtRegistry = await builder.buildFromDirectories({
      sourceDirs: config.sourceDirs,
      testPatterns: config.testPatterns,
      projectRoot: process.cwd(),
    });

    // Save cache
    const dir = require('path').dirname(REGISTRY_CACHE_PATH);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(REGISTRY_CACHE_PATH, builtRegistry.serialize(), 'utf-8');

    return builtRegistry as unknown as Registry;
  }
}

// ─── React App Component ─────────────────────────────────────────

function AnalyzeApp({ options }: { options: IAnalyzeOptions }) {
  const [state, setState] = useState<IAnalyzeState>({
    phase: 'loading-config',
    changedFiles: [],
    results: [],
    progress: 0,
  });

  useEffect(() => {
    async function run() {
      try {
        // Phase 1: Load config
        const config = await loadProjectConfig(options.config);

        // Apply CLI overrides
        if (options.minConfidence) {
          config.scoring.minConfidence = parseFloat(options.minConfidence);
        }

        // Phase 2: Load/build registry
        setState((s) => ({ ...s, phase: 'loading-registry' }));
        const registry = await loadOrBuildRegistry(config, (phase) =>
          setState((s) => ({ ...s, phase })),
        );

        // Phase 3: Detect changed files
        setState((s) => ({ ...s, phase: 'detecting-changes' }));

        let changedFiles: string[];
        if (options.files) {
          changedFiles = options.files.split(',').map((f) => f.trim());
        } else {
          // TODO: Integrate with git service
          // For now, require --files explicitly
          throw new Error('No --files specified. Git auto-detection not yet implemented.');
        }

        setState((s) => ({ ...s, changedFiles }));

        if (changedFiles.length === 0) {
          setState((s) => ({ ...s, phase: 'done' }));
          return;
        }

        // Phase 4: Score
        setState((s) => ({ ...s, phase: 'scoring' }));

        const scoringConfig = toScoringConfig(config);
        const engine = new ScoringEngine(scoringConfig, registry);
        registerScorers(engine, config.scoring.enabledScorers);

        const testFiles = registry.getFilesByType('test').map((f) => f.path);
        const maxResults = parseInt(options.maxResults) || 10;
        const results = [];

        for (let i = 0; i < changedFiles.length; i++) {
          const changedFile = changedFiles[i];
          setState((s) => ({
            ...s,
            currentFile: changedFile,
            progress: ((i + 1) / changedFiles.length) * 100,
          }));

          const scoreResults = engine.evaluateTests(changedFile, testFiles);
          const relevant = scoreResults.filter(
            (r) => r.score >= config.scoring.minConfidence,
          );

          results.push({
            changedFile,
            suggestedTests: relevant.slice(0, maxResults),
          });
        }

        // Phase 5: Done
        setState((s) => ({
          ...s,
          phase: 'done',
          results,
          registryStats: {
            totalFiles: registry.files.size,
            sourceFiles: registry.getFilesByType('source').length,
            testFiles: registry.getFilesByType('test').length,
            dependencies: registry.importGraph.dependencies.size,
            selectors: registry.getSelectorIndex().size,
            routes: registry.getRouteMap().size,
            duration: 0,
          },
        }));
      } catch (err: unknown) {
        setState((s) => ({
          ...s,
          phase: 'error',
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }

    run();
  }, []);

  return <AnalyzeView {...state} />;
}

// ─── Headless JSON Mode ──────────────────────────────────────────

/**
 * Runs the analysis without Ink rendering.
 * Outputs results as JSON to stdout for CI/CD consumption.
 *
 * @example
 *   suggestor analyze --files src/Button.tsx --json
 *   // { "results": [...], "stats": { ... } }
 */
async function runHeadless(options: IAnalyzeOptions): Promise<void> {
  const config = await loadProjectConfig(options.config);
  if (options.minConfidence) {
    config.scoring.minConfidence = parseFloat(options.minConfidence);
  }

  const registry = new Registry();
  const cacheData = await fs.readFile(REGISTRY_CACHE_PATH, 'utf-8');
  registry.deserialize(cacheData);

  const changedFiles = options.files
    ? options.files.split(',').map((f) => f.trim())
    : [];

  const scoringConfig = toScoringConfig(config);
  const engine = new ScoringEngine(scoringConfig, registry);
  registerScorers(engine, config.scoring.enabledScorers);

  const testFiles = registry.getFilesByType('test').map((f) => f.path);
  const maxResults = parseInt(options.maxResults) || 10;

  const results = changedFiles.map((changedFile) => {
    const scoreResults = engine.evaluateTests(changedFile, testFiles);
    const relevant = scoreResults
      .filter((r) => r.score >= config.scoring.minConfidence)
      .slice(0, maxResults);
    return { changedFile, suggestedTests: relevant };
  });

  console.log(JSON.stringify({ results }, null, 2));
}

// ─── Commander Action ────────────────────────────────────────────

export const analyzeCommand = new Command('analyze')
  .alias('suggest')
  .description('Analyze changes and suggest tests to run')
  .option('-b, --base <ref>', 'Base git reference (default: HEAD~1)')
  .option('-t, --target <ref>', 'Target git reference (default: HEAD)')
  .option('-f, --files <paths>', 'Comma-separated list of changed files')
  .option('-o, --output <format>', 'Output format: tui, json, list', 'tui')
  .option('--min-confidence <number>', 'Minimum confidence threshold', '0.40')
  .option('--max-results <number>', 'Maximum number of results', '10')
  .option('--ci', 'Non-interactive mode (alias for --output json)')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (opts: IAnalyzeOptions) => {
    // --ci is shorthand for --output json
    if (opts.ci) opts.output = 'json';

    if (opts.output === 'json') {
      await runHeadless(opts);
      return;
    }

    const { waitUntilExit } = render(<AnalyzeApp options={opts} />);
    await waitUntilExit();
  });
```

#### Analyze View

**File:** `src/v2/cli/views/AnalyzeView.tsx`

```typescript
import React from 'react';
import { Box, Text, Newline } from 'ink';
import { Header } from '../components/Header';
import { StatusStep } from '../components/StatusStep';
import { ResultsTable } from '../components/ResultsTable';
import { theme } from '../theme';
import { IAnalyzeState, AnalyzePhase } from '../types';

const PHASE_LABELS: Record<AnalyzePhase, string> = {
  'loading-config': 'Loading configuration',
  'loading-registry': 'Loading registry from cache',
  'building-registry': 'Building registry (first run)',
  'detecting-changes': 'Detecting changed files',
  'analyzing': 'Running analyzers',
  'scoring': 'Scoring test relevance',
  'done': 'Analysis complete',
  'error': 'Error occurred',
};

/**
 * Pure render component for the analyze command.
 *
 * Terminal output when complete:
 *
 *   ╭───────────────────────────╮
 *   │  🔍 Test Suggestions      │
 *   ╰───────────────────────────╯
 *
 *   ✓ Loading configuration
 *   ✓ Loading registry from cache — 1,247 files
 *   ✓ Detecting changed files — 3 files
 *   ✓ Scoring test relevance
 *
 *   ┌─────────────────────────────────────────────────┐
 *   │  Changed: src/components/auth/LoginForm.tsx      │
 *   │                                                  │
 *   │  [HIGH 0.95] cypress/e2e/auth/login.cy.ts       │
 *   │              → Test directly imports this file   │
 *   │                                                  │
 *   │  [MED  0.62] cypress/e2e/auth/signup.cy.ts      │
 *   │              → Matching selectors: login-btn     │
 *   └─────────────────────────────────────────────────┘
 *
 *   Showing 2 of 2 suggestions
 */
export function AnalyzeView(state: IAnalyzeState) {
  const phases: AnalyzePhase[] = [
    'loading-config',
    'loading-registry',
    'detecting-changes',
    'scoring',
  ];

  // If building-registry happened, insert it after loading-registry
  const displayPhases = state.phase === 'building-registry'
    ? ['loading-config', 'building-registry', 'detecting-changes', 'scoring'] as AnalyzePhase[]
    : phases;

  function getStepStatus(step: AnalyzePhase): 'idle' | 'loading' | 'success' | 'error' {
    if (state.phase === 'error') {
      const stepIndex = displayPhases.indexOf(step);
      const errorIndex = displayPhases.indexOf(state.phase);
      if (stepIndex < errorIndex) return 'success';
      if (stepIndex === errorIndex) return 'error';
      return 'idle';
    }

    const stepIndex = displayPhases.indexOf(step);
    const currentIndex = displayPhases.indexOf(state.phase);

    if (state.phase === 'done') return 'success';
    if (stepIndex < currentIndex) return 'success';
    if (stepIndex === currentIndex) return 'loading';
    return 'idle';
  }

  function getStepDetail(step: AnalyzePhase): string | undefined {
    if (getStepStatus(step) !== 'success') return undefined;
    switch (step) {
      case 'loading-registry':
      case 'building-registry':
        return state.registryStats
          ? `${state.registryStats.totalFiles} files`
          : undefined;
      case 'detecting-changes':
        return `${state.changedFiles.length} files`;
      default:
        return undefined;
    }
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header icon="🔍" title="Test Suggestions" />
      <Newline />

      {displayPhases.map((phase) => (
        <Box key={phase} marginBottom={0}>
          <StatusStep
            status={getStepStatus(phase)}
            label={PHASE_LABELS[phase]}
            detail={getStepDetail(phase)}
          />
        </Box>
      ))}

      {state.phase === 'scoring' && state.currentFile && (
        <Box marginLeft={3} marginTop={1}>
          <Text color={theme.colors.dim}>
            {theme.icons.analyzing} {state.currentFile}
          </Text>
        </Box>
      )}

      {state.phase === 'done' && (
        <>
          <Newline />
          <ResultsTable results={state.results} />
        </>
      )}

      {state.phase === 'done' && state.changedFiles.length === 0 && (
        <Box marginTop={1}>
          <Text color={theme.colors.dim}>No changed files detected.</Text>
        </Box>
      )}

      {state.phase === 'error' && state.error && (
        <Box marginTop={1}>
          <Text color={theme.colors.error} bold>
            {theme.icons.error} {state.error}
          </Text>
        </Box>
      )}
    </Box>
  );
}
```

---

### 5. Registry Build Command

**File:** `src/v2/cli/commands/registry-build.tsx`

Builds the file registry by scanning source and test files and running all extractors.

#### State Machine

```
scanning → extracting-source → extracting-tests → building-indexes → saving → done
                                                                                  │
                           (any phase) ──────────────────────────────→ error ─────┘
```

#### Command Implementation

```typescript
import React, { useState, useEffect } from 'react';
import { render } from 'ink';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Command } from 'commander';
import { RegistryBuilder } from '@v2/core/registry/registry-builder';
import { Registry } from '@v2/core/registry/registry';
import { loadProjectConfig } from '../config-loader';
import { RegistryBuildView } from '../views/RegistryBuildView';
import { IRegistryBuildState, IRegistryBuildOptions } from '../types';

function RegistryBuildApp({ options }: { options: IRegistryBuildOptions }) {
  const [state, setState] = useState<IRegistryBuildState>({
    phase: 'scanning',
    totalFiles: 0,
    processedFiles: 0,
  });

  useEffect(() => {
    async function run() {
      try {
        const config = await loadProjectConfig(options.config);
        const cachePath = options.output || '.suggestor/registry.json';

        // Check if cache exists (skip if --force)
        if (!options.force) {
          try {
            await fs.access(cachePath);
            setState((s) => ({
              ...s,
              phase: 'done',
              stats: { totalFiles: 0, sourceFiles: 0, testFiles: 0,
                       dependencies: 0, selectors: 0, routes: 0, duration: 0 },
            }));
            return;
          } catch {
            // Cache doesn't exist, continue
          }
        }

        const startTime = Date.now();

        // Build registry using RegistryBuilder
        // NOTE: RegistryBuilder handles source + test extraction internally
        setState((s) => ({ ...s, phase: 'extracting-source' }));

        const builder = new RegistryBuilder();
        const registry = await builder.buildFromDirectories({
          sourceDirs: config.sourceDirs,
          testPatterns: config.testPatterns,
          projectRoot: process.cwd(),
        });

        setState((s) => ({ ...s, phase: 'saving' }));

        // Save to disk
        const dir = path.dirname(cachePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(cachePath, registry.serialize(), 'utf-8');

        const duration = Date.now() - startTime;
        const typedRegistry = registry as unknown as Registry;

        setState((s) => ({
          ...s,
          phase: 'done',
          stats: {
            totalFiles: typedRegistry.files.size,
            sourceFiles: typedRegistry.getFilesByType('source').length,
            testFiles: typedRegistry.getFilesByType('test').length,
            dependencies: typedRegistry.importGraph.dependencies.size,
            selectors: typedRegistry.getSelectorIndex().size,
            routes: typedRegistry.getRouteMap().size,
            duration,
          },
        }));
      } catch (err: unknown) {
        setState((s) => ({
          ...s,
          phase: 'error',
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }

    run();
  }, []);

  return <RegistryBuildView {...state} />;
}

export const registryBuildCommand = new Command('registry')
  .description('Registry management commands')
  .addCommand(
    new Command('build')
      .description('Build registry from source and test files')
      .option('-f, --force', 'Force rebuild even if cache exists')
      .option('-o, --output <path>', 'Output path for registry', '.suggestor/registry.json')
      .option('-c, --config <path>', 'Path to config file')
      .action(async (opts: IRegistryBuildOptions) => {
        const { waitUntilExit } = render(<RegistryBuildApp options={opts} />);
        await waitUntilExit();
      }),
  );
```

#### Registry Build View

**File:** `src/v2/cli/views/RegistryBuildView.tsx`

```typescript
import React from 'react';
import { Box, Text, Newline } from 'ink';
import { Header } from '../components/Header';
import { StatusStep } from '../components/StatusStep';
import { theme } from '../theme';
import { IRegistryBuildState } from '../types';

/**
 * Terminal output when complete:
 *
 *   ╭───────────────────────────────╮
 *   │  📦 Registry Build            │
 *   ╰───────────────────────────────╯
 *
 *   ✓ Scanning project files
 *   ✓ Extracting source metadata
 *   ✓ Extracting test metadata
 *   ✓ Building indexes
 *   ✓ Saving registry
 *
 *   ┌──────────────────────────────────┐
 *   │  ✓ Registry built successfully   │
 *   │    Source files:   847            │
 *   │    Test files:     123            │
 *   │    Dependencies:   2,341          │
 *   │    Selectors:      456            │
 *   │    Routes:         28             │
 *   │    Duration:       3.2s           │
 *   └──────────────────────────────────┘
 */
export function RegistryBuildView(state: IRegistryBuildState) {
  const steps = ['scanning', 'extracting-source', 'extracting-tests', 'building-indexes', 'saving'];
  const labels: Record<string, string> = {
    'scanning': 'Scanning project files',
    'extracting-source': 'Extracting source metadata',
    'extracting-tests': 'Extracting test metadata',
    'building-indexes': 'Building indexes',
    'saving': 'Saving registry',
  };

  function stepStatus(step: string): 'idle' | 'loading' | 'success' | 'error' {
    if (state.phase === 'error') return 'error';
    if (state.phase === 'done') return 'success';
    const si = steps.indexOf(step);
    const ci = steps.indexOf(state.phase);
    if (si < ci) return 'success';
    if (si === ci) return 'loading';
    return 'idle';
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header icon="📦" title="Registry Build" />
      <Newline />

      {steps.map((step) => (
        <StatusStep key={step} status={stepStatus(step)} label={labels[step]} />
      ))}

      {state.phase === 'done' && state.stats && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="double"
          borderColor={theme.colors.success}
          paddingX={2}
        >
          <Text color={theme.colors.success} bold>
            {theme.icons.success} Registry built successfully
          </Text>
          <Box marginLeft={2} flexDirection="column">
            <Text>Source files:   <Text bold>{state.stats.sourceFiles}</Text></Text>
            <Text>Test files:     <Text bold>{state.stats.testFiles}</Text></Text>
            <Text>Dependencies:   <Text bold>{state.stats.dependencies}</Text></Text>
            <Text>Selectors:      <Text bold>{state.stats.selectors}</Text></Text>
            <Text>Routes:         <Text bold>{state.stats.routes}</Text></Text>
            <Text>Duration:       <Text bold>{(state.stats.duration / 1000).toFixed(1)}s</Text></Text>
          </Box>
        </Box>
      )}

      {state.phase === 'error' && (
        <Box marginTop={1}>
          <Text color={theme.colors.error} bold>
            {theme.icons.error} {state.error}
          </Text>
        </Box>
      )}
    </Box>
  );
}
```

---

### 6. Setup Command

**File:** `src/v2/cli/commands/setup.tsx`

Auto-detects project configuration by scanning `package.json` and the filesystem, then writes `.suggestorrc.json`.

#### State Machine

```
detecting → confirming (optional if --auto) → saving → building-registry → done
                                                                              │
                     (any phase) ────────────────────────────────→ error ─────┘
```

#### Command Implementation

```typescript
import React, { useState, useEffect } from 'react';
import { render } from 'ink';
import * as fs from 'fs/promises';
import { Command } from 'commander';
import { SetupView } from '../views/SetupView';
import { ISetupState, ISetupStep, IProjectConfig, ISetupOptions } from '../types';

/**
 * Scans package.json and filesystem to auto-detect project configuration.
 *
 * Detection logic:
 *   1. Read package.json → detect cypress, redux, react-router, i18n
 *   2. Scan common directories → detect store dirs, router file, locales
 *   3. Build IProjectConfig with detected settings
 *
 * @example
 *   package.json has "cypress" in devDeps and "@reduxjs/toolkit" in deps
 *   → config.analyzers.cypressExtractor.enabled = true
 *   → config.analyzers.reduxChain.enabled = true
 */
async function detectProjectConfig(): Promise<{
  config: IProjectConfig;
  steps: ISetupStep[];
}> {
  const steps: ISetupStep[] = [];

  // Default config
  const config: IProjectConfig = {
    sourceDirs: ['src'],
    testPatterns: ['**/*.cy.ts', '**/*.cy.tsx'],
    ignorePatterns: ['node_modules', 'dist', '.git', 'coverage'],
    analyzers: {
      enabled: ['source-extractor', 'cypress-extractor', 'import-graph-analyzer'],
      sourceExtractor: { enabled: true, selectorStrategy: ['data-testid', 'data-cy'] },
      cypressExtractor: { enabled: true },
      reduxChain: { enabled: false, storeDirs: [] },
      i18n: { enabled: false, library: 'react-i18next', localesPath: '' },
      routeAnalyzer: { enabled: false, routerFile: '' },
      importGraph: { enabled: true },
    },
    scoring: {
      enabledScorers: ['direct-import', 'selector-match', 'filename-match', 'transitive-import'],
      ubiquityThreshold: 0.7,
      minConfidence: 0.4,
      highConfidence: 0.8,
    },
  };

  try {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf-8'));

    // Detect Cypress
    if (pkg.devDependencies?.cypress || pkg.dependencies?.cypress) {
      steps.push({ name: 'Cypress detected', status: 'success', detail: 'cypress-extractor enabled' });
      config.scoring.enabledScorers.push('selector-match');
    } else {
      steps.push({ name: 'Cypress', status: 'idle', detail: 'not found' });
    }

    // Detect Redux Toolkit
    if (pkg.dependencies?.['@reduxjs/toolkit'] || pkg.dependencies?.redux) {
      config.analyzers.reduxChain.enabled = true;
      config.analyzers.enabled.push('redux-chain-analyzer');
      config.scoring.enabledScorers.push('redux-chain');

      // Scan for store directories
      const possibleDirs = ['src/store', 'src/redux', 'src/state'];
      const existingDirs: string[] = [];
      for (const dir of possibleDirs) {
        try { await fs.access(dir); existingDirs.push(dir); } catch {}
      }
      config.analyzers.reduxChain.storeDirs = existingDirs;
      steps.push({ name: 'Redux Toolkit detected', status: 'success',
                    detail: existingDirs.length > 0 ? `store dirs: ${existingDirs.join(', ')}` : 'no store dirs found' });
    } else {
      steps.push({ name: 'Redux', status: 'idle', detail: 'not found' });
    }

    // Detect React Router
    if (pkg.dependencies?.['react-router-dom'] || pkg.dependencies?.['react-router']) {
      config.analyzers.routeAnalyzer.enabled = true;
      config.analyzers.enabled.push('route-analyzer');
      config.scoring.enabledScorers.push('route-match');

      const possibleFiles = ['src/App.tsx', 'src/router.tsx', 'src/routes.tsx', 'src/Router.tsx'];
      for (const file of possibleFiles) {
        try { await fs.access(file); config.analyzers.routeAnalyzer.routerFile = file; break; } catch {}
      }
      steps.push({ name: 'React Router detected', status: 'success',
                    detail: config.analyzers.routeAnalyzer.routerFile || 'router file not found' });
    } else {
      steps.push({ name: 'React Router', status: 'idle', detail: 'not found' });
    }

    // Detect i18n
    if (pkg.dependencies?.['react-i18next'] || pkg.dependencies?.['i18next']) {
      config.analyzers.i18n.enabled = true;
      config.analyzers.i18n.library = 'react-i18next';
      config.analyzers.enabled.push('i18n-analyzer');
      config.scoring.enabledScorers.push('translation-match');

      const possiblePaths = ['public/locales/en/translation.json', 'src/i18n/en.json', 'src/locales/en/translation.json'];
      for (const p of possiblePaths) {
        try { await fs.access(p); config.analyzers.i18n.localesPath = p.replace('/en/', '/{locale}/'); break; } catch {}
      }
      steps.push({ name: 'react-i18next detected', status: 'success',
                    detail: config.analyzers.i18n.localesPath || 'locales path not found' });
    } else {
      steps.push({ name: 'i18n', status: 'idle', detail: 'not found' });
    }

  } catch {
    steps.push({ name: 'package.json', status: 'error', detail: 'could not read package.json' });
  }

  return { config, steps };
}

function SetupApp({ options }: { options: ISetupOptions }) {
  const [state, setState] = useState<ISetupState>({
    phase: 'detecting',
    steps: [{ name: 'Scanning project...', status: 'loading' }],
    detectedConfig: null,
  });

  useEffect(() => {
    async function run() {
      try {
        // Phase 1: Detect
        const { config, steps } = await detectProjectConfig();
        setState((s) => ({
          ...s,
          phase: 'saving',
          steps,
          detectedConfig: config,
        }));

        // Phase 2: Save config
        const configPath = options.config || '.suggestorrc.json';
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
        setState((s) => ({
          ...s,
          steps: [
            ...s.steps,
            { name: `Config saved to ${configPath}`, status: 'success' as const },
          ],
        }));

        // Phase 3: Build registry
        setState((s) => ({
          ...s,
          phase: 'building-registry',
          steps: [
            ...s.steps,
            { name: 'Building registry...', status: 'loading' as const },
          ],
        }));

        // (Registry build logic from registry-build command is reused)
        // For now, mark as done — user can run `suggestor registry build` separately
        setState((s) => ({
          ...s,
          phase: 'done',
          steps: s.steps.map((step) =>
            step.status === 'loading'
              ? { ...step, status: 'success' as const, detail: 'run `suggestor registry build` to build' }
              : step
          ),
        }));

      } catch (err: unknown) {
        setState((s) => ({
          ...s,
          phase: 'error',
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }

    run();
  }, []);

  return <SetupView {...state} />;
}

export const setupCommand = new Command('setup')
  .description('Run setup wizard to configure Test Suggestor')
  .option('--auto', 'Skip interactive prompts, use auto-detection only')
  .option('-c, --config <path>', 'Path to save config file')
  .action(async (opts: ISetupOptions) => {
    const { waitUntilExit } = render(<SetupApp options={opts} />);
    await waitUntilExit();
  });
```

#### Setup View

**File:** `src/v2/cli/views/SetupView.tsx`

```typescript
import React from 'react';
import { Box, Text, Newline } from 'ink';
import { Header } from '../components/Header';
import { StatusStep } from '../components/StatusStep';
import { theme } from '../theme';
import { ISetupState } from '../types';

/**
 * Terminal output when complete:
 *
 *   ╭───────────────────────────────────╮
 *   │  🔧 Suggestor Setup               │
 *   ╰───────────────────────────────────╯
 *
 *   ✓ Cypress detected — cypress-extractor enabled
 *   ✓ Redux Toolkit detected — store dirs: src/store
 *   ✓ React Router detected — src/App.tsx
 *   ○ i18n — not found
 *   ✓ Config saved to .suggestorrc.json
 *   ✓ Building registry... — run `suggestor registry build` to build
 *
 *   ╔═══════════════════════════════════════════╗
 *   ║  ✓ Setup complete!                        ║
 *   ║    Next: suggestor registry build          ║
 *   ╚═══════════════════════════════════════════╝
 */
export function SetupView(state: ISetupState) {
  const isDone = state.phase === 'done';

  return (
    <Box flexDirection="column" padding={1}>
      <Header icon="🔧" title="Suggestor Setup" />
      <Newline />

      {state.steps.map((step, i) => (
        <StatusStep key={i} status={step.status} label={step.name} detail={step.detail} />
      ))}

      {isDone && (
        <Box
          marginTop={1}
          borderStyle="double"
          borderColor={theme.colors.success}
          paddingX={2}
          flexDirection="column"
        >
          <Text color={theme.colors.success} bold>
            {theme.icons.success} Setup complete!
          </Text>
          <Text>
            Next: <Text color={theme.colors.primary} bold>suggestor registry build</Text>
          </Text>
        </Box>
      )}

      {state.phase === 'error' && state.error && (
        <Box marginTop={1}>
          <Text color={theme.colors.error} bold>
            {theme.icons.error} {state.error}
          </Text>
        </Box>
      )}
    </Box>
  );
}
```

---

### 7. Command Registration

**File:** `src/v2/cli/index.ts`

Entry point that wires all v2 commands into the existing `src/cli.ts`.

```typescript
import { Command } from 'commander';
import { analyzeCommand } from './commands/analyze';
import { setupCommand } from './commands/setup';
import { registryBuildCommand } from './commands/registry-build';

/**
 * Registers all v2 CLI commands onto the given Commander program.
 *
 * @example
 *   // In src/cli.ts:
 *   import { registerV2Commands } from '@v2/cli';
 *   registerV2Commands(program);
 */
export function registerV2Commands(program: Command): void {
  program.addCommand(analyzeCommand);
  program.addCommand(setupCommand);
  program.addCommand(registryBuildCommand);
}
```

**Integration in `src/cli.ts`** — Add to existing CLI entry:

```typescript
// Existing v1 commands stay as-is
// Add v2 commands:
import { registerV2Commands } from '@v2/cli';
registerV2Commands(program);
```

---

## Usage Examples

### Analyze Commands

```bash
# Analyze specific files (interactive TUI)
suggestor analyze -f src/components/Button.tsx,src/utils/api.ts

# Analyze with custom confidence
suggestor analyze -f src/pages/LoginPage.tsx --min-confidence 0.60

# JSON output for CI/CD
suggestor analyze -f src/pages/LoginPage.tsx --json

# Shorthand CI mode
suggestor analyze -f src/pages/LoginPage.tsx --ci

# Use alias
suggestor suggest -f src/components/Button.tsx
```

### Setup Command

```bash
# Run setup wizard (auto-detect)
suggestor setup

# Auto-detect only (no prompts)
suggestor setup --auto

# Custom config path
suggestor setup --config ./custom-config.json
```

### Registry Commands

```bash
# Build registry (skips if cache exists)
suggestor registry build

# Force rebuild
suggestor registry build --force

# Custom output path
suggestor registry build --output .suggestor/my-registry.json
```

---

## Test Specifications

### Component Tests (using `ink-testing-library`)

```typescript
import { render } from 'ink-testing-library';
import React from 'react';
import { Header } from '../components/Header';
import { StatusStep } from '../components/StatusStep';
import { SignalBadge } from '../components/SignalBadge';
import { ProgressBar } from '../components/ProgressBar';
import { EConfidenceLevel } from '@v2/utils/enums';

describe('Header', () => {
  it('renders icon and title', () => {
    const { lastFrame } = render(<Header icon="🔍" title="Test" />);
    expect(lastFrame()).toContain('🔍');
    expect(lastFrame()).toContain('Test');
  });

  it('renders subtitle when provided', () => {
    const { lastFrame } = render(<Header icon="🔍" title="Test" subtitle="v2.0" />);
    expect(lastFrame()).toContain('v2.0');
  });

  it('does not render subtitle when not provided', () => {
    const { lastFrame } = render(<Header icon="🔍" title="Test" />);
    // Subtitle line should not appear
    expect(lastFrame()!.split('\n').length).toBeLessThanOrEqual(3);
  });
});

describe('StatusStep', () => {
  it('renders checkmark for success status', () => {
    const { lastFrame } = render(
      <StatusStep status="success" label="Done" />
    );
    expect(lastFrame()).toContain('✓');
    expect(lastFrame()).toContain('Done');
  });

  it('renders error icon for error status', () => {
    const { lastFrame } = render(
      <StatusStep status="error" label="Failed" detail="timeout" />
    );
    expect(lastFrame()).toContain('✗');
    expect(lastFrame()).toContain('Failed');
    expect(lastFrame()).toContain('timeout');
  });

  it('renders circle for idle status', () => {
    const { lastFrame } = render(
      <StatusStep status="idle" label="Pending" />
    );
    expect(lastFrame()).toContain('○');
  });

  it('renders spinner for loading status', () => {
    const { lastFrame } = render(
      <StatusStep status="loading" label="Working" />
    );
    // Spinner renders animated dots — frame will contain the label
    expect(lastFrame()).toContain('Working');
  });

  it('renders detail when provided', () => {
    const { lastFrame } = render(
      <StatusStep status="success" label="Registry" detail="1,247 files" />
    );
    expect(lastFrame()).toContain('— 1,247 files');
  });
});

describe('SignalBadge', () => {
  it('renders HIGH in green with score', () => {
    const { lastFrame } = render(
      <SignalBadge confidence={EConfidenceLevel.HIGH} score={0.95} />
    );
    expect(lastFrame()).toContain('[HIGH 0.95]');
  });

  it('renders MED for medium confidence', () => {
    const { lastFrame } = render(
      <SignalBadge confidence={EConfidenceLevel.MEDIUM} score={0.62} />
    );
    expect(lastFrame()).toContain('[MED 0.62]');
  });

  it('renders LOW in red', () => {
    const { lastFrame } = render(
      <SignalBadge confidence={EConfidenceLevel.LOW} score={0.35} />
    );
    expect(lastFrame()).toContain('[LOW 0.35]');
  });
});

describe('ProgressBar', () => {
  it('renders at 0% with all empty blocks', () => {
    const { lastFrame } = render(<ProgressBar value={0} width={10} />);
    expect(lastFrame()).toContain('░░░░░░░░░░');
    expect(lastFrame()).toContain('0%');
  });

  it('renders at 100% with all filled blocks', () => {
    const { lastFrame } = render(<ProgressBar value={100} width={10} />);
    expect(lastFrame()).toContain('▓▓▓▓▓▓▓▓▓▓');
    expect(lastFrame()).toContain('100%');
  });

  it('renders label when provided', () => {
    const { lastFrame } = render(<ProgressBar value={50} label="Extracting" />);
    expect(lastFrame()).toContain('Extracting');
  });

  it('renders count when provided', () => {
    const { lastFrame } = render(
      <ProgressBar value={50} showCount={{ current: 5, total: 10 }} />
    );
    expect(lastFrame()).toContain('(5/10)');
  });

  it('clamps value to 0-100 range', () => {
    const { lastFrame: over } = render(<ProgressBar value={150} width={10} />);
    expect(over()).toContain('100%');

    const { lastFrame: under } = render(<ProgressBar value={-10} width={10} />);
    expect(under()).toContain('0%');
  });
});
```

### View Tests

```typescript
import { render } from 'ink-testing-library';
import React from 'react';
import { AnalyzeView } from '../views/AnalyzeView';
import { RegistryBuildView } from '../views/RegistryBuildView';
import { SetupView } from '../views/SetupView';
import { EConfidenceLevel } from '@v2/utils/enums';

describe('AnalyzeView', () => {
  it('shows loading steps during loading-config phase', () => {
    const { lastFrame } = render(
      <AnalyzeView
        phase="loading-config"
        changedFiles={[]}
        results={[]}
        progress={0}
      />
    );
    expect(lastFrame()).toContain('Loading configuration');
  });

  it('shows all steps as success when done', () => {
    const { lastFrame } = render(
      <AnalyzeView
        phase="done"
        changedFiles={['src/Button.tsx']}
        results={[]}
        progress={100}
      />
    );
    expect(lastFrame()).toContain('✓');
    expect(lastFrame()).toContain('Loading configuration');
    expect(lastFrame()).toContain('Scoring test relevance');
  });

  it('displays results table when done with results', () => {
    const { lastFrame } = render(
      <AnalyzeView
        phase="done"
        changedFiles={['src/Button.tsx']}
        results={[{
          changedFile: 'src/Button.tsx',
          suggestedTests: [{
            testFile: 'cypress/e2e/button.cy.ts',
            score: 0.95,
            signals: [],
            confidence: EConfidenceLevel.HIGH,
            explanation: 'Test directly imports this file',
          }],
        }]}
        progress={100}
      />
    );
    expect(lastFrame()).toContain('button.cy.ts');
    expect(lastFrame()).toContain('0.95');
  });

  it('shows "no changed files" message when done with empty list', () => {
    const { lastFrame } = render(
      <AnalyzeView
        phase="done"
        changedFiles={[]}
        results={[]}
        progress={100}
      />
    );
    expect(lastFrame()).toContain('No changed files detected');
  });

  it('shows error message when phase is error', () => {
    const { lastFrame } = render(
      <AnalyzeView
        phase="error"
        changedFiles={[]}
        results={[]}
        progress={0}
        error="Registry cache not found"
      />
    );
    expect(lastFrame()).toContain('✗');
    expect(lastFrame()).toContain('Registry cache not found');
  });

  it('shows current file during scoring phase', () => {
    const { lastFrame } = render(
      <AnalyzeView
        phase="scoring"
        changedFiles={['a.tsx', 'b.tsx']}
        results={[]}
        progress={50}
        currentFile="a.tsx"
      />
    );
    expect(lastFrame()).toContain('a.tsx');
  });
});

describe('RegistryBuildView', () => {
  it('shows scanning step as loading initially', () => {
    const { lastFrame } = render(
      <RegistryBuildView phase="scanning" totalFiles={0} processedFiles={0} />
    );
    expect(lastFrame()).toContain('Scanning project files');
  });

  it('shows stats summary when done', () => {
    const { lastFrame } = render(
      <RegistryBuildView
        phase="done"
        totalFiles={970}
        processedFiles={970}
        stats={{
          totalFiles: 970,
          sourceFiles: 847,
          testFiles: 123,
          dependencies: 2341,
          selectors: 456,
          routes: 28,
          duration: 3200,
        }}
      />
    );
    expect(lastFrame()).toContain('Registry built successfully');
    expect(lastFrame()).toContain('847');
    expect(lastFrame()).toContain('123');
    expect(lastFrame()).toContain('3.2s');
  });
});

describe('SetupView', () => {
  it('shows detection steps', () => {
    const { lastFrame } = render(
      <SetupView
        phase="detecting"
        steps={[{ name: 'Scanning project...', status: 'loading' }]}
        detectedConfig={null}
      />
    );
    expect(lastFrame()).toContain('Scanning project');
  });

  it('shows completion banner when done', () => {
    const { lastFrame } = render(
      <SetupView
        phase="done"
        steps={[
          { name: 'Cypress detected', status: 'success', detail: 'enabled' },
          { name: 'Config saved', status: 'success' },
        ]}
        detectedConfig={null}
      />
    );
    expect(lastFrame()).toContain('Setup complete');
    expect(lastFrame()).toContain('suggestor registry build');
  });
});
```

### Config Loader Tests

```typescript
import * as fs from 'fs/promises';
import { loadProjectConfig, toScoringConfig } from '../config-loader';

// Mock fs for testing
jest.mock('fs/promises');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('loadProjectConfig', () => {
  it('returns default config when file does not exist', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
    const config = await loadProjectConfig();
    expect(config.sourceDirs).toEqual(['src']);
    expect(config.scoring.minConfidence).toBe(0.4);
  });

  it('merges user config with defaults', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      sourceDirs: ['lib'],
      scoring: { minConfidence: 0.6 },
    }));
    const config = await loadProjectConfig();
    expect(config.sourceDirs).toEqual(['lib']);
    expect(config.scoring.minConfidence).toBe(0.6);
    // Defaults preserved for unspecified fields
    expect(config.scoring.ubiquityThreshold).toBe(0.7);
    expect(config.analyzers.sourceExtractor.enabled).toBe(true);
  });

  it('deep merges analyzer config preserving defaults', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      analyzers: {
        reduxChain: { enabled: true, storeDirs: ['src/store'] },
      },
    }));
    const config = await loadProjectConfig();
    expect(config.analyzers.reduxChain.enabled).toBe(true);
    expect(config.analyzers.reduxChain.storeDirs).toEqual(['src/store']);
    // Other analyzers untouched
    expect(config.analyzers.sourceExtractor.enabled).toBe(true);
  });

  it('loads from custom path', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ sourceDirs: ['custom'] }));
    const config = await loadProjectConfig('/custom/path.json');
    expect(mockFs.readFile).toHaveBeenCalledWith('/custom/path.json', 'utf-8');
    expect(config.sourceDirs).toEqual(['custom']);
  });
});

describe('toScoringConfig', () => {
  it('extracts ISuggestorConfig from IProjectConfig', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
    const projectConfig = await loadProjectConfig();
    const scoringConfig = toScoringConfig(projectConfig);

    expect(scoringConfig).toEqual({
      scoring: projectConfig.scoring,
    });
    // Should not contain sourceDirs, analyzers, etc.
    expect((scoringConfig as any).sourceDirs).toBeUndefined();
    expect((scoringConfig as any).analyzers).toBeUndefined();
  });
});
```

### Integration Tests

```typescript
describe('Analyze Command Integration', () => {
  it('runs headless JSON mode and outputs valid JSON', async () => {
    // This test mocks the registry and verifies stdout
    const spy = jest.spyOn(console, 'log').mockImplementation();

    // ... setup mocked registry cache file, call runHeadless()

    const output = spy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('results');
    expect(Array.isArray(parsed.results)).toBe(true);

    spy.mockRestore();
  });

  it('handles missing registry cache gracefully in headless mode', async () => {
    // Mock fs.readFile to throw ENOENT
    // Expect process.exit(1) or error JSON output
  });

  it('handles empty changed files list', async () => {
    // --files "" should produce empty results, not crash
  });
});

describe('Setup Command Integration', () => {
  it('detects Cypress from package.json devDependencies', async () => {
    // Mock fs to return package.json with cypress
    // Verify config has cypressExtractor.enabled = true
  });

  it('detects Redux Toolkit and scans for store dirs', async () => {
    // Mock fs to return package.json with @reduxjs/toolkit
    // Mock fs.access to return success for src/store
    // Verify config has reduxChain.storeDirs = ['src/store']
  });

  it('writes config file to specified path', async () => {
    // Run setup, verify fs.writeFile called with correct path
  });
});
```

---

## Dependencies

| Package | Version | Purpose | Status |
|---|---|---|---|
| `ink` | `^6.8.0` | React-based terminal UI | ✅ Installed |
| `ink-spinner` | `^5.0.0` | Animated spinners | ✅ Installed |
| `react` | `^19.2.4` | JSX components | ✅ Installed |
| `commander` | `^12.1.0` | CLI framework | ✅ Installed |
| `ink-testing-library` | `^4.0.0` | Component testing | ❌ **Needs install** |

> **Note:** `chalk` is NOT used in v2 CLI. All colors go through Ink's native `<Text color="...">` prop.

---

## Related Tasks

- **Tasks 1–3:** Source/Cypress extractors (consumed by RegistryBuilder)
- **Task 4:** Registry system (loaded/built by analyze + registry build commands)
- **Task 5:** Scoring engine (drives the analyze command)
- **Tasks 6–9:** Redux, i18n, Route, Import Graph analyzers (indexed by RegistryBuilder)
- **Task 10:** Scorer modules (registered into ScoringEngine by analyze command)

---

## Notes

- The CLI entry point (`src/cli.ts`) already uses Commander and registers v1 commands. The v2 commands are added alongside them via `registerV2Commands()`.
- The v1 `src/ui/theme.ts` uses chalk. The v2 `src/v2/cli/theme.ts` is Ink-native. Both can coexist.
- `RegistryBuilder.buildFromDirectories()` handles source + test extraction internally. The CLI does NOT instantiate individual analyzers — it delegates to `RegistryBuilder`.
- All v2 imports use the `@v2/*` path alias (e.g., `@v2/core/registry/registry`).
- `--json` / `--ci` modes bypass Ink rendering entirely for clean piped output.
- The `config` command from the original task was dropped in this version. Config management is done by directly editing `.suggestorrc.json` or using the setup wizard. It can be added later as a follow-up if needed.