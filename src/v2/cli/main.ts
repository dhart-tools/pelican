import { Command } from 'commander';
import chalk from 'chalk';

import { runAnalyze } from './commands/analyze';
import { runBuildRegistry } from './commands/build-registry';
import { runConfig } from './commands/config';
import { runSetup } from './commands/setup';

const program = new Command();

program
  .name('suggestor')
  .description('Test Suggestor (V2) - Intelligence for Cypress Test Selection')
  .version('2.0.0');

// --- ANALYZE / SUGGEST ---
program
  .command('analyze')
  .alias('suggest')
  .description('Identify tests affected by current code changes')
  .option(
    '-b, --base <ref>',
    'Git reference to compare against (e.g., main, HEAD~1). Default: HEAD~1',
  )
  .option('-o, --output <format>', 'Output format: table, json, list (default: table)')
  .option('--min-confidence <score>', 'Filter results below this confidence score (0.0 - 1.0)')
  .option('--max-results <n>', 'Limit the number of suggestions per file')
  .action(async (options) => {
    try {
      await runAnalyze(options);
    } catch (error) {
      console.error(chalk.red(`\n✖ Error during analysis: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// --- SETUP ---
program
  .command('setup')
  .description('Interactive setup wizard to initialize .suggestorrc.json')
  .option('-a, --auto', 'Enable auto-detection mode (non-interactive)')
  .action(async (options) => {
    try {
      await runSetup(process.cwd(), options);
    } catch (error) {
      console.error(chalk.red(`\n✖ Error during setup: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// --- REGISTRY ---
const registry = program.command('registry').description('Manage the Suggestor file registry');

registry
  .command('build')
  .description('Manually rebuild the project registry and refresh the cache')
  .option('-f, --force', 'Force a clean rebuild (ignores cache)')
  .action(async (options) => {
    try {
      await runBuildRegistry(options);
    } catch (error) {
      console.error(chalk.red(`\n✖ Error during registry build: ${(error as Error).message}`));
      process.exit(4);
    }
  });

// --- CONFIG ---
program
  .command('config')
  .description('Manage suggestor configuration')
  .argument('<action>', 'Action: get, set, list')
  .argument('[key]', 'Config key (e.g., scoring.minConfidence)')
  .argument('[value]', 'New value (as JSON or string)')
  .action(async (action, key, value) => {
    const validActions = ['get', 'set', 'list'];
    if (!validActions.includes(action)) {
      console.error(chalk.red(`Invalid action "${action}". Valid actions: ${validActions.join(', ')}`));
      process.exit(3);
    }

    try {
      await runConfig(action as any, key, value);
    } catch (error) {
      console.error(chalk.red(`\n✖ Config error: ${(error as Error).message}`));
      process.exit(3);
    }
  });

export function main() {
  // If no arguments, show help
  if (!process.argv.slice(2).length) {
    program.outputHelp();
    return;
  }
  program.parse(process.argv);
}
