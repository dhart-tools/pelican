#!/usr/bin/env node
import { Command } from 'commander';
import { registerV2Commands } from './index';

const program = new Command();

program
  .name('pelican')
  .description('Pelican — semantic test suggester for Cypress')
  .version('2.0.0');

registerV2Commands(program);

// Default action: show help on no args, error on unknown command
program.action(() => {
  if (program.args.length > 0) {
    console.error(
      'Invalid command: %s\nSee --help for a list of available commands.',
      program.args.join(' '),
    );
    process.exit(1);
  }
  program.help(); // exits 0
});

program.parse();
