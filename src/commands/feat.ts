import { Command } from 'commander';
import { startFeatureBranch, NotAGitRepoError, DirtyTreeError, BranchExistsError } from '../core/git.js';

export const featCommand = new Command('feat')
  .argument('<name>', 'Feature name')
  .option('--base <branch>', 'Base branch', 'main')
  .description('Start a new feature branch')
  .action(async (name: string, options: { base: string }) => {
    try {
      const branch = await startFeatureBranch(name, options.base);
      console.log(`Switched to new branch: ${branch}`);
    } catch (error) {
      if (error instanceof NotAGitRepoError || error instanceof DirtyTreeError || error instanceof BranchExistsError) {
        console.error(error.message);
      } else {
        console.error(`Git failed: ${(error as Error).message}`);
      }
      process.exit(1);
    }
  });