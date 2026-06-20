import * as fs from 'fs/promises';
import * as path from 'path';

import { Command } from 'commander';
import { render } from 'ink';
import pLimit from 'p-limit';
import React, { useState, useEffect } from 'react';

import { loadProjectConfig, toScoringConfig } from '@/cli/config-loader';
import { IAnalyzeState, IAnalyzeOptions, IAnalyzeResult } from '@/cli/types';
import { loadTheme } from '@/cli/user-config';
import { AnalyzeView } from '@/cli/views/AnalyzeView';
import { Registry } from '@/core/registry/registry';
import { RegistryBuilder } from '@/core/registry/registry-builder';
import { getChangedFiles } from '@/core/rerank/diff-extractor';
import { ModelUnavailableError, SemanticReranker } from '@/core/rerank/semantic-reranker';
import { ActionTypeScorer } from '@/core/scoring/scorers/action-type-scorer';
import { APIInterceptScorer } from '@/core/scoring/scorers/api-intercept-scorer';
import { ColocationScorer } from '@/core/scoring/scorers/colocation-scorer';
import { DependentSelectorScorer } from '@/core/scoring/scorers/dependent-selector-scorer';
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
import { UsageSiteScorer } from '@/core/scoring/scorers/usage-site-scorer';
import { ScoringEngine } from '@/core/scoring/scoring-engine';
import { formatBuildLine } from '@/utils/build-info';
import { EConfidenceLevel } from '@/utils/enums';

const REGISTRY_CACHE_PATH = '.pelican/registry.json';

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
    new DependentSelectorScorer(),
    new ActionTypeScorer(),
    new UsageSiteScorer(),
  ];

  for (const scorer of allScorers) {
    if (enabledScorers.includes(scorer.name)) {
      engine.register(scorer);
    }
  }
}

function bandFor(score: number, thresholds: { high: number; min: number }): EConfidenceLevel {
  if (score >= thresholds.high) return EConfidenceLevel.HIGH;
  if (score >= thresholds.min) return EConfidenceLevel.MEDIUM;
  return EConfidenceLevel.LOW;
}

/**
 * Runs the cross-encoder reranker, filters out low-relevance candidates, and
 * folds the reranker's score back into each surviving `IScoreResult` so the
 * UI reflects the model's contribution:
 *
 *   1. Pushes a synthetic `semantic-rerank` signal onto `signals[]` — the
 *      existing ResultsTable renders it uniformly with structural signals.
 *   2. Replaces `score` with the reranker's hybrid combined score.
 *   3. Recomputes `confidence` from the new score using ScoringEngine's
 *      same thresholds, so bands stay consistent end-to-end.
 */
/**
 * Pelican scores at or above this bypass the LLM entirely. Structural
 * evidence this strong (direct imports, matching mounts, route ownership)
 * is rarely overturned by the LLM — spending decode time on it is waste.
 * Lives here, not in the reranker, because the reranker still sees these
 * pairs in its result list; we just skip the LLM call for them.
 */
const AUTO_KEEP_PELICAN = 0.9;

async function applyReranker(
  reranker: SemanticReranker,
  changedFile: string,
  scored: IAnalyzeResult['suggestedTests'],
  registry: Registry,
  thresholds: { high: number; min: number },
  explanationsEnabled: boolean,
  onProgress?: (info: { status: string; scored?: number; total?: number }) => void,
  minConfidence?: number,
): Promise<IAnalyzeResult['suggestedTests']> {
  if (scored.length === 0) return scored;

  // Split into auto-kept (high pelican → skip LLM) and "needs LLM".
  // Auto-kept pairs still flow through the final sorted list at their
  // pelican score; they just never see the model.
  const autoKept: IAnalyzeResult['suggestedTests'] = [];
  const toRerank: IAnalyzeResult['suggestedTests'] = [];
  for (const r of scored) {
    if (r.score >= AUTO_KEEP_PELICAN) autoKept.push(r);
    else toRerank.push(r);
  }

  const candidates = toRerank.map((r) => ({
    testFile: r.testFile,
    pelicanScore: r.score,
  }));
  const rerankResults =
    candidates.length > 0
      ? await reranker.rerank(changedFile, candidates, registry, onProgress)
      : [];
  const byFile = new Map(rerankResults.map((r) => [r.testFile, r]));

  const mutated: IAnalyzeResult['suggestedTests'] = [];

  for (const result of autoKept) {
    result.confidence = bandFor(result.score, thresholds);
    if (!explanationsEnabled) result.explanation = '';
    mutated.push(result);
  }

  for (const result of toRerank) {
    const rr = byFile.get(result.testFile);
    if (!rr || !rr.kept) continue;

    result.score = rr.combined;
    result.confidence = bandFor(rr.combined, thresholds);
    if (explanationsEnabled) {
      if (rr.reason) result.explanation = rr.reason;
    } else {
      result.explanation = '';
    }
    result.fromCache = rr.fromCache;

    mutated.push(result);
  }

  // Re-apply the min-confidence floor AFTER rerank. Bucket multipliers can
  // push a combined score below the pre-rerank threshold; without this step
  // the UI would display results the user asked to hide.
  const filtered =
    minConfidence != null ? mutated.filter((r) => r.score >= minConfidence) : mutated;
  filtered.sort((a, b) => b.score - a.score);
  return filtered;
}

