import * as fs from 'fs/promises';
import * as path from 'path';

import { getRepoRoot, findChangedFiles } from '@v2/core/git';
import { RegistryBuilder } from '@v2/core/registry/registry-builder';
import { loadRegistryCache, saveRegistryCache } from '@v2/core/registry/registry-cache';
import { createRegistry } from '@v2/core/registry/registry';
import { ScoringEngine } from '@v2/core/scoring/scoring-engine';

import { loadConfig } from '../config-loader';
import { EXIT_CODES } from '@v2/utils/exit-codes';
import { IScoreResult, ISuggestionResult } from '@v2/types';
import Table from 'cli-table3';
import chalk from 'chalk';

import { DirectImportScorer } from '@v2/core/scoring/scorers/direct-import-scorer';
import { FilenameConventionScorer } from '@v2/core/scoring/scorers/filename-convention-scorer';
import { RouteMatchScorer } from '@v2/core/scoring/scorers/route-match-scorer';
import { SelectorMatchScorer } from '@v2/core/scoring/scorers/selector-match-scorer';
import { TransitiveImportScorer } from '@v2/core/scoring/scorers/transitive-import-scorer';

/**
 * Main analyze command logic.
 * Detects changes, updates the registry (incrementally if possible),
 * scores test relevance, and outputs results.
 */
export async function runAnalyze(options: {
  base?: string;
  output?: 'table' | 'json' | 'list';
  minConfidence?: string;
  maxResults?: string;
}): Promise<void> {
  const projectRoot = getRepoRoot();
  const config = await loadConfig(projectRoot);

  // 1. Determine changed files
  const changedFiles = await findChangedFiles(options.base);
  if (changedFiles.length === 0) {
    console.log(chalk.yellow('ℹ No changed source files detected.'));
    process.exit(EXIT_CODES.NO_CHANGED_FILES);
  }

  // 2. Load or Build Registry
  const registry = createRegistry();
  const cachePath = path.join(projectRoot, '.suggestor/registry.json');
  const cacheResult = await loadRegistryCache(cachePath, config, projectRoot, registry);

  if (cacheResult.registry) {
    console.log(chalk.green('✓ Loaded registry from cache'));
  } else {
    // If cache is stale, we could do incremental update here as per Gap 11,
    // but for initial implementation simplicity we'll rebuild.
    // (Actual Gap 11 implementation would loop over cacheResult.metadata.fileHash diffs)
    console.log(chalk.cyan(`⚠ Cache invalidated (${cacheResult.reason}), rebuilding...`));
    await RegistryBuilder.build(config, projectRoot, (p) => {
       process.stdout.write(`\r  [${p.current}/${p.total}] ${p.message.padEnd(80)}`);
    });
    process.stdout.write('\r' + ' '.repeat(100) + '\r');
    await saveRegistryCache(registry, cachePath, config, projectRoot);
  }

  // 3. Score Relevance
  const engine = new ScoringEngine(config, registry);
  
  // Register default scorers
  engine.register(new DirectImportScorer());
  engine.register(new SelectorMatchScorer());
  engine.register(new RouteMatchScorer());
  engine.register(new FilenameConventionScorer());
  engine.register(new TransitiveImportScorer());

  const allTestFiles = registry.getFilesByType('test').map((f) => f.path);

  const results: ISuggestionResult[] = [];
  for (const changedFile of changedFiles) {
    const relevantTests = engine.evaluateTests(changedFile, allTestFiles);
    if (relevantTests.length > 0) {
      results.push({ changedFile, relevantTests });
    }
  }

  // 4. Output results
  const outputFormat = options.output || 'table';
  renderResults(results, outputFormat, config);
}

function renderResults(results: ISuggestionResult[], format: string, config: any): void {
  const minScore = config.scoring?.minConfidence ?? 0.4;

  if (results.length === 0) {
    console.log(chalk.bold.red('\nNo relevant tests found for your changes.'));
    return;
  }

  if (format === 'json') {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  results.forEach(({ changedFile, relevantTests }) => {
    console.log(chalk.bold.blue(`\nSuggestions for: ${path.relative(process.cwd(), changedFile)}`));
    
    if (format === 'table') {
      const table = new Table({
        head: ['Test File', 'Score', 'Confidence', 'Explanation'],
        colWidths: [40, 10, 12, 60],
        wordWrap: true
      });

      relevantTests
        .filter(t => t.score >= minScore)
        .forEach(t => {
          table.push([
            path.relative(process.cwd(), t.testFile),
            t.score.toFixed(2),
            formatConfidence(t.confidence),
            t.explanation
          ]);
        });
      
      console.log(table.toString());
    } else {
      // List/default format
      relevantTests
        .filter(t => t.score >= minScore)
        .forEach((t, i) => {
          console.log(`${i+1}. ${chalk.cyan(path.relative(process.cwd(), t.testFile))} [${t.score.toFixed(2)}]`);
          console.log(`   ${chalk.gray(t.explanation)}`);
        });
    }
  });
}

function formatConfidence(level: string): string {
  switch (level) {
    case 'high': return chalk.bold.green('HIGH');
    case 'medium': return chalk.bold.yellow('MEDIUM');
    case 'low': return chalk.bold.red('LOW');
    default: return level.toUpperCase();
  }
}
