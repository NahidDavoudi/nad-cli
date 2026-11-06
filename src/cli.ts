#!/usr/bin/env node
import { Command } from 'commander';
import { hiCommand } from './commands/hi.js';
import { gitCommand } from './commands/git.js';
import { featCommand } from './commands/feat.js';
import { handleError } from './core/errors.js';

const program = new Command();
program.name('nad').description('NAD CLI').version('0.0.1');

program.addCommand(hiCommand);
program.addCommand(gitCommand);
program.addCommand(featCommand);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  handleError(error);
}