/**
 * Pelican-only fallback when the cross-encoder model is unavailable. Applies
 * the same min-confidence cutoff and MUST/SHOULD/MAY thresholds that the
 * reranker path uses, but skips the semantic layer entirely. Keeps the rest
 * of the UI identical so users can still ship a suggestion list.
 */
function pelicanOnly(
  scored: IAnalyzeResult['suggestedTests'],
  thresholds: { high: number; min: number },
): IAnalyzeResult['suggestedTests'] {
  const kept = scored
    .filter((r) => r.score >= thresholds.min)
    .map((r) => {
      r.confidence = bandFor(r.score, thresholds);
      return r;
    });
  kept.sort((a, b) => b.score - a.score);
  return kept;
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
      excludePatterns: config.excludePatterns,
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
    maxResults: options.all
      ? Number.POSITIVE_INFINITY
      : options.maxResults
        ? Number.parseInt(options.maxResults)
        : undefined,
    expanded: options.expanded,
  });

  useEffect(() => {
    const startTime = Date.now();
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
          const raw = Array.isArray(options.files) ? options.files : [options.files];
          changedFiles = raw
            .flatMap((f) => f.split(','))
            .map((f) => f.trim())
            .filter(Boolean);
        } else {
          changedFiles = await getChangedFiles(options.base, options.target);
          if (changedFiles.length === 0) {
            throw new Error('No changed files detected. Specify --files or make changes in git.');
          }
        }

        setState((s) => ({ ...s, changedFiles }));

        if (changedFiles.length === 0) {
          setState((s) => ({ ...s, phase: 'done' }));
          return;
        }

        // Phase 4: Warm up reranker model.
        //
        // We deliberately trigger model load BEFORE scoring so the UI can
        // Phase 4: Check Ollama reranker.
        // Non-blocking — if unavailable, .pelican.lock cache still works.
        setState((s) => ({ ...s, phase: 'checking-reranker' }));

        const reranker = new SemanticReranker({
          debug: options.debug,
          ...(config.rerank?.ollamaModel && { ollamaModel: config.rerank.ollamaModel }),
          ...(config.rerank?.ollamaHost && { ollamaHost: config.rerank.ollamaHost }),
          ...(config.rerank?.fileContent && { fileContent: config.rerank.fileContent }),
          ...(config.rerank?.explanations !== undefined && {
            explanations: config.rerank.explanations,
          }),
          ...(config.rerank?.promptVersion && { promptVersion: config.rerank.promptVersion }),
          ...(config.rerank?.pelicanWeight !== undefined && {
            pelicanWeight: config.rerank.pelicanWeight,
          }),
          ...((options.biEncoder === false || config.rerank?.biEncoder === false) && {
            biEncoderPrefilter: false,
          }),
          ...(config.rerank?.biEncoderModel && { biEncoderModel: config.rerank.biEncoderModel }),
          ...(config.rerank?.biEncoderTopK !== undefined && {
            biEncoderTopK: config.rerank.biEncoderTopK,
          }),
          ...(options.base && { base: options.base }),
          ...(options.target && { target: options.target }),
          useCache: options.cache !== false,
          onProgress: (info) => {
            if (info.status === 'scoring') {
              setState((s) => ({
                ...s,
                rerankScored: info.scored,
                rerankTotal: info.total,
              }));
            }
          },
        });

        let rerankerUnavailable = false;
        let rerankerError: string | undefined;
        if (options.rerank === true) {
          try {
            await reranker.warmUp();
          } catch (err) {
            rerankerUnavailable = true;
            rerankerError =
              err instanceof ModelUnavailableError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : String(err);
            setState((s) => ({
              ...s,
              rerankerUnavailable: true,
              rerankerError,
            }));
          }
        } else {
          rerankerUnavailable = true;
        }

        // Phase 5: Score
        setState((s) => ({ ...s, phase: 'scoring' }));

        const scoringConfig = toScoringConfig(config);
        const engine = new ScoringEngine(scoringConfig, registry);
        registerScorers(engine, config.scoring.enabledScorers);

        const testFiles = registry.getFilesByType('test').map((f) => f.path);
        const maxResults = options.all
          ? Number.POSITIVE_INFINITY
          : parseInt(options.maxResults) || config.scoring.maxResults || 10;
        const thresholds = {
          high: config.scoring.highConfidence ?? 0.8,
          min: config.scoring.minConfidence ?? 0.4,
        };
        // Score files sequentially. Structural scoring is sync/fast; reranking
        // is GPU-bound and Ollama serializes requests on single-GPU setups
        // anyway. Sequential processing keeps Ollama's KV prefix cache hot for
        // each source file's test batch — huge win over interleaved requests
        // that evict each other's cache.
        const rerankThreshold = config.scoring.minConfidence;

        async function processFile(changedFile: string): Promise<IAnalyzeResult> {
          setState((s) => ({
            ...s,
            activeFiles: [...(s.activeFiles ?? []), changedFile],
          }));
          const scoreResults = engine.evaluateTests(changedFile, testFiles);
          const relevant = scoreResults.filter((r) => r.score >= config.scoring.minConfidence);
          const preRerankCount = relevant.length;

          const onFileProgress = (info: {
            status: string;
            scored?: number;
            total?: number;
          }): void => {
            if (info.status !== 'scoring' || info.scored == null || info.total == null) return;
            setState((s) => ({
              ...s,
              rerankProgress: {
                ...(s.rerankProgress ?? {}),
                [changedFile]: { scored: info.scored!, total: info.total! },
              },
            }));
          };

          let finalResults: IAnalyzeResult['suggestedTests'];
          if (rerankerUnavailable) {
            finalResults = pelicanOnly(relevant, thresholds);
          } else {
            const rerankCandidates = relevant.filter((r) => r.score >= rerankThreshold);
            try {
              finalResults = await applyReranker(
                reranker,
                changedFile,
                rerankCandidates,
                registry,
                thresholds,
                config.rerank?.explanations === true,
                onFileProgress,
                config.scoring.minConfidence,
              );
            } catch (err) {
              rerankerUnavailable = true;
              rerankerError = err instanceof Error ? err.message : String(err);
              setState((s) => ({
                ...s,
                rerankerUnavailable: true,
                rerankerError,
              }));
              finalResults = pelicanOnly(relevant, thresholds);
            }
          }

          setState((s) => ({
            ...s,
            completedFiles: [...(s.completedFiles ?? []), changedFile],
            activeFiles: (s.activeFiles ?? []).filter((f) => f !== changedFile),
            progress: (((s.completedFiles?.length ?? 0) + 1) / changedFiles.length) * 100,
          }));

          return {
            changedFile,
            suggestedTests: finalResults.slice(0, maxResults),
            totalCandidates: finalResults.length,
            preRerankCount,
            postRerankCount: finalResults.length,
          };
        }

        // Cross-file parallelism. Each source file has a different prefix
        // (its own source block), so we can't share KV cache across files
        // anyway — running them serially just leaves Ollama's parallel
        // slots idle. With OLLAMA_NUM_PARALLEL>=fileConcurrency, wall-clock
        // divides by ~fileConcurrency. Keep it modest (2) so per-source
        // KV prefix reuse inside `rerankPairs` still wins within each slot.
        const fileConcurrency = Math.min(2, changedFiles.length);
        const fileLimit = pLimit(fileConcurrency);
        const results = await Promise.all(changedFiles.map((f) => fileLimit(() => processFile(f))));

        // Phase 5: Done
        setState((s) => ({
          ...s,
          phase: 'done',
          results,
          elapsedMs: Date.now() - startTime,
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
    debugLog(formatBuildLine());
    debugLog(`config loaded: enabledScorers=${config.scoring.enabledScorers.join(',')}`);
    debugLog(`pathAliases: ${JSON.stringify(config.analyzers.cypressExtractor.pathAliases ?? {})}`);
    debugLog(`ubiquitousSelectorThreshold=${config.scoring.ubiquitousSelectorThreshold ?? 0.1}`);
  }

  const registry = new Registry();
  try {
    const cacheData = await fs.readFile(REGISTRY_CACHE_PATH, 'utf-8');
    registry.deserialize(cacheData);
    if (debug) {
      debugLog(
        `registry loaded from cache: ${registry.files.size} files, ${registry.getSelectorIndex().size} selectors`,
      );
    }
  } catch {
    if (debug) {
      debugLog('registry cache not found, building fresh...');
    }
    const builder = new RegistryBuilder();
    const builtRegistry = await builder.buildFromDirectories({
      sourceDirs: config.sourceDirs,
      testPatterns: config.testPatterns,
      excludePatterns: config.excludePatterns,
      projectRoot: process.cwd(),
      pathAliases: config.analyzers.cypressExtractor.pathAliases,
      debug,
    });
    const dir = path.dirname(REGISTRY_CACHE_PATH);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(REGISTRY_CACHE_PATH, builtRegistry.serialize(), 'utf-8');
    registry.deserialize(builtRegistry.serialize());
  }

  let changedFiles: string[];
  if (options.files) {
    changedFiles = (Array.isArray(options.files) ? options.files : [options.files])
      .flatMap((f: string) => f.split(','))
      .map((f: string) => f.trim())
      .filter(Boolean);
  } else {
    changedFiles = await getChangedFiles(options.base, options.target);
    if (changedFiles.length === 0) {
      process.stderr.write(
        '[pelican] No changed files detected. Specify --files or make changes in git.\n',
      );
      console.log(JSON.stringify({ results: [] }, null, 2));
      return;
    }
    if (debug) {
      debugLog(`auto-detected ${changedFiles.length} changed file(s): ${changedFiles.join(', ')}`);
    }
  }

  const scoringConfig = toScoringConfig(config);
  const engine = new ScoringEngine(scoringConfig, registry);
  registerScorers(engine, config.scoring.enabledScorers);

  const testFiles = registry.getFilesByType('test').map((f) => f.path);
  const maxResults = options.all
    ? Number.POSITIVE_INFINITY
    : parseInt(options.maxResults) || config.scoring.maxResults || 10;

  if (debug) {
    debugLog(
      `scoring ${changedFiles.length} changed file(s) against ${testFiles.length} test file(s)`,
    );
    // Top test selectors by frequency — calibrate ubiquitousSelectorThreshold
    // against this (a selector at share > threshold is disqualified as a match).
    const totalTests = registry.getTestFileCount();
    const top = registry.getTopTestSelectors(30);
    debugLog(`top test selectors (of ${totalTests} specs) — share% · count · value:`);
    for (const { value, count } of top) {
      debugLog(
        `  ${((100 * count) / Math.max(1, totalTests)).toFixed(0).padStart(3)}%  ${count}  ${value}`,
      );
    }
  }

  // Headless progress: write to stderr with a throttled once-per-5%-per-file
  // line so JSON on stdout stays clean. CI logs capture stderr; users don't
  // see Ink TUI in this mode.
  const reranker = new SemanticReranker({
    debug,
    ...(config.rerank?.ollamaModel && { ollamaModel: config.rerank.ollamaModel }),
    ...(config.rerank?.ollamaHost && { ollamaHost: config.rerank.ollamaHost }),
    ...(config.rerank?.fileContent && { fileContent: config.rerank.fileContent }),
    ...(config.rerank?.explanations !== undefined && {
      explanations: config.rerank.explanations,
    }),
    ...(config.rerank?.promptVersion && { promptVersion: config.rerank.promptVersion }),
    ...(config.rerank?.pelicanWeight !== undefined && {
      pelicanWeight: config.rerank.pelicanWeight,
    }),
    ...((options.biEncoder === false || config.rerank?.biEncoder === false) && {
      biEncoderPrefilter: false,
    }),
    ...(config.rerank?.biEncoderModel && { biEncoderModel: config.rerank.biEncoderModel }),
    ...(config.rerank?.biEncoderTopK !== undefined && {
      biEncoderTopK: config.rerank.biEncoderTopK,
    }),
    ...(options.base && { base: options.base }),
    ...(options.target && { target: options.target }),
    useCache: options.cache !== false,
    onProgress: (info) => {
      if (info.status === 'scoring' && info.scored != null && info.total != null) {
        process.stderr.write(`[pelican] reranking ${info.scored}/${info.total}\n`);
      } else if (info.status === 'ready') {
        process.stderr.write('[pelican] reranker ready\n');
      }
    },
  });

  let rerankerUnavailable = options.rerank !== true;
  if (!rerankerUnavailable) {
    try {
      await reranker.warmUp();
    } catch (err) {
      rerankerUnavailable = true;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[pelican] WARNING: Ollama reranker unavailable: ${msg}\n` +
          `[pelican] using pelican structural scoring + .pelican.lock cache only.\n`,
      );
    }
  }

  const thresholds = {
    high: config.scoring.highConfidence ?? 0.8,
    min: config.scoring.minConfidence ?? 0.4,
  };

  async function processFileHeadless(changedFile: string): Promise<IAnalyzeResult> {
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
      // Dump every candidate that clears minConfidence (i.e. every suggested
      // test) with its matched signals — this is what we read back to see which
      // scorer/selector anchored each result and why the count is what it is.
      const kept = scoreResults.filter((r) => r.score >= config.scoring.minConfidence);
      debugLog(`  ${kept.length} candidate(s) ≥ minConfidence ${config.scoring.minConfidence}:`);
      for (const r of kept) {
        debugLog(`  → ${r.testFile}  score=${r.score.toFixed(3)} (${r.confidence})`);
        for (const s of r.signals.filter((sg) => sg.matched)) {
          debugLog(`      ✓ ${s.source} w=${s.weight.toFixed(3)} — ${s.reason}`);
        }
      }
    }

    const relevant = scoreResults.filter((r) => r.score >= config.scoring.minConfidence);
    const rerankThreshold = config.scoring.minConfidence;
    const preRerankCount = relevant.length;
    let reranked: IAnalyzeResult['suggestedTests'];
    if (rerankerUnavailable) {
      reranked = pelicanOnly(relevant, thresholds);
    } else {
      const rerankCandidates = relevant.filter((r) => r.score >= rerankThreshold);
      try {
        reranked = await applyReranker(
          reranker,
          changedFile,
          rerankCandidates,
          registry,
          thresholds,
          config.rerank?.explanations === true,
          undefined,
          config.scoring.minConfidence,
        );
      } catch (err) {
        rerankerUnavailable = true;
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[pelican] rerank failed mid-run: ${msg}\n`);
        reranked = pelicanOnly(relevant, thresholds);
      }
    }
    if (debug) {
      debugLog(`  rerank: ${preRerankCount} → ${reranked.length} after semantic filter`);
    }
    return {
      changedFile,
      suggestedTests: reranked.slice(0, maxResults),
      totalCandidates: reranked.length,
      preRerankCount,
      postRerankCount: reranked.length,
    };
  }

  // Sequential — see comment on the interactive path. Parallel Ollama calls
  // interleave and evict each other's KV prefix cache.
  const results: IAnalyzeResult[] = [];
  for (const changedFile of changedFiles) {
    results.push(await processFileHeadless(changedFile));
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
  .option('-f, --files <paths...>', 'Space- or comma-separated list of changed files')
  .option('-o, --output <format>', 'Output format: tui, json, list', 'tui')
  .option('--min-confidence <number>', 'Minimum confidence threshold', '0.40')
  .option('--max-results <number>', 'Maximum number of results', '10')
  .option('--all', 'Show all suggestions (overrides --max-results)')
  .option('--expanded', 'Show per-source-file breakdown instead of combined list')
  .option('--ci', 'Non-interactive mode (alias for --output json)')
  .option(
    '--rerank',
    'Enable Ollama semantic reranking (off by default — pelican structural scoring + .pelican.lock cache only)',
  )
  .option('--no-cache', 'Bypass .pelican.lock cache; every pair is re-evaluated')
  .option(
    '--no-bi-encoder',
    'Skip embedding cosine prefilter; pelican structural rank acts as the prefilter (faster, often better recall on naming-strong repos)',
  )
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
