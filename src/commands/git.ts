import { Command } from 'commander';
import { statusSummary } from '../core/git.js';
import { detectRepairIssues, untrack } from '../core/repair.js';
import { ui } from '../core/ui.js';

export const gitCommand = new Command('git').description('Git helpers');

gitCommand
  .command('status')
  .description('Show repository status')
  .action(async () => {
    ui.plain(await statusSummary());
  });

const repair = gitCommand.command('repair').description('Detect and fix git hygiene problems');

repair
  .command('detect')
  .description('Read-only scan for tracked files that are ignored or known-bad')
  .action(async () => {
    const result = await detectRepairIssues();
    let found = false;
    if (result.ignored.length > 0) {
      found = true;
      ui.plain('Tracked files that match .gitignore:');
      for (const f of result.ignored) ui.plain(`  ${f.dir} — ${f.count} file(s)`);
    }
    if (result.knownBad.length > 0) {
      found = true;
      ui.plain('Tracked files that are known-bad:');
      for (const f of result.knownBad) ui.plain(`  ${f.dir} — ${f.count} file(s)`);
    }
    if (result.vendorWarning) {
      ui.warn('vendor/ is tracked but the Dockerfile has no `composer install` — vendor may be committed on purpose.');
    }
    if (!found) {
      ui.success('Nothing tracked needs untracking.');
      return;
    }
    const dirs = [...new Set([...result.ignored, ...result.knownBad].map((f) => f.dir))];
    ui.hint(`Fix with: ${ui.code(`nad git repair untrack ${dirs.join(' ')} --apply`)}`);
  });

repair
  .command('untrack')
  .argument('<paths...>', 'Tracked files or directories to remove from the index')
  .option('--apply', 'Apply the change (default is a dry run)')
  .description('Remove paths from the git index (files stay on disk) and add them to .gitignore')
  .action(async (paths: string[], opts: { apply?: boolean }) => {
    const apply = Boolean(opts.apply);
    const result = await untrack(paths, apply);
    if (result.items.length === 0) {
      ui.success('Nothing to untrack.');
      return;
    }
    for (const item of result.items) {
      ui.plain(`  ${item.path} — ${item.files} file(s), ${formatBytes(item.bytes)}`);
    }
    if (!apply) {
      ui.info('Dry run — nothing was changed. These files would be removed from the git index only; they stay on disk.');
      ui.hint(`Re-run with ${ui.code('--apply')} to apply.`);
      return;
    }
    if (result.gitignoreUpdated) ui.success('Updated .gitignore.');
    for (const keep of result.gitkeeps) {
      const verb = keep.restored ? 'Restored' : 'Created';
      ui.success(`${verb} ${ui.code(keep.path)} so the empty directory survives in git.`);
    }
    ui.warn('Untracking only affects future commits: the files stay in old history, the repo does not shrink, and any secret that was ever committed must be considered leaked and rotated.');
    ui.warn('Anyone or any server that runs `git pull` after you commit this will have those files DELETED from its working directory. Back up uploads/storage on servers that update via git pull first.');
    ui.hint(`Next: ${ui.code('nad commit "<message>"')}`);
  });

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
