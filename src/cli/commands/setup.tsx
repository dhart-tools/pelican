import { execFile, spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

import { Command } from 'commander';
import { render } from 'ink';
import { useInput } from 'ink';
import { Ollama } from 'ollama';
import React, { useState, useEffect, useRef } from 'react';

import { loadProjectConfig, getMergedAliases, getIgnoreDirs } from '@/cli/config-loader';
import { installCopilot, isCopilotInstalled, loginCopilot } from '@/cli/copilot-setup';
import { SETUP_COPILOT_MODELS } from '@/cli/setup-copilot-models';
import { SETUP_MODELS } from '@/cli/setup-models';
import { SETUP_PROVIDERS, SetupProvider } from '@/cli/setup-providers';
import { ISetupState, ISetupStep, IProjectConfig, ISetupOptions } from '@/cli/types';
import { loadTheme } from '@/cli/user-config';
import { SetupView } from '@/cli/views/SetupView';
import { RegistryBuilder } from '@/core/registry/registry-builder';
import { loadTsConfigAliases } from '@/core/registry/tsconfig-loader';

const execFileP = promisify(execFile);

const REGISTRY_CACHE_PATH = '.pelican/registry.json';
const OLLAMA_HOST = 'http://localhost:11434';

/**
 * Persist the selected local model. Local Ollama is controlled by the
 * `--rerank` flag, so selecting it must not enable the separate remote-provider
 * path (`rerank.enabled`).
 */
async function persistModelChoice(configPath: string, model: string): Promise<void> {
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const cfg = JSON.parse(content);
    cfg.rerank = { ...(cfg.rerank ?? {}), enabled: false, ollamaModel: model };
    await fs.writeFile(configPath, JSON.stringify(cfg, null, 2));
  } catch {
    // Config missing or unreadable — skip silently. analyze will fall back
    // to the built-in default, which is still functional.
  }
}

async function persistRemoteRerank(
  configPath: string,
  enabled: boolean,
  provider?: 'copilot',
  copilotModel?: string,
): Promise<void> {
  const content = await fs.readFile(configPath, 'utf-8');
  const cfg = JSON.parse(content);
  cfg.rerank = {
    ...(cfg.rerank ?? {}),
    enabled,
    ...(provider ? { provider } : {}),
    ...(copilotModel ? { copilotModel } : {}),
  };
  await fs.writeFile(configPath, JSON.stringify(cfg, null, 2));
}

