import { Command } from 'commander';

import { analyzeCommand } from './commands/analyze';
import { demoCommand } from './commands/demo';
import { registryBuildCommand } from './commands/registry-build';
import { setupCommand } from './commands/setup';
import { themeCommand } from './commands/theme';

/**
 * Registers all v2 CLI commands onto the given Commander program.
 *
 * @example
 *   // In src/cli.ts:
 *   import { registerV2Commands } from '@/cli';
 *   registerV2Commands(program);
 */
export function registerV2Commands(program: Command): void {
  program.addCommand(analyzeCommand);
  program.addCommand(setupCommand);
  program.addCommand(registryBuildCommand);
  program.addCommand(themeCommand);
  program.addCommand(demoCommand);
}
