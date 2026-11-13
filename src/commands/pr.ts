import { Command } from 'commander';
import { createPullRequest } from '../core/pr.js';
import { ui } from '../core/ui.js';

export const prCommand = new Command('pr')
  .argument('<title>', 'Pull request title')
  .option('--merge', 'Wait for CI, merge (squash), delete the branch, and sync main')
  .description('Open a pull request; with --merge, also wait for CI and merge it')
  .action(async (title: string, opts: { merge?: boolean }) => {
    const merge = Boolean(opts.merge);
    const url = await createPullRequest(title, { merge });
    ui.success(
      merge ? `Merged: ${ui.code(url)}` : `Pull request ready: ${ui.code(url)}`,
    );
  });
