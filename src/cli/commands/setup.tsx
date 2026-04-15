import * as fs from 'fs/promises';

import { Command } from 'commander';
import { render } from 'ink';
import React, { useState, useEffect } from 'react';

import * as path from 'path';

import { ISetupState, ISetupStep, IProjectConfig, ISetupOptions } from '@/cli/types';
import { loadTheme } from '@/cli/user-config';
import { SetupView } from '@/cli/views/SetupView';
import { RegistryBuilder } from '@/core/registry/registry-builder';
import { CrossEncoderReranker } from '@/core/rerank/cross-encoder-reranker';

const REGISTRY_CACHE_PATH = '.pelican/registry.json';

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
      config.analyzers.enabled.push('redux-chain-analyzer');
      config.scoring.enabledScorers.push('redux-chain');

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
      config.analyzers.enabled.push('route-analyzer');
      config.scoring.enabledScorers.push('route-match');

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
      config.analyzers.enabled.push('i18n-analyzer');
      config.scoring.enabledScorers.push('translation-match');

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

function SetupApp({ options }: { options: ISetupOptions }) {
  const [state, setState] = useState<ISetupState>({
    phase: 'detecting',
    steps: [],
    detectedConfig: null,
    projectName: path.basename(process.cwd()),
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
        const configPath = options.config || '.pelicanrc.json';
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
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

        const builder = new RegistryBuilder();
        const registry = await builder.buildFromDirectories({
          sourceDirs: config.sourceDirs,
          testPatterns: config.testPatterns,
          projectRoot: process.cwd(),
          pathAliases: config.analyzers.cypressExtractor.pathAliases,
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

        // Phase 4: Download reranker model.
        //
        // Non-fatal: if download fails (offline, HF unreachable) setup still
        // finishes successfully. Analyze will fall back to pelican-only
        // scoring and the user can retry via `pelican model:download`.
        setState((s) => ({
          ...s,
          steps: [
            ...s.steps,
            {
              name: 'reranker',
              status: 'loading' as const,
              detail: 'first run · ~600 MB',
              section: 'installed' as const,
              kind: 'model' as const,
            },
          ],
        }));

        try {
          const reranker = new CrossEncoderReranker({
            onProgress: (info) => {
              if (info.status === 'progress' && info.file && typeof info.pct === 'number') {
                setState((s) => ({
                  ...s,
                  modelProgress: {
                    file: info.file!,
                    pct: info.pct ?? 0,
                    loaded: info.loaded,
                    total: info.total,
                  },
                }));
              }
            },
          });
          await reranker.ensureModel();
          setState((s) => ({
            ...s,
            modelProgress: undefined,
            steps: s.steps.map((step) =>
              step.kind === 'model'
                ? {
                    ...step,
                    status: 'success' as const,
                    detail: '.pelican/models',
                  }
                : step,
            ),
          }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setState((s) => ({
            ...s,
            modelProgress: undefined,
            steps: s.steps.map((step) =>
              step.kind === 'model'
                ? {
                    ...step,
                    status: 'error' as const,
                    detail: `skipped — retry with 'pelican model:download'`,
                  }
                : step,
            ),
          }));
          // Swallow for telemetry-only paths; msg is shown in detail.
          void msg;
        }

        setState((s) => ({ ...s, phase: 'done' }));
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
    await loadTheme();
    const { waitUntilExit } = render(<SetupApp options={opts} />);
    await waitUntilExit();
  });
