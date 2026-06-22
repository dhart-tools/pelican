import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

import { Command } from 'commander';
import { render } from 'ink';
import pLimit from 'p-limit';
import React, { useState, useEffect } from 'react';

import {
  loadProjectConfig,
  toScoringConfig,
  getMergedAliases,
  getIgnoreDirs,
} from '@/cli/config-loader';
import { IAnalyzeState, IAnalyzeOptions, IAnalyzeResult, IProjectConfig } from '@/cli/types';
import { loadTheme } from '@/cli/user-config';
import { AnalyzeView } from '@/cli/views/AnalyzeView';
import { GitHistoryProvider } from '@/core/git/git-history-provider';
import { Registry } from '@/core/registry/registry';
import { RegistryBuilder } from '@/core/registry/registry-builder';
import { extractDiffPayload, getChangedFiles } from '@/core/rerank/diff-extractor';
import { createLimiter } from '@/core/rerank/llm/limiter';
import { LLMReranker, IRerankCandidate } from '@/core/rerank/llm/llm-reranker';
import { createProvider } from '@/core/rerank/llm/provider-factory';
import { ModelUnavailableError, SemanticReranker } from '@/core/rerank/semantic-reranker';
import { buildTestPayload } from '@/core/rerank/test-payload';
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
import { TemporalCoherenceScorer } from '@/core/scoring/scorers/temporal-coherence-scorer';
import { TransitiveImportScorer } from '@/core/scoring/scorers/transitive-import-scorer';
import { TranslationMatchScorer } from '@/core/scoring/scorers/translation-match-scorer';
import { UsageSiteScorer } from '@/core/scoring/scorers/usage-site-scorer';
import { ScoringEngine } from '@/core/scoring/scoring-engine';
import { IRepoGitHistory } from '@/types/git';
import { formatBuildLine } from '@/utils/build-info';
import { EConfidenceLevel } from '@/utils/enums';

const REGISTRY_CACHE_PATH = '.pelican/registry.json';

/**
 * Mines git history for the source repo and (if separate) the test repo, keyed
 * by absolute repo root for the temporal-coherence scorer. Always resolves to a
 * map (possibly with unavailable entries) — never throws — so scoring proceeds
 * regardless. Emits rich `--debug` lines: per repo availability, file counts,
 * shallow/no-git reasons, and a sample of mined timestamps.
 */
async function mineGitHistories(
  config: IProjectConfig,
  debug: boolean,
): Promise<Map<string, IRepoGitHistory>> {
  const sourceRoot = config.source.root;
  const testRoot = config.test.root ?? config.source.root;
  const roots = [...new Set([sourceRoot, testRoot])];

  const provider = new GitHistoryProvider(undefined, debug ? (m) => debugLog(m) : undefined);
  const out = new Map<string, IRepoGitHistory>();

  if (debug)
    debugLog(`temporal: mining git history for ${roots.length} repo(s): ${roots.join(', ')}`);

  for (const root of roots) {
    const started = Date.now();
    const history = await provider.getHistory(root);
    out.set(history.repoRoot, history);

    if (!debug) continue;
    const ms = Date.now() - started;
    const label = root === sourceRoot ? 'source' : 'test';
    if (!history.available) {
      debugLog(`temporal: [${label}] ${history.repoRoot} → UNAVAILABLE (no signal) in ${ms}ms`);
      continue;
    }
    debugLog(`temporal: [${label}] ${history.repoRoot} → ${history.files.size} files in ${ms}ms`);
    // Sample a few entries so the timestamps can be eyeballed against reality.
    let shown = 0;
    for (const [p, h] of history.files) {
      const created = new Date(h.createdAt * 1000).toISOString().slice(0, 10);
      const updated = new Date(h.updatedAt * 1000).toISOString().slice(0, 10);
      debugLog(
        `temporal:   ${p} — created ${created}, updated ${updated}, ${h.commits.length} commit(s)`,
      );
      if (++shown >= 5) break;
    }
  }

  return out;
}

/** Max chars of raw source/test code sent to the model per file. */
const RERANK_FILE_CHARS = 8000;

/**
 * Read a file's RAW content (truncated) for the rerank prompt. Resolves the
 * absolute path from the entry's repoRoot (two-repo aware). Returns null if it
 * can't be read, so the caller can fall back.
 */
