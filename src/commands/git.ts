import { Command } from 'commander';
import { execa } from 'execa';

export const gitCommand = new Command('git').description('Git helpers');

gitCommand
  .command('status')
  .description('Show repository status')
  .action(async () => {
    try {
      const result = await execa('git', ['status', '--porcelain=v1', '--branch']);
      console.log(result.stdout);
    } catch {
      console.error('This folder is not a Git repository.');
      process.exit(1);
    }
  });