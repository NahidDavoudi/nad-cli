#!/usr/bin/env node
import { Command } from 'commander';
import { hiCommand } from './commands/hi.js';
import { gitCommand } from './commands/git.js';
import { featCommand } from './commands/feat.js';
import { handleError } from './core/errors.js';

const program = new Command();
program.name('nad').description('NAD CLI').version('0.0.1');
program.option('--verbose', 'Show full stack traces');
program.addCommand(hiCommand);
program.addCommand(gitCommand);
program.addCommand(featCommand);

// exitOverride is not inherited: apply to every command, and silence
// commander's own output so handleError renders it consistently.
for (const cmd of [program, ...program.commands]) {
  cmd.exitOverride().configureOutput({ writeErr: () => {} });
}
program.showSuggestionAfterError();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  handleError(error);
}