import * as fs from 'fs/promises';
import * as path from 'path';

import { Command } from 'commander';
import { render } from 'ink';
import React, { useState, useEffect } from 'react';

import { loadProjectConfig, toScoringConfig } from '@/cli/config-loader';
import { IAnalyzeState, IAnalyzeOptions, IAnalyzeResult } from '@/cli/types';
import { loadTheme } from '@/cli/user-config';
import { AnalyzeView } from '@/cli/views/AnalyzeView';
import { Registry } from '@/core/registry/registry';
import { RegistryBuilder } from '@/core/registry/registry-builder';
import { APIInterceptScorer } from '@/core/scoring/scorers/api-intercept-scorer';
import { ColocationScorer } from '@/core/scoring/scorers/colocation-scorer';
import { DescribeBlockScorer } from '@/core/scoring/scorers/describe-block-scorer';
import { DirectImportScorer } from '@/core/scoring/scorers/direct-import-scorer';
import { FilenameConventionScorer } from '@/core/scoring/scorers/filename-convention-scorer';
import { ReduxChainScorer } from '@/core/scoring/scorers/redux-chain-scorer';
import { ReduxConsumerScorer } from '@/core/scoring/scorers/redux-consumer-scorer';
import { RouteMatchScorer } from '@/core/scoring/scorers/route-match-scorer';
import { SelectorIdMatchScorer } from '@/core/scoring/scorers/selector-id-match-scorer';
import { SelectorMatchScorer } from '@/core/scoring/scorers/selector-match-scorer';
import { TransitiveImportScorer } from '@/core/scoring/scorers/transitive-import-scorer';
import { TranslationMatchScorer } from '@/core/scoring/scorers/translation-match-scorer';
import { SemanticReranker } from '@/core/rerank/semantic-reranker';
import { ScoringEngine } from '@/core/scoring/scoring-engine';

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
    new APIInterceptScorer(),
    new ColocationScorer(),
    new DescribeBlockScorer(),
  ];

  for (const scorer of allScorers) {
    if (enabledScorers.includes(scorer.name)) {
      engine.register(scorer);
    }
  }
}

/**
 * Runs the semantic reranker against a set of score results and returns only
 * the ones whose cosine similarity to the diff is above threshold. Order is
 * preserved from the input (which is already sorted by scorer score) — we
 * only filter, we do not resort, because the scorer ranking already encodes
 * strong evidence signals that should dominate embedding wiggle.
 */
async function applyReranker(
  reranker: SemanticReranker,
  changedFile: string,
  scored: IAnalyzeResult['suggestedTests'],
  registry: Registry,
  options: { base?: string; target?: string },
): Promise<IAnalyzeResult['suggestedTests']> {
  if (scored.length === 0) return scored;
  const candidatePaths = scored.map((r) => r.testFile);
  const rerankResults = await reranker.rerank(
    changedFile,
    candidatePaths,
    registry,
    options,
  );
  const keepSet = new Set(rerankResults.filter((r) => r.kept).map((r) => r.testFile));
  return scored.filter((r) => keepSet.has(r.testFile));
}

/**
 * Loads the registry from cache or builds it fresh.
 */