async function readFileExcerpt(
  repoRoot: string | undefined,
  relPath: string,
): Promise<string | null> {
  if (!repoRoot) return null;
  try {
    const content = await fs.readFile(path.join(repoRoot, relPath), 'utf-8');
    return content.length > RERANK_FILE_CHARS
      ? content.slice(0, RERANK_FILE_CHARS) + '\n…(truncated)'
      : content;
  } catch {
    return null;
  }
}

/**
 * LLM rerank pass (config.rerank). For each changed file it sends the model the
 * RAW change (diff) and each candidate's RAW spec source — the same shape as the
 * hand-validated prompts, NOT a static-analysis summary — and asks whether the
 * spec actually exercises the change. Recall-safe: the reranker auto-keeps
 * strong/anchored candidates and fails open; here we only DROP specs it
 * explicitly rejected.
 *
 * Fail-open at this layer too: any setup error (missing key, bad provider)
 * logs a warning and returns results untouched, so a misconfigured rerank never
 * costs recall.
 */
async function applyLLMRerank(
  results: IAnalyzeResult[],
  config: IProjectConfig,
  registry: Registry,
  debug: boolean,
  base?: string,
  target?: string,
): Promise<IAnalyzeResult[]> {
  const rc = config.rerank;
  if (!rc?.enabled) return results;

  let provider;
  try {
    provider = createProvider(rc);
  } catch (err) {
    process.stderr.write(`[pelican] rerank disabled: ${String(err)}\n`);
    if (debug) debugLog(`rerank: provider init failed — ${String(err)} (results unchanged)`);
    return results;
  }

  const reranker = new LLMReranker(provider, rc, debug ? (m) => debugLog(m) : undefined);
  // ONE limiter shared across every file → a single global in-flight cap, so the
  // parallel files below never multiply into (files × candidates) requests.
  const limiter = createLimiter(rc.concurrency);
  if (debug) {
    debugLog(
      `rerank: provider=${rc.provider} model=${rc.model} band=[${rc.candidateBand.min},${rc.candidateBand.max}) ` +
        `protectAnchors=${rc.protectAnchors} keepThreshold=${rc.keepThreshold} ` +
        `concurrency=${rc.concurrency} maxRetries=${rc.maxRetries}`,
    );
  }

  // Files run in parallel; the shared limiter bounds total concurrent LLM calls.
  return Promise.all(
    results.map(async (result) => {
      const diff = await extractDiffPayload(result.changedFile, base, target);
      // RAW change — the diff is real code (or full file on fallback). No static
      // summary; the model reasons about the actual change.
      const changeSummary = `${diff.fallback ? 'FULL FILE' : 'DIFF'} — ${result.changedFile}\n${diff.text}`;

      const candidates: IRerankCandidate[] = await Promise.all(
        result.suggestedTests.map(async (t) => {
          const entry = registry.getFile(t.testFile);
          // Prefer the ACTUAL spec source (what the validated prompts used); fall
          // back to the derived summary only if the file can't be read.
          const realCode = entry ? await readFileExcerpt(entry.repoRoot, entry.path) : null;
          return {
            testFile: t.testFile,
            score: t.score,
            signals: t.signals,
            testExcerpt: realCode ?? (entry ? buildTestPayload(entry) : t.testFile),
          };
        }),
      );

      const verdicts = await reranker.rerank(
        { changedFile: result.changedFile, changeSummary },
        candidates,
        limiter,
      );
      const dropped = new Set(verdicts.filter((v) => !v.kept).map((v) => v.testFile));

      if (debug) {
        const judged = verdicts.filter((v) => v.judged).length;
        debugLog(
          `rerank: ${result.changedFile} — ${candidates.length} candidate(s), ${judged} judged, ${dropped.size} dropped`,
        );
        for (const v of verdicts) {
          debugLog(`    ${v.kept ? 'KEEP' : 'DROP'} ${v.testFile} — ${v.reason}`);
        }
      }

      const kept = result.suggestedTests.filter((t) => !dropped.has(t.testFile));
      return {
        ...result,
        suggestedTests: kept,
        totalCandidates: kept.length,
        postRerankCount: kept.length,
      };
    }),
  );
}

