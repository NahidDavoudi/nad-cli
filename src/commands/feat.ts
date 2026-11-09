import { Command } from 'commander';
import { startFeatureBranch } from '../core/git.js';
import { ui } from '../core/ui.js';

export const featCommand = new Command('feat')
  .argument('<name>', 'Feature name')
  .option('--base <branch>', 'Base branch', 'main')
  .description('Start a new feature branch')
  .action(async (name: string, options: { base: string }) => {
    const branch = await startFeatureBranch(name, options.base);
    ui.success(`Switched to new branch: ${ui.name(branch)}`);
  });
