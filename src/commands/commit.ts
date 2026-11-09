import { Command } from 'commander';
import { commitAll } from '../core/git.js';
import { ui } from '../core/ui.js';

export const commitCommand = new Command('commit')
  .argument('<message>', 'Commit message')
  .description('Commit all changes to the current branch')
  .action(async (message: string) => {
    const commitHash = await commitAll(message);
    ui.success(`Committed changes with hash: ${ui.code(commitHash)}`);
  });