/** Registers every scorer (all scorers are always on). */
function registerScorers(engine: ScoringEngine): void {
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
    new TemporalCoherenceScorer(),
  ];
  for (const scorer of allScorers) engine.register(scorer);
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
      sourceDirs: config.source.dirs,
      testPatterns: config.test.patterns,
      excludePatterns: config.test.exclude,
      ignoreDirs: getIgnoreDirs(config),
      sourceRoot: config.source.root,
      testRoot: config.test.root ?? config.source.root,
      pathAliases: getMergedAliases(config),
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
          config.behaviour.minConfidence = parseFloat(options.minConfidence);
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
          ...(options.biEncoder === false && { biEncoderPrefilter: false }),
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

        // Mine without debug spam — the TUI path has no debug file sink, so
        // logging would corrupt the rendered frames. Read temporal debug from
        // a headless `--debug`/`--ci` run instead.
        const gitHistories = await mineGitHistories(config, false);
        const scoringConfig = toScoringConfig(config);
        const engine = new ScoringEngine(scoringConfig, registry, gitHistories);
        registerScorers(engine);

        const testFiles = registry.getFilesByType('test').map((f) => f.path);
        const maxResults = options.all
          ? Number.POSITIVE_INFINITY
          : parseInt(options.maxResults) || config.behaviour.maxResults || 10;
        const thresholds = {
          high: config.behaviour.highConfidence ?? 0.8,
          min: config.behaviour.minConfidence ?? 0.4,
        };
        // Score files sequentially. Structural scoring is sync/fast; reranking
        // is GPU-bound and Ollama serializes requests on single-GPU setups
        // anyway. Sequential processing keeps Ollama's KV prefix cache hot for
        // each source file's test batch — huge win over interleaved requests
        // that evict each other's cache.
        const rerankThreshold = config.behaviour.minConfidence;

        async function processFile(changedFile: string): Promise<IAnalyzeResult> {
          setState((s) => ({
            ...s,
            activeFiles: [...(s.activeFiles ?? []), changedFile],
          }));
          const scoreResults = engine.evaluateTests(changedFile, testFiles);
          const relevant = scoreResults.filter((r) => r.score >= config.behaviour.minConfidence);
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
                false,
                onFileProgress,
                config.behaviour.minConfidence,
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
export async function runHeadless(
  options: IAnalyzeOptions,
  runOptions: { debugFileOnly?: boolean } = {},
): Promise<void> {
  const debug = options.debug ?? false;
  if (debug) initAnalyzeDebugFile();
  const config = await loadProjectConfig(options.config);
  if (options.minConfidence) {
    config.behaviour.minConfidence = parseFloat(options.minConfidence);
  }

  if (debug) {
    debugLog(formatBuildLine());
    debugLog(
      `config: minConfidence=${config.behaviour.minConfidence} maxResults=${config.behaviour.maxResults}`,
    );
    debugLog(`pathAliases: ${JSON.stringify(getMergedAliases(config) ?? {})}`);
    debugLog(`ubiquitousSelectorThreshold=${config.behaviour.ubiquitousSelectorThreshold ?? 0.1}`);
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
      sourceDirs: config.source.dirs,
      testPatterns: config.test.patterns,
      excludePatterns: config.test.exclude,
      ignoreDirs: getIgnoreDirs(config),
      sourceRoot: config.source.root,
      testRoot: config.test.root ?? config.source.root,
      pathAliases: getMergedAliases(config),
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

  const gitHistories = await mineGitHistories(config, debug);
  const scoringConfig = toScoringConfig(config);
  const engine = new ScoringEngine(scoringConfig, registry, gitHistories);
  registerScorers(engine);

  const testFiles = registry.getFilesByType('test').map((f) => f.path);
  const maxResults = options.all
    ? Number.POSITIVE_INFINITY
    : parseInt(options.maxResults) || config.behaviour.maxResults || 10;

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
    ...(options.biEncoder === false && { biEncoderPrefilter: false }),
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
    high: config.behaviour.highConfidence ?? 0.8,
    min: config.behaviour.minConfidence ?? 0.4,
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
      const kept = scoreResults.filter((r) => r.score >= config.behaviour.minConfidence);
      debugLog(`  ${kept.length} candidate(s) ≥ minConfidence ${config.behaviour.minConfidence}:`);
      for (const r of kept) {
        debugLog(`  → ${r.testFile}  score=${r.score.toFixed(3)} (${r.confidence})`);
        for (const s of r.signals.filter((sg) => sg.matched)) {
          debugLog(`      ✓ ${s.source} w=${s.weight.toFixed(3)} — ${s.reason}`);
        }
      }
    }

    const relevant = scoreResults.filter((r) => r.score >= config.behaviour.minConfidence);
    const rerankThreshold = config.behaviour.minConfidence;
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
          false,
          undefined,
          config.behaviour.minConfidence,
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

  // Optional LLM rerank (config.rerank) — independent of the Ollama path above.
  // Only drops specs the model explicitly rejected; recall-safe + fail-open.
  const finalResults = await applyLLMRerank(
    results,
    config,
    registry,
    debug,
    options.base,
    options.target,
  );

  // In TUI mode we run this path only to populate analyze-debug.log; the JSON
  // belongs on stdout only for a real headless/json invocation.
  if (!runOptions.debugFileOnly) {
    console.log(JSON.stringify({ results: finalResults }, null, 2));
  }
  if (debug) {
    debugLog(
      `done — ${finalResults.reduce((n, r) => n + (r.totalCandidates ?? 0), 0)} total suggestions`,
    );
  }
}

const ANALYZE_DEBUG_LOG = 'analyze-debug.log';
let debugSink: ((msg: string) => void) | null = null;

// When --debug is set, route debug to ./analyze-debug.log (auto-created and
// truncated per run) rather than stderr. The TUI renders on stdout and the
// headless debug code never ran in TUI mode, so `2> analyze-debug.log` only
// captured TUI frames. A dedicated file is captured consistently either way.
function initAnalyzeDebugFile(): void {
  try {
    fsSync.writeFileSync(ANALYZE_DEBUG_LOG, '');
    debugSink = (m) => fsSync.appendFileSync(ANALYZE_DEBUG_LOG, `[debug] ${m}\n`);
  } catch {
    debugSink = null; // fall back to stderr
  }
}

function debugLog(msg: string): void {
  if (debugSink) debugSink(msg);
  else process.stderr.write(`[debug] ${msg}\n`);
}

// ─── Commander Action ────────────────────────────────────────────

export const analyzeCommand = new Command('analyze')
  .alias('suggest')
  .description('Analyze changes and suggest tests to run')
  .option('-b, --base <ref>', 'Base git reference (default: HEAD~1)')
  .option('-t, --target <ref>', 'Target git reference (default: HEAD)')
  .option('-f, --files <paths...>', 'Space- or comma-separated list of changed files')
  .option('-o, --output <format>', 'Output format: tui, json, list', 'tui')
  // No CLI defaults here on purpose: a hardcoded default makes commander
  // always populate the option, which then clobbers the value from
  // .pelicanrc.json on every run. Leaving them unset means the flag overrides
  // config ONLY when the user actually passes it; otherwise config wins
  // (falling back to DEFAULT_CONFIG: minConfidence 0.4, maxResults 10).
  .option('--min-confidence <number>', 'Minimum confidence threshold (default: from config)')
  .option('--max-results <number>', 'Maximum number of results (default: from config)')
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
  .option('--debug', 'Write detailed scoring diagnostics to ./analyze-debug.log (any output mode)')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (opts: IAnalyzeOptions) => {
    // --ci is shorthand for --output json
    if (opts.ci) opts.output = 'json';

    if (opts.output === 'json') {
      await runHeadless(opts);
      return;
    }

    // TUI mode: the interactive view doesn't emit debug, so when --debug is set
    // run the headless scoring pass first purely to write analyze-debug.log
    // (no stdout), then render the TUI as usual. Keeps `--debug` consistent
    // with setup — you always get a debug log file, regardless of output mode.
    if (opts.debug) {
      try {
        await runHeadless(opts, { debugFileOnly: true });
        process.stderr.write(`[pelican] wrote analyze-debug.log\n`);
      } catch (e) {
        process.stderr.write(`[pelican] debug log generation failed: ${e}\n`);
      }
    }

    await loadTheme();
    const { waitUntilExit } = render(<AnalyzeApp options={opts} />);
    await waitUntilExit();
  });
