import { execFile, spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

import { Command } from 'commander';
import { render } from 'ink';
import { useInput } from 'ink';
import { Ollama } from 'ollama';
import React, { useState, useEffect, useRef } from 'react';

import { loadProjectConfig } from '@/cli/config-loader';
import { SETUP_MODELS } from '@/cli/setup-models';
import { ISetupState, ISetupStep, IProjectConfig, ISetupOptions } from '@/cli/types';
import { loadTheme } from '@/cli/user-config';
import { SetupView } from '@/cli/views/SetupView';
import { RegistryBuilder } from '@/core/registry/registry-builder';
import { loadTsConfigAliases } from '@/core/registry/tsconfig-loader';

const execFileP = promisify(execFile);

const REGISTRY_CACHE_PATH = '.pelican/registry.json';
const OLLAMA_HOST = 'http://localhost:11434';

/**
 * Persist the selected model into the project's .pelicanrc.json under
 * `rerank.ollamaModel`. Without this, setup would download the model but
 * analyze would still read DEFAULT_OLLAMA_CONFIG.model at runtime — the
 * user's choice would be silently ignored.
 */
async function persistModelChoice(configPath: string, model: string): Promise<void> {
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const cfg = JSON.parse(content);
    cfg.rerank = { ...(cfg.rerank ?? {}), enabled: true, ollamaModel: model };
    await fs.writeFile(configPath, JSON.stringify(cfg, null, 2));
  } catch {
    // Config missing or unreadable — skip silently. analyze will fall back
    // to the built-in default, which is still functional.
  }
}

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
export async function detectProjectConfig(): Promise<{
  config: IProjectConfig;
  steps: ISetupStep[];
}> {
  const steps: ISetupStep[] = [];

  const config: IProjectConfig = {
    sourceDirs: ['src'],
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
      cypressExtractor: { enabled: true },
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
        'filename-match',
        'transitive-import',
        'api-intercept',
        'colocation',
        'describe-block',
        'translation-match',
        'dependent-selector',
      ],
      ubiquityThreshold: 0.7,
      minConfidence: 0.6,
      highConfidence: 0.8,
    },
  };

  try {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf-8'));

    if (pkg.devDependencies?.cypress || pkg.dependencies?.cypress) {
      steps.push({
        name: 'cypress',
        status: 'success',
        detail: 'cypress-extractor',
        section: 'detected',
      });
      if (!config.scoring.enabledScorers.includes('selector-match')) {
        config.scoring.enabledScorers.push('selector-match');
      }
    }

    if (pkg.dependencies?.['@reduxjs/toolkit'] || pkg.dependencies?.redux) {
      config.analyzers.reduxChain.enabled = true;
      if (!config.analyzers.enabled.includes('redux-chain-analyzer')) {
        config.analyzers.enabled.push('redux-chain-analyzer');
      }
      if (!config.scoring.enabledScorers.includes('redux-chain')) {
        config.scoring.enabledScorers.push('redux-chain');
      }
      if (!config.scoring.enabledScorers.includes('redux-consumer')) {
        config.scoring.enabledScorers.push('redux-consumer');
      }

      const possibleDirs = ['src/store', 'src/redux', 'src/state'];
      const existingDirs: string[] = [];
      for (const dir of possibleDirs) {
        try {
          await fs.access(dir);
          existingDirs.push(dir);
        } catch {
          // dir not found
        }
      }
      config.analyzers.reduxChain.storeDirs = existingDirs;
      steps.push({
        name: 'redux toolkit',
        status: 'success',
        detail: existingDirs.length > 0 ? existingDirs.join(', ') : 'no store dirs',
        section: 'detected',
      });
    }

    if (pkg.dependencies?.['react-router-dom'] || pkg.dependencies?.['react-router']) {
      config.analyzers.routeAnalyzer.enabled = true;
      if (!config.analyzers.enabled.includes('route-analyzer')) {
        config.analyzers.enabled.push('route-analyzer');
      }
      if (!config.scoring.enabledScorers.includes('route-match')) {
        config.scoring.enabledScorers.push('route-match');
      }

      const possibleFiles = ['src/App.tsx', 'src/router.tsx', 'src/routes.tsx', 'src/Router.tsx'];
      for (const file of possibleFiles) {
        try {
          await fs.access(file);
          config.analyzers.routeAnalyzer.routerFile = file;
          break;
        } catch {
          // file not found
        }
      }
      steps.push({
        name: 'react router',
        status: 'success',
        detail: config.analyzers.routeAnalyzer.routerFile || 'router file not found',
        section: 'detected',
      });
    }

    if (pkg.dependencies?.['react-i18next'] || pkg.dependencies?.['i18next']) {
      config.analyzers.i18n.enabled = true;
      config.analyzers.i18n.library = 'react-i18next';

      const possiblePaths = [
        'public/locales/en/translation.json',
        'src/i18n/en.json',
        'src/locales/en/translation.json',
      ];
      for (const p of possiblePaths) {
        try {
          await fs.access(p);
          config.analyzers.i18n.localesPath = p.replace('/en/', '/{locale}/');
          break;
        } catch {
          // path not found
        }
      }
      steps.push({
        name: 'react-i18next',
        status: 'success',
        detail: config.analyzers.i18n.localesPath || 'locales path not found',
        section: 'detected',
      });
    }
  } catch {
    steps.push({
      name: 'package.json',
      status: 'error',
      detail: 'could not read package.json',
      section: 'detected',
    });
  }

  return { config, steps };
}