const yieldTerminal = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
    source: {
      root: '.',
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
      minConfidence: 0.6,
      highConfidence: 0.8,
      maxResults: 10,
      requireAnchor: true,
      ubiquityThreshold: 0.7,
      ubiquitousSelectorThreshold: 0.1,
      routeTrafficDampingExponent: 1,
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
    }

    if (pkg.dependencies?.['@reduxjs/toolkit'] || pkg.dependencies?.redux) {
      config.source.redux.enabled = true;

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
      config.source.redux.storeDirs = existingDirs;
      steps.push({
        name: 'redux toolkit',
        status: 'success',
        detail: existingDirs.length > 0 ? existingDirs.join(', ') : 'no store dirs',
        section: 'detected',
      });
    }

    if (pkg.dependencies?.['react-router-dom'] || pkg.dependencies?.['react-router']) {
      config.source.routes.enabled = true;

      const possibleFiles = ['src/App.tsx', 'src/router.tsx', 'src/routes.tsx', 'src/Router.tsx'];
      for (const file of possibleFiles) {
        try {
          await fs.access(file);
          config.source.routes.routerFile = file;
          break;
        } catch {
          // file not found
        }
      }
      steps.push({
        name: 'react router',
        status: 'success',
        detail: config.source.routes.routerFile || 'router file not found',
        section: 'detected',
      });
    }

    if (pkg.dependencies?.['react-i18next'] || pkg.dependencies?.['i18next']) {
      config.source.i18n.enabled = true;
      config.source.i18n.library = 'react-i18next';

      const possiblePaths = [
        'public/locales/en/translation.json',
        'src/i18n/en.json',
        'src/locales/en/translation.json',
      ];
      for (const p of possiblePaths) {
        try {
          await fs.access(p);
          config.source.i18n.localesPath = p.replace('/en/', '/{locale}/');
          break;
        } catch {
          // path not found
        }
      }
      steps.push({
        name: 'react-i18next',
        status: 'success',
        detail: config.source.i18n.localesPath || 'locales path not found',
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
    selectedCopilotModelIndex: 0, // default: auto
    selectedProviderIndex: 0,
  });

  const [providerCursorIdx, setProviderCursorIdx] = useState(0);
  const [confirmedProvider, setConfirmedProvider] = useState<SetupProvider | null>(null);
  const [installDecision, setInstallDecision] = useState<boolean | null>(null);
  const [authDecision, setAuthDecision] = useState<boolean | null>(null);
  const [copilotModelCursorIdx, setCopilotModelCursorIdx] = useState(0);
  const [confirmedCopilotModel, setConfirmedCopilotModel] = useState<string | null>(null);
  // Local model-select cursor — kept in sync with state.selectedModelIndex for rendering
  const [cursorIdx, setCursorIdx] = useState(0);
  // Set when user confirms a model; triggers the pull effect below
  const [confirmedModel, setConfirmedModel] = useState<string | null>(null);
  // Prevent double-confirming
  const confirmed = useRef(false);
  const providerConfirmed = useRef(false);
  const copilotModelConfirmed = useRef(false);

  // ── Keyboard handling for model selection ──────────────────────
  useInput(
    (input, key) => {
      if (state.phase === 'provider-select') {
        if (key.upArrow) {
          setProviderCursorIdx((i) => {
            const next = Math.max(0, i - 1);
            setState((s) => ({ ...s, selectedProviderIndex: next }));
            return next;
          });
        } else if (key.downArrow) {
          setProviderCursorIdx((i) => {
            const next = Math.min(SETUP_PROVIDERS.length - 1, i + 1);
            setState((s) => ({ ...s, selectedProviderIndex: next }));
            return next;
          });
        } else if (key.return && !providerConfirmed.current) {
          providerConfirmed.current = true;
          setConfirmedProvider(SETUP_PROVIDERS[providerCursorIdx].id);
        }
        return;
      }

      if (state.phase === 'copilot-install-confirm') {
        if (input.toLowerCase() === 'y') setInstallDecision(true);
        if (input.toLowerCase() === 'n') setInstallDecision(false);
        return;
      }

      if (state.phase === 'copilot-auth-confirm') {
        if (input.toLowerCase() === 'y') setAuthDecision(true);
        if (input.toLowerCase() === 'n') setAuthDecision(false);
        return;
      }

      if (state.phase === 'copilot-model-select') {
        if (key.upArrow) {
          setCopilotModelCursorIdx((i) => {
            const next = Math.max(0, i - 1);
            setState((s) => ({ ...s, selectedCopilotModelIndex: next }));
            return next;
          });
        } else if (key.downArrow) {
          setCopilotModelCursorIdx((i) => {
            const next = Math.min(SETUP_COPILOT_MODELS.length - 1, i + 1);
            setState((s) => ({ ...s, selectedCopilotModelIndex: next }));
            return next;
          });
        } else if (key.return && !copilotModelConfirmed.current) {
          copilotModelConfirmed.current = true;
          setConfirmedCopilotModel(SETUP_COPILOT_MODELS[copilotModelCursorIdx].id);
        }
        return;
      }

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
    {
      isActive: [
        'provider-select',
        'copilot-install-confirm',
        'copilot-auth-confirm',
        'copilot-model-select',
        'model-select',
      ].includes(state.phase),
    },
  );

  // ── Phase 1–3: detect → registry → provider selection ──────────
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
        const mergedSource =
          (mergedConfig.source as { dirs?: string[]; pathAliases?: Record<string, string> }) ?? {};
        const detectedAliases = loadTsConfigAliases(
          process.cwd(),
          mergedSource.dirs ?? config.source.dirs,
        );
        if (mergedSource.pathAliases == null && Object.keys(detectedAliases.aliases).length > 0) {
          mergedConfig.source = { ...mergedSource, pathAliases: detectedAliases.aliases };
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
          sourceDirs: effectiveConfig.source.dirs,
          testPatterns: effectiveConfig.test.patterns,
          excludePatterns: effectiveConfig.test.exclude,
          ignoreDirs: getIgnoreDirs(effectiveConfig),
          sourceRoot: effectiveConfig.source.root,
          testRoot: effectiveConfig.test.root ?? effectiveConfig.source.root,
          pathAliases: getMergedAliases(effectiveConfig),
          debug: options.debug,
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

        // --auto performs only detection/config/registry work. Provider setup is
        // intentionally interactive and must never block automation.
        setState((s) => ({ ...s, phase: options.auto ? 'done' : 'provider-select' }));
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

  // ── Phase 4: provider-specific setup ───────────────────────────
  useEffect(() => {
    if (!confirmedProvider) return;
    const configPath = options.config || '.pelicanrc.json';

    async function runProviderSetup() {
      try {
        setState((s) => ({ ...s, selectedProvider: confirmedProvider! }));

        if (confirmedProvider === 'skip') {
          await persistRemoteRerank(configPath, false);
          setState((s) => ({ ...s, phase: 'done' }));
          return;
        }

        if (confirmedProvider === 'copilot') {
          setState((s) => ({ ...s, phase: 'checking-copilot' }));
          const installed = await isCopilotInstalled();
          setState((s) => ({
            ...s,
            phase: installed ? 'copilot-auth-confirm' : 'copilot-install-confirm',
            steps: installed
              ? [
                  ...s.steps,
                  {
                    name: 'copilot',
                    status: 'success' as const,
                    detail: 'CLI installed',
                    section: 'installed' as const,
                  },
                ]
              : s.steps,
          }));
          return;
        }

        await persistRemoteRerank(configPath, false);
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
              phase: 'done',
            }));
            return;
          }
        }

        if (!(await isOllamaRunning())) await startOllamaService();

        const ollama = new Ollama({ host: OLLAMA_HOST });
        const [installedList, speedBps] = await Promise.all([
          ollama
            .list()
            .then((r) => r.models.map((m) => m.name))
            .catch(() => [] as string[]),
          measureInternetSpeed(),
        ]);
        setState((s) => ({
          ...s,
          phase: 'model-select',
          internetSpeedBps: speedBps,
          installedModels: installedList,
        }));
      } catch (err) {
        setState((s) => ({
          ...s,
          phase: 'error',
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }

    void runProviderSetup();
  }, [confirmedProvider]);

  // Install only after explicit approval. A refusal leaves Copilot disabled and
  // prints the manual command in the setup result.
  useEffect(() => {
    if (installDecision == null) return;
    const configPath = options.config || '.pelicanrc.json';

    async function handleInstallDecision() {
      if (!installDecision) {
        await persistRemoteRerank(configPath, false, 'copilot');
        setState((s) => ({
          ...s,
          phase: 'done',
          steps: [
            ...s.steps,
            {
              name: 'copilot',
              status: 'error' as const,
              detail: 'not installed · run npm install -g @github/copilot',
              section: 'installed' as const,
            },
          ],
        }));
        return;
      }

      try {
        setState((s) => ({
          ...s,
          phase: 'installing-copilot',
          steps: [
            ...s.steps,
            {
              name: 'copilot',
              status: 'loading' as const,
              detail: 'npm install -g @github/copilot',
              section: 'installed' as const,
            },
          ],
        }));
        await installCopilot();
        if (!(await isCopilotInstalled())) throw new Error('installation could not be verified');
        setState((s) => ({
          ...s,
          phase: 'copilot-auth-confirm',
          steps: s.steps.map((step) =>
            step.name === 'copilot'
              ? { ...step, status: 'success' as const, detail: 'CLI installed' }
              : step,
          ),
        }));
      } catch (err) {
        await persistRemoteRerank(configPath, false, 'copilot');
        setState((s) => ({
          ...s,
          phase: 'error',
          error: `Copilot install failed: ${err instanceof Error ? err.message : String(err)}. Run npm install -g @github/copilot manually.`,
        }));
      }
    }

    void handleInstallDecision();
  }, [installDecision]);

  // Copilot owns authentication. Ink releases raw input while login runs, then
  // Pelican presents its own model selection instead of opening Copilot's UI.
  useEffect(() => {
    if (authDecision == null) return;

    async function finishCopilotSetup() {
      try {
        if (authDecision) {
          setState((s) => ({ ...s, phase: 'copilot-login' }));
          await yieldTerminal();
          await loginCopilot();
        }
        setState((s) => ({ ...s, phase: 'copilot-model-select' }));
      } catch (err) {
        await persistRemoteRerank(options.config || '.pelicanrc.json', false, 'copilot');
        setState((s) => ({
          ...s,
          phase: 'error',
          error: `Copilot setup did not complete: ${err instanceof Error ? err.message : String(err)}`,
        }));
      }
    }

    void finishCopilotSetup();
  }, [authDecision]);

  useEffect(() => {
    if (!confirmedCopilotModel) return;

    async function saveCopilotModel() {
      try {
        await persistRemoteRerank(
          options.config || '.pelicanrc.json',
          true,
          'copilot',
          confirmedCopilotModel!,
        );
        setState((s) => ({
          ...s,
          phase: 'done',
          steps: [
            ...s.steps,
            {
              name: 'reranker',
              status: 'success' as const,
              detail: `GitHub Copilot ready · ${confirmedCopilotModel}`,
              section: 'installed' as const,
              kind: 'model' as const,
            },
          ],
        }));
      } catch (err) {
        setState((s) => ({
          ...s,
          phase: 'error',
          error: `Could not save Copilot model: ${err instanceof Error ? err.message : String(err)}`,
        }));
      }
    }

    void saveCopilotModel();
  }, [confirmedCopilotModel]);

  // ── Local model pull ────────────────────────────────────────────
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
  .option('--debug', 'Stream registry-build diagnostics to stderr')
  .action(async (opts: ISetupOptions) => {
    await loadTheme();
    const { waitUntilExit } = render(<SetupApp options={opts} />);
    await waitUntilExit();
  });
