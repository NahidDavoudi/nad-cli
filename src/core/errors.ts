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

export class BranchExistsError extends NadError {
  constructor(branch: string) {
    super(
      `Branch '${branch}' already exists.`,
      `Switch to it with: ${ui.code('git checkout ' + branch)}`,
    );
  }
}

export function handleError(error: unknown): never {
  if (error instanceof NadError) {
    ui.error(error.message);
    if (error.hint) ui.hint(error.hint);
    process.exit(error.exitCode);
  }

  if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
    ui.error('git was not found. Is it installed and in your PATH?');
    process.exit(1);
  }

  ui.error(`Unexpected error: ${(error as Error).message}`);
  process.exit(1);
}