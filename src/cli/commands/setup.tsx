import React, { useState, useEffect } from 'react';
import { render } from 'ink';
import * as fs from 'fs/promises';
import { Command } from 'commander';
import { SetupView } from '../views/SetupView';
import { ISetupState, ISetupStep, IProjectConfig, ISetupOptions } from '../types';
import { loadTheme } from '../user-config';

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

    // Detect Cypress
    if (pkg.devDependencies?.cypress || pkg.dependencies?.cypress) {
      steps.push({ name: 'Cypress detected', status: 'success', detail: 'cypress-extractor enabled' });
      if (!config.scoring.enabledScorers.includes('selector-match')) {
        config.scoring.enabledScorers.push('selector-match');
      }
    } else {
      steps.push({ name: 'Cypress', status: 'idle', detail: 'not found' });
    }

    // Detect Redux Toolkit
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
        name: 'Redux Toolkit detected',
        status: 'success',
        detail: existingDirs.length > 0 ? `store dirs: ${existingDirs.join(', ')}` : 'no store dirs found',
      });
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
        try {
          await fs.access(file);
          config.analyzers.routeAnalyzer.routerFile = file;
          break;
        } catch {
          // file not found
        }
      }
      steps.push({
        name: 'React Router detected',
        status: 'success',
        detail: config.analyzers.routeAnalyzer.routerFile || 'router file not found',
      });
    } else {
      steps.push({ name: 'React Router', status: 'idle', detail: 'not found' });
    }

    // Detect i18n
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
        name: 'react-i18next detected',
        status: 'success',
        detail: config.analyzers.i18n.localesPath || 'locales path not found',
      });
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

        // Phase 3: Prompt user to build registry
        setState((s) => ({
          ...s,
          phase: 'building-registry',
          steps: [
            ...s.steps,
            { name: 'Building registry...', status: 'loading' as const },
          ],
        }));

        // Mark as done — user can run `suggestor registry build` separately
        setState((s) => ({
          ...s,
          phase: 'done',
          steps: s.steps.map((step) =>
            step.status === 'loading'
              ? { ...step, status: 'success' as const, detail: 'run `suggestor registry build` to build' }
              : step,
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
    await loadTheme();
    const { waitUntilExit } = render(<SetupApp options={opts} />);
    await waitUntilExit();
  });
