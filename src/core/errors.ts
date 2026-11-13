import { ui } from './ui.js';

export class NadError extends Error {
  constructor(
    message: string,
    public hint?: string,
    public exitCode = 1,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotAGitRepoError extends NadError {
  constructor() {
    super('This folder is not a Git repository.');
  }
}

export class DirtyTreeError extends NadError {
  constructor() {
    super('You have uncommitted changes.', 'Commit them first.');
  }
}

export class NothingToCommitError extends NadError {
  constructor() {
    super('You have no changes to commit.', 'Add some changes first.');
  }
}

export class ProtectedBranchError extends NadError {
  constructor() {
    super('You are on the main branch.', 'Start a branch with: nad feat <name>.');
  }
}

export class DetachedHeadError extends NadError {
  constructor() {
    super('You are in detached HEAD state (not on any branch).', 'Create a branch first: nad feat <name>.');
  }
}

export class EmptyMessageError extends NadError {
  constructor() {
    super('Commit message is empty.', 'Use: nad commit "<message>".');
  }
}

export class NoCommitsToPrError extends NadError {
  constructor() {
    super('No commits ahead of main yet.', 'Commit first: nad commit "<message>".');
  }
}

export class ChecksFailedError extends NadError {
  constructor(reason?: string) {
    super(
      reason ? `CI checks failed.\n${reason}` : 'CI checks failed.',
      'Run `gh pr checks` for details, fix, commit, then run `nad pr --merge` again.',
    );
  }
}

export class NoPathsGivenError extends NadError {
  constructor() {
    super('No paths given.', 'Pass at least one path: nad git repair untrack <path...>');
  }
}

export class InvalidPathError extends NadError {
  constructor(path: string) {
    super(`Invalid path: ${path}`, 'Use a relative path inside the repository, e.g. uploads/.');
  }
}

export class ChecksNotReportedError extends NadError {
  constructor(branch: string) {
    super(
      `No CI checks were reported for ${branch}.`,
      'CI may still be starting; try again shortly. If this repo has no CI, merge with: gh pr merge ' + branch + ' --squash',
    );
  }
}

export class GhNotFoundError extends NadError {
  constructor() {
    super('GitHub CLI (gh) was not found.', 'Install it: https://cli.github.com');
  }
}

export class GhNotAuthenticatedError extends NadError {
  constructor() {
    super('You are not logged in to the GitHub CLI.', 'Run: gh auth login');
  }
}

export class BranchExistsError extends NadError {
  constructor(branch: string) {
    super(
      `Branch '${branch}' already exists.`,
      `Switch to it with: ${ui.code('git checkout ' + branch)}`,
    );
  }
}

export class GitCommandError extends NadError {
  constructor(command: string, stderr: string) {
    super(
      `git ${command} failed.${stderr ? `\n${stderr}` : ''}`,
      'Run with --verbose or DEBUG=nad to see the full stack trace.',
    );
  }
}

export class GitNotFoundError extends NadError {
  constructor() {
    super(
      'git was not found. Is it installed and in your PATH?',
      'Install git: https://git-scm.com/downloads',
    );
  }
}

export class BaseBranchNotFoundError extends NadError {
  constructor(base: string) {
    super(
      `Base branch '${base}' does not exist.`,
      `Use an existing branch: ${ui.code('--base <branch>')}`,
    );
  }
}

function isVerbose(): boolean {
  return (
    process.argv.includes('--verbose') ||
    (process.env.DEBUG ?? '').split(',').some((flag) => flag.trim() === 'nad')
  );
}

function isMissingGit(error: unknown): boolean {
  const err = error as NodeJS.ErrnoException & { command?: string };
  return err?.code === 'ENOENT' && (err.command ?? '').split(' ')[0] === 'git';
}

function isCommanderError(error: unknown): error is { code: string; message: string; exitCode: number } {
  return typeof (error as { code?: unknown })?.code === 'string' &&
    (error as { code: string }).code.startsWith('commander.');
}

export function handleError(error: unknown): never {
  if (isCommanderError(error)) {
    // help/version were already printed by commander; nothing to add.
    if (error.exitCode === 0 || error.code === 'commander.help') process.exit(error.exitCode);
    ui.error(error.message.replace(/^error: /, ''));
    ui.hint(`Run with ${ui.code('--help')} for usage.`);
    process.exit(error.exitCode);
  }

  if (isMissingGit(error)) error = new GitNotFoundError();

  if (error instanceof NadError) {
    ui.error(error.message);
    if (error.hint) ui.hint(error.hint);
    if (isVerbose() && error.stack) ui.plain(error.stack);
    process.exit(error.exitCode);
  }

  ui.error(`Unexpected error: ${(error as Error).message}`);
  const stack = (error as Error).stack;
  if (isVerbose() && stack) ui.plain(stack);
  process.exit(1);
}