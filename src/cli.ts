#!/usr/bin/env node
import { Command } from 'commander';
import { hiCommand } from './commands/hi.js';
import { gitCommand } from './commands/git.js';
import { featCommand } from './commands/feat.js';
import { initCommand } from './commands/init.js';
import { inspectCommand } from './commands/inspect.js';
import {commitCommand} from './commands/commit.js';
import { handleError } from './core/errors.js';

const program = new Command();
program.name('nad').description('NAD CLI').version('0.0.1');
program.option('--verbose', 'Show full stack traces');
program.addCommand(hiCommand);
program.addCommand(gitCommand);
program.addCommand(featCommand);
program.addCommand(initCommand);
program.addCommand(inspectCommand);
program.addCommand(commitCommand);

// exitOverride is not inherited: apply to every command, and silence
// commander's own output so handleError renders it consistently.
const applyToAll = (cmd: Command): void => {
  cmd.exitOverride().configureOutput({ outputError: () => {} });
  cmd.commands.forEach(applyToAll);
};
applyToAll(program);
program.showSuggestionAfterError();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  handleError(error);
}