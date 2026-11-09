import { Command } from 'commander';
import { createPullRequest } from '../core/pr.js';
import { ui } from '../core/ui.js';

export const prCommand = new Command('pr')
  .argument('<title>', 'Pull request title')
  .description('Open a pull request for the current branch')
  .action(async (title: string) => {
    const url = await createPullRequest(title);
    ui.success(`Pull request ready: ${ui.code(url)}`);
  });
