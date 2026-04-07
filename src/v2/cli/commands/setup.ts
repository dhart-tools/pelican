import * as fs from 'fs/promises';
import * as path from 'path';

import { ISuggestorConfig } from '@v2/types/config';

import { DEFAULT_CONFIG, saveConfig } from '../config-loader';

/**
 * Runs the setup wizard or auto-detection.
 */
export async function runSetup(projectRoot: string, options: { auto?: boolean }): Promise<void> {
  console.log('🚀 Starting Suggestor Setup...');

  const config: ISuggestorConfig = { ...DEFAULT_CONFIG };

  // 1. Load project package.json for auto-detection
  let pkg: any = {};
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    const raw = await fs.readFile(pkgPath, 'utf-8');
    pkg = JSON.parse(raw);
  } catch {
    console.warn('⚠ package.json not found, using defaults.');
  }

  // 2. Auto-detection Logic
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  // Detect Cypress
  if (allDeps.cypress) {
    console.log('  ✓ Detected Cypress');
    config.analyzers.cypressExtractor.enabled = true;
  }

  // Detect Redux
  if (allDeps.redux || allDeps['@reduxjs/toolkit']) {
    console.log('  ✓ Detected Redux');
    config.analyzers.reduxChain.enabled = true;
  }

  // Detect React Router
  if (allDeps['react-router-dom']) {
    console.log('  ✓ Detected React Router');
    config.analyzers.routeAnalyzer.enabled = true;
  }

  // Detect i18next
  if (allDeps.i18next || allDeps['react-i18next']) {
    console.log('  ✓ Detected i18next');
    config.analyzers.i18n.enabled = true;
  }

  // 3. Save configuration
  await saveConfig(projectRoot, config);
  console.log('✨ Configuration saved to .suggestorrc.json');
}
