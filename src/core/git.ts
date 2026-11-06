import { execa } from 'execa';

function isGitMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export async function git(args: string[]): Promise<string> {
    const result = await execa('git', args);
    return result.stdout;
}

export async function isGitRepo(): Promise<boolean> {
    try {
        await git(['rev-parse', '--is-inside-work-tree']);
        return true;
    } catch (error) {
        if (isGitMissing(error)) throw error;
        return false;
    }
}

export async function isClean(): Promise<boolean> {
  const output = await git(['status', '--porcelain']);
  return output === '';
}

export async function currentBranch(): Promise<string> {
  return git(['branch', '--show-current']);
}

export class NotAGitRepoError extends Error {
  constructor() {
    super('This folder is not a Git repository.');
    this.name = 'NotAGitRepoError';
  }
}

export async function statusSummary(): Promise<string> {
  if (!(await isGitRepo())) throw new NotAGitRepoError();
  return git(['status', '--porcelain=v1', '--branch']);
}

export class DirtyTreeError extends Error {
  constructor() {
    super('You have uncommitted changes. Commit them first.');
    this.name = 'DirtyTreeError';
  }
}

export async function startFeatureBranch(name: string, base = 'main'): Promise<string> {
  if (!(await isGitRepo())) throw new NotAGitRepoError();
  if (!(await isClean())) throw new DirtyTreeError();

  await git(['checkout', base]);
  if ((await git(['remote'])) !== '') {
    await git(['pull', '--ff-only']);
  }

  const branch = `feature/${name}`;
  await git(['checkout', '-b', branch]);
  return branch;
}