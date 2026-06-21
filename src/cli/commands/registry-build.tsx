import * as fs from 'fs/promises';
import * as path from 'path';

import { Command } from 'commander';
import { render } from 'ink';
import React, { useState, useEffect } from 'react';

import { loadProjectConfig, getMergedAliases } from '@/cli/config-loader';
import { IRegistryBuildState, IRegistryBuildOptions } from '@/cli/types';
import { loadTheme } from '@/cli/user-config';
import { RegistryBuildView } from '@/cli/views/RegistryBuildView';
import { Registry } from '@/core/registry/registry';
import { RegistryBuilder } from '@/core/registry/registry-builder';

/** Silence console.log/warn while Ink is rendering to avoid TUI corruption. */
function silenceConsole() {
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  return () => {
    console.log = origLog;
    console.warn = origWarn;
  };
}

/** Extract stats from a Registry instance. */
function statsFromRegistry(registry: Registry, duration: number) {
  return {
    totalFiles: registry.files.size,
    sourceFiles: registry.getFilesByType('source').length,
    testFiles: registry.getFilesByType('test').length,
    dependencies: registry.importGraph.dependencies.size,
    selectors: registry.getSelectorIndex().size,
    routes: registry.getRouteMap().size,
    duration,
  };
}

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
        const cachePath = options.output || '.pelican/registry.json';

        // If cache exists and --force is not set, load it and report real stats
        if (!options.force) {
          try {
            const start = Date.now();
            const cached = await fs.readFile(cachePath, 'utf-8');
            const registry = new Registry();
            registry.deserialize(cached);
            setState({
              phase: 'done',
              totalFiles: registry.files.size,
              processedFiles: registry.files.size,
              stats: statsFromRegistry(registry, Date.now() - start),
            });
            return;
          } catch {
            // Cache doesn't exist — fall through to build
          }
        }

        const startTime = Date.now();
        const restore = silenceConsole();

        try {
          setState((s) => ({ ...s, phase: 'extracting-source' }));

          const builder = new RegistryBuilder();
          const iRegistry = await builder.buildFromDirectories({
            sourceDirs: config.source.dirs,
            testPatterns: config.test.patterns,
            excludePatterns: config.test.exclude,
            sourceRoot: config.source.root,
            testRoot: config.test.root ?? config.source.root,
            pathAliases: getMergedAliases(config),
            debug: options.debug,
          });

          setState((s) => ({ ...s, phase: 'saving' }));

          const dir = path.dirname(cachePath);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(cachePath, iRegistry.serialize(), 'utf-8');

          // Cast to concrete class to access internal maps for stats
          const registry = iRegistry as unknown as Registry;
          setState((s) => ({
            ...s,
            phase: 'done',
            stats: statsFromRegistry(registry, Date.now() - startTime),
          }));
        } finally {
          restore();
        }
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
      .option('-o, --output <path>', 'Output path for registry', '.pelican/registry.json')
      .option('--debug', 'Print detailed extraction info to stderr')
      .option('-c, --config <path>', 'Path to config file')
      .action(async (opts: IRegistryBuildOptions) => {
        await loadTheme();
        const { waitUntilExit } = render(<RegistryBuildApp options={opts} />);
        await waitUntilExit();
      }),
  );