async function loadOrBuildRegistry(
  config: Awaited<ReturnType<typeof loadProjectConfig>>,
  onPhaseChange: (phase: IAnalyzeState['phase']) => void,
  debug = false,
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
      pathAliases: config.analyzers.cypressExtractor.pathAliases,
      debug,
    });

    // Save cache
    const dir = path.dirname(REGISTRY_CACHE_PATH);
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
    maxResults: options.maxResults ? Number.parseInt(options.maxResults) : undefined,
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
          changedFiles = options.files
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean);
        } else {
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
        const maxResults = parseInt(options.maxResults) || config.scoring.maxResults || 10;
        const results: IAnalyzeResult[] = [];

        const reranker = new SemanticReranker({ debug: options.debug });

        for (let i = 0; i < changedFiles.length; i++) {
          const changedFile = changedFiles[i];
          setState((s) => ({
            ...s,
            currentFile: changedFile,
            progress: ((i + 1) / changedFiles.length) * 100,
          }));

          const scoreResults = engine.evaluateTests(changedFile, testFiles);
          const relevant = scoreResults.filter((r) => r.score >= config.scoring.minConfidence);
          const preRerankCount = relevant.length;

          const rerankedRelevant = await applyReranker(
            reranker,
            changedFile,
            relevant,
            registry,
            { base: options.base, target: options.target },
          );

          results.push({
            changedFile,
            suggestedTests: rerankedRelevant.slice(0, maxResults),
            totalCandidates: rerankedRelevant.length,
            preRerankCount,
            postRerankCount: rerankedRelevant.length,
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
export async function runHeadless(options: IAnalyzeOptions): Promise<void> {
  const debug = options.debug ?? false;
  const config = await loadProjectConfig(options.config);
  if (options.minConfidence) {
    config.scoring.minConfidence = parseFloat(options.minConfidence);
  }

  if (debug) {
    debugLog(`config loaded: enabledScorers=${config.scoring.enabledScorers.join(',')}`);
    debugLog(`pathAliases: ${JSON.stringify(config.analyzers.cypressExtractor.pathAliases ?? {})}`);
  }

  const registry = new Registry();
  try {
    const cacheData = await fs.readFile(REGISTRY_CACHE_PATH, 'utf-8');
    registry.deserialize(cacheData);
    if (debug) {
      debugLog(`registry loaded from cache: ${registry.files.size} files, ${registry.getSelectorIndex().size} selectors`);
    }
  } catch {
    if (debug) {
      debugLog('registry cache not found, building fresh...');
    }
    const builder = new RegistryBuilder();
    const builtRegistry = await builder.buildFromDirectories({
      sourceDirs: config.sourceDirs,
      testPatterns: config.testPatterns,
      projectRoot: process.cwd(),
      pathAliases: config.analyzers.cypressExtractor.pathAliases,
      debug,
    });
    const dir = path.dirname(REGISTRY_CACHE_PATH);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(REGISTRY_CACHE_PATH, builtRegistry.serialize(), 'utf-8');
    registry.deserialize(builtRegistry.serialize());
  }

  const changedFiles = options.files
    ? options.files
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean)
    : [];

  const scoringConfig = toScoringConfig(config);
  const engine = new ScoringEngine(scoringConfig, registry);
  registerScorers(engine, config.scoring.enabledScorers);

  const testFiles = registry.getFilesByType('test').map((f) => f.path);
  const maxResults = parseInt(options.maxResults) || config.scoring.maxResults || 10;

  if (debug) {
    debugLog(`scoring ${changedFiles.length} changed file(s) against ${testFiles.length} test file(s)`);
  }

  const reranker = new SemanticReranker({ debug });

  const results: IAnalyzeResult[] = [];
  for (const changedFile of changedFiles) {
    if (debug) {
      const entry = registry.getFile(changedFile);
      debugLog(`\n─── scoring: ${changedFile} ───`);
      if (entry) {
        debugLog(`  selectors: ${JSON.stringify(entry.selectors ?? [])}`);
        debugLog(`  translationKeys: ${(entry.translationKeys ?? []).length}`);
        debugLog(`  imports: ${entry.imports.length}`);
      } else {
        debugLog(`  ⚠ file not found in registry!`);
      }
    }

    const scoreResults = engine.evaluateTests(changedFile, testFiles);

    if (debug) {
      const top = scoreResults.slice(0, 5);
      for (const r of top) {
        debugLog(`  → ${r.testFile}`);
        debugLog(`    score=${r.score.toFixed(3)} confidence=${r.confidence}`);
        for (const s of r.signals) {
          debugLog(`    ${s.matched ? '✓' : '✗'} ${s.source} (${s.weight}) — ${s.reason}`);
        }
      }
    }

    const relevant = scoreResults.filter((r) => r.score >= config.scoring.minConfidence);
    const preRerankCount = relevant.length;
    const reranked = await applyReranker(reranker, changedFile, relevant, registry, {
      base: options.base,
      target: options.target,
    });
    if (debug) {
      debugLog(`  rerank: ${preRerankCount} → ${reranked.length} after semantic filter`);
    }
    results.push({
      changedFile,
      suggestedTests: reranked.slice(0, maxResults),
      totalCandidates: reranked.length,
      preRerankCount,
      postRerankCount: reranked.length,
    });
  }

  console.log(JSON.stringify({ results }, null, 2));
}

function debugLog(msg: string): void {
  process.stderr.write(`[debug] ${msg}\n`);
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
  .option('--debug', 'Print detailed extraction and scoring info to stderr')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (opts: IAnalyzeOptions) => {
    // --ci is shorthand for --output json
    if (opts.ci) opts.output = 'json';

    if (opts.output === 'json') {
      await runHeadless(opts);
      return;
    }

    await loadTheme();
    const { waitUntilExit } = render(<AnalyzeApp options={opts} />);
    await waitUntilExit();
  });
