import { Command } from 'commander';
import { statusSummary } from '../core/git.js';
import { ui } from '../core/ui.js';

export const gitCommand = new Command('git').description('Git helpers');

gitCommand
  .command('status')
  .description('Show repository status')
  .action(async () => {
    ui.plain(await statusSummary());
  });