/**
 * Downloads ~5 MB from Cloudflare's speed-test endpoint and returns
 * the measured throughput in bytes/sec. Returns 0 on any failure so
 * callers can fall back to a default speed.
 */
async function measureInternetSpeed(): Promise<number> {
  const PROBE_BYTES = 5 * 1024 * 1024; // 5 MB
  const url = `https://speed.cloudflare.com/__down?bytes=${PROBE_BYTES}`;
  try {
    const start = Date.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok || !res.body) return 0;

    const reader = res.body.getReader();
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
    }

    const elapsed = (Date.now() - start) / 1000;
    return elapsed > 0 ? received / elapsed : 0;
  } catch {
    return 0;
  }
}

/** Returns true if the ollama binary is on PATH. */
async function isOllamaInstalled(): Promise<boolean> {
  try {
    await execFileP('ollama', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/** Returns true if ollama service is reachable on localhost:11434. */
async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Install ollama. macOS: brew first, then curl. Linux: curl. */
async function installOllama(): Promise<void> {
  const platform = process.platform;

  if (platform === 'darwin') {
    // Try Homebrew first (faster, cleaner on macOS)
    try {
      await execFileP('brew', ['--version']);
      await execFileP('brew', ['install', 'ollama'], { timeout: 300_000 });
      return;
    } catch {
      // Homebrew not available or install failed — fall through to curl
    }
  }

  // Linux or macOS without Homebrew: official install script
  await execFileP('sh', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], {
    timeout: 300_000,
  });
}

/** Start ollama serve in the background. Waits up to 5 s for it to come up. */
async function startOllamaService(): Promise<void> {
  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Poll until service responds or timeout
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isOllamaRunning()) return;
  }
}

function SetupApp({ options }: { options: ISetupOptions }) {
  const [state, setState] = useState<ISetupState>({
    phase: 'detecting',
    steps: [],
    detectedConfig: null,
    projectName: path.basename(process.cwd()),
    selectedModelIndex: 2, // default: qwen3.5:latest
  });

  // Local model-select cursor — kept in sync with state.selectedModelIndex for rendering
  const [cursorIdx, setCursorIdx] = useState(0);
  // Set when user confirms a model; triggers the pull effect below
  const [confirmedModel, setConfirmedModel] = useState<string | null>(null);
  // Prevent double-confirming
  const confirmed = useRef(false);

  // ── Keyboard handling for model selection ──────────────────────
  useInput(
    (_, key) => {
      if (state.phase !== 'model-select') return;
      if (key.upArrow) {
        setCursorIdx((i) => {
          const next = Math.max(0, i - 1);
          setState((s) => ({ ...s, selectedModelIndex: next }));
          return next;
        });
      } else if (key.downArrow) {
        setCursorIdx((i) => {
          const next = Math.min(SETUP_MODELS.length - 1, i + 1);
          setState((s) => ({ ...s, selectedModelIndex: next }));
          return next;
        });
      } else if (key.return && !confirmed.current) {
        confirmed.current = true;
        setConfirmedModel(SETUP_MODELS[cursorIdx].name);
      }
    },
    { isActive: state.phase === 'model-select' },
  );

  // ── Phase 1–4: detect → registry → ollama check/install → model-select ──
  useEffect(() => {
    async function run() {
      try {
        // Phase 1: Detect
        const { config, steps } = await detectProjectConfig();
        setState((s) => ({ ...s, phase: 'saving', steps, detectedConfig: config }));

        // Phase 2: Save config — merge with existing to preserve user settings
        // (e.g. "explanations", pathAliases, rerank, etc.)
        const configPath = options.config || '.pelicanrc.json';
        let existingConfig: Record<string, unknown> = {};
        try {
          const raw = await fs.readFile(configPath, 'utf-8');
          existingConfig = JSON.parse(raw);
        } catch {
          // File doesn't exist yet — start fresh
        }
        // Deep-merge: detected config is the base, but top-level user keys win.
        // For nested objects (analyzers, scoring, rerank) we do a shallow merge
        // so that user sub-keys (pathAliases, ollamaModel, explanations …) survive.
        const mergedConfig: Record<string, unknown> = { ...config };
        for (const key of Object.keys(existingConfig)) {
          const existingVal = existingConfig[key];
          const detectedVal = (config as unknown as Record<string, unknown>)[key];
          if (
            existingVal !== null &&
            typeof existingVal === 'object' &&
            !Array.isArray(existingVal) &&
            detectedVal !== null &&
            typeof detectedVal === 'object' &&
            !Array.isArray(detectedVal)
          ) {
            // Shallow-merge nested objects so user sub-keys are preserved
            mergedConfig[key] = { ...(detectedVal as object), ...(existingVal as object) };
          } else {
            // Scalar / array user values always win
            mergedConfig[key] = existingVal;
          }
        }
        // Scaffold defaults the user can't recover from a deleted rc file:
        //   - pathAliases auto-detected from tsconfig.json (analyze rebuilds
        //     them at runtime anyway, but writing them lets users see/edit).
        //   - rerank.explanations: true (sane default; persistModelChoice
        //     later spreads this through, so model-pull doesn't drop it).
        const detectedAliases = loadTsConfigAliases(
          process.cwd(),
          (mergedConfig.sourceDirs as string[] | undefined) ?? config.sourceDirs,
        );
        if (mergedConfig.pathAliases == null && Object.keys(detectedAliases.aliases).length > 0) {
          mergedConfig.pathAliases = detectedAliases.aliases;
        }
        const existingRerank = (mergedConfig.rerank as Record<string, unknown> | undefined) ?? {};
        if (!('explanations' in existingRerank)) {
          mergedConfig.rerank = { ...existingRerank, explanations: true };
        }

        await fs.writeFile(configPath, JSON.stringify(mergedConfig, null, 2));
        setState((s) => ({
          ...s,
          steps: [
            ...s.steps,
            {
              name: 'config',
              status: 'success' as const,
              detail: configPath,
              section: 'installed' as const,
            },
          ],
        }));

        // Phase 3: Build registry
        setState((s) => ({
          ...s,
          phase: 'building-registry',
          steps: [
            ...s.steps,
            {
              name: 'registry',
              status: 'loading' as const,
              detail: 'scanning sources & tests',
              section: 'installed' as const,
            },
          ],
        }));

        // Re-read the merged config so user-provided top-level pathAliases
        // (which `detectProjectConfig` doesn't know about) get hoisted into
        // analyzers.cypressExtractor.pathAliases. Otherwise the registry built
        // here resolves fewer imports than the one analyze rebuilds on a cold
        // cache, and the two diverge on result counts.
        const effectiveConfig = await loadProjectConfig(configPath);
        const builder = new RegistryBuilder();
        const registry = await builder.buildFromDirectories({
          sourceDirs: effectiveConfig.sourceDirs,
          testPatterns: effectiveConfig.testPatterns,
          excludePatterns: effectiveConfig.excludePatterns,
          projectRoot: process.cwd(),
          pathAliases: effectiveConfig.analyzers.cypressExtractor.pathAliases,
        });
        const registryDir = path.dirname(REGISTRY_CACHE_PATH);
        await fs.mkdir(registryDir, { recursive: true });
        await fs.writeFile(REGISTRY_CACHE_PATH, registry.serialize(), 'utf-8');

        const sourceCount = registry.getFilesByType('source').length;
        const testCount = registry.getFilesByType('test').length;
        setState((s) => ({
          ...s,
          steps: s.steps.map((step) =>
            step.name === 'registry'
              ? {
                  ...step,
                  status: 'success' as const,
                  detail: `${sourceCount} source · ${testCount} tests`,
                }
              : step,
          ),
        }));

        // Phase 4: Check/install ollama
        setState((s) => ({ ...s, phase: 'checking-ollama' }));

        const ollamaInstalled = await isOllamaInstalled();

        if (!ollamaInstalled) {
          setState((s) => ({
            ...s,
            phase: 'installing-ollama',
            steps: [
              ...s.steps,
              {
                name: 'ollama',
                status: 'loading' as const,
                detail: 'installing ollama…',
                section: 'installed' as const,
              },
            ],
          }));
          try {
            await installOllama();
            setState((s) => ({
              ...s,
              steps: s.steps.map((step) =>
                step.name === 'ollama'
                  ? { ...step, status: 'success' as const, detail: 'ollama installed' }
                  : step,
              ),
            }));
          } catch (err) {
            setState((s) => ({
              ...s,
              steps: s.steps.map((step) =>
                step.name === 'ollama'
                  ? {
                      ...step,
                      status: 'error' as const,
                      detail: `install failed: ${err instanceof Error ? err.message : String(err)}`,
                    }
                  : step,
              ),
            }));
            // Non-fatal — user can install manually. Skip to done.
            setState((s) => ({ ...s, phase: 'done' }));
            return;
          }
        }

        // Ensure service is running before model pull
        if (!(await isOllamaRunning())) {
          await startOllamaService();
        }

        // Phase 5: Fetch locally installed models + measure speed in parallel
        const ollama = new Ollama({ host: OLLAMA_HOST });
        const [installedList, speedBps] = await Promise.all([
          ollama
            .list()
            .then((r) => r.models.map((m) => m.name))
            .catch(() => [] as string[]),
          measureInternetSpeed(),
        ]);

        // Phase 6: Model selection (waits for user input via useInput)
        setState((s) => ({
          ...s,
          phase: 'model-select',
          internetSpeedBps: speedBps,
          installedModels: installedList,
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

  // ── Phase 5+: pull confirmed model ──────────────────────────────
  useEffect(() => {
    if (!confirmedModel) return;

    // Skip sentinel — user opted out of download
    if (confirmedModel === 'skip') {
      setState((s) => ({
        ...s,
        steps: [
          ...s.steps,
          {
            name: 'reranker',
            status: 'error' as const,
            detail: `skipped · set rerank.ollamaModel in .pelicanrc.json`,
            section: 'installed' as const,
            kind: 'model' as const,
          },
        ],
        phase: 'done',
      }));
      return;
    }

    // Model already present — no download needed
    const alreadyInstalled = (state.installedModels ?? []).some(
      (m) => m === confirmedModel || m.startsWith(confirmedModel!.split(':')[0] + ':'),
    );
    if (alreadyInstalled) {
      void persistModelChoice(options.config || '.pelicanrc.json', confirmedModel!);
      setState((s) => ({
        ...s,
        steps: [
          ...s.steps,
          {
            name: 'reranker',
            status: 'success' as const,
            detail: `${confirmedModel} already installed`,
            section: 'installed' as const,
            kind: 'model' as const,
          },
        ],
        phase: 'done',
      }));
      return;
    }

    async function pull() {
      try {
        setState((s) => ({
          ...s,
          phase: 'pulling-model',
          steps: [
            ...s.steps,
            {
              name: 'reranker',
              status: 'loading' as const,
              detail: `pulling ${confirmedModel}…`,
              section: 'installed' as const,
              kind: 'model' as const,
            },
          ],
        }));

        const ollama = new Ollama({ host: OLLAMA_HOST });
        const stream = await ollama.pull({ model: confirmedModel!, stream: true });

        for await (const chunk of stream) {
          if (chunk.total && chunk.completed) {
            const pct = Math.round((chunk.completed / chunk.total) * 100);
            setState((s) => ({
              ...s,
              modelProgress: {
                file: chunk.status ?? confirmedModel!,
                pct,
                loaded: chunk.completed,
                total: chunk.total,
              },
            }));
          }
        }

        await persistModelChoice(options.config || '.pelicanrc.json', confirmedModel!);
        setState((s) => ({
          ...s,
          modelProgress: undefined,
          steps: s.steps.map((step) =>
            step.kind === 'model'
              ? { ...step, status: 'success' as const, detail: `${confirmedModel} ready` }
              : step,
          ),
          phase: 'done',
        }));
      } catch (err) {
        setState((s) => ({
          ...s,
          modelProgress: undefined,
          steps: s.steps.map((step) =>
            step.kind === 'model'
              ? {
                  ...step,
                  status: 'error' as const,
                  detail: `pull failed: ${err instanceof Error ? err.message : String(err)}`,
                }
              : step,
          ),
          phase: 'done',
        }));
      }
    }

    pull();
  }, [confirmedModel]);

  return <SetupView {...state} />;
}

export const setupCommand = new Command('setup')
  .description('Run setup wizard to configure Test Suggestor')
  .option('--auto', 'Skip interactive prompts, use auto-detection only')
  .option('-c, --config <path>', 'Path to save config file')
  .action(async (opts: ISetupOptions) => {
    await loadTheme();
    const { waitUntilExit } = render(<SetupApp options={opts} />);
    await waitUntilExit();
  });
