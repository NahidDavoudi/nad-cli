import { Command } from 'commander';
import { createPullRequest } from '../core/pr.js';
import { ui } from '../core/ui.js';

export const prCommand = new Command('pr')
  .argument('<title>', 'Pull request title')
  .option('--no-merge', 'Only open the PR; skip waiting for CI and merging')
  .description('Open a pull request, wait for CI, merge it, and clean up')
  .action(async (title: string, opts: { merge: boolean }) => {
    const url = await createPullRequest(title, { merge: opts.merge });
    ui.success(
      opts.merge ? `Merged: ${ui.code(url)}` : `Pull request ready: ${ui.code(url)}`,
    );
  });
