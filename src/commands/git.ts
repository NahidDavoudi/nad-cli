import { Command } from 'commander';
import { statusSummary, NotAGitRepoError } from '../core/git.js';

export const gitCommand = new Command('git').description('Git helpers');

gitCommand
  .command('status')
  .description('Show repository status')
  .action(async () => {
  try {
    console.log(await statusSummary());
  } catch (error) {
    if (error instanceof NotAGitRepoError) {
      console.error(error.message);
    } else {
      console.error(`Git failed: ${(error as Error).message}`);
    }
    process.exit(1);
  }
});