import { execa } from 'execa';
import {
  NotAGitRepoError,
  DirtyTreeError,
  BranchExistsError,
  GitCommandError,
  GitNotFoundError,
  BaseBranchNotFoundError,
  ProtectedBranchError,
  DetachedHeadError,
  EmptyMessageError,
  NothingToCommitError
} from './errors.js';

export async function git(args: string[]): Promise<string> {
  try {
    const result = await execa('git', args);
    return result.stdout;
  } catch (error) {
    const err = error as { code?: string; command?: string; stderr?: string };
    if (err.code === 'ENOENT' && (err.command ?? '').split(' ')[0] === 'git') {
      throw new GitNotFoundError();
    }
    throw new GitCommandError(args.join(' '), (err.stderr ?? '').trim());
  }
}

export async function isGitRepo(): Promise<boolean> {
  try {
    await git(['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch (error) {
    if (error instanceof GitNotFoundError) throw error;
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

async function refExists(ref: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
}

async function branchExists(branch: string): Promise<boolean> {
  return refExists(`refs/heads/${branch}`);
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
  if (!(await refExists(base))) throw new BaseBranchNotFoundError(base);

  await git(['checkout', base]);
  if (await hasUpstream()) {
    await git(['pull', '--ff-only']);
  }

  await git(['checkout', '-b', branch]);
  return branch;
}

export async function commitAll(message: string): Promise<string> {
  if (!(await isGitRepo())) throw new NotAGitRepoError();
  if (message.trim() === '') throw new EmptyMessageError();
  const branch = await currentBranch();
  // git branch --show-current prints '' on detached HEAD
  if (branch === '') throw new DetachedHeadError();
  if (branch === 'main') throw new ProtectedBranchError();
  if (await isClean()) throw new NothingToCommitError();
  await git(['add', '-A']);
  await git(['commit', '-m', message]);
  return await git(['rev-parse', '--short', 'HEAD']);
}
