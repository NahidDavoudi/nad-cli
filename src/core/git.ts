import { execa } from 'execa';
import { NotAGitRepoError, DirtyTreeError, BranchExistsError } from './errors.js';

export async function git(args: string[]): Promise<string> {
  const result = await execa('git', args);
  return result.stdout;
}

function isGitMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
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

async function branchExists(branch: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

async function hasUpstream(): Promise<boolean> {
  try {
    await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    return true;
  } catch {
    return false;
  }
}

export async function statusSummary(): Promise<string> {
  if (!(await isGitRepo())) throw new NotAGitRepoError();
  return git(['status', '--porcelain=v1', '--branch']);
}

export async function startFeatureBranch(name: string, base = 'main'): Promise<string> {
  if (!(await isGitRepo())) throw new NotAGitRepoError();
  if (!(await isClean())) throw new DirtyTreeError();

  const branch = `feature/${name}`;
  if (await branchExists(branch)) throw new BranchExistsError(branch);

  await git(['checkout', base]);
  if (await hasUpstream()) {
    await git(['pull', '--ff-only']);
  }

  await git(['checkout', '-b', branch]);
  return branch;
}