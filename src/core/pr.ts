import {
  DetachedHeadError,
  DirtyTreeError,
  NotAGitRepoError,
  NoCommitsToPrError,
  ProtectedBranchError
} from './errors.js';
import { currentBranch, git, hasUpstream, isClean, isGitRepo } from './git.js';
import { createPr, findOpenPr, ghAuthenticated, ghAvailable } from './github.js';

const PROTECTED_BASE = 'main';

/** pr.ts never shells out to gh in tests; the body is a pure function. */
export function buildPrBody(commitMessages: string[]): string {
  return commitMessages.map((message) => `- ${message}`).join('\n') + '\n';
}

export async function createPullRequest(title: string): Promise<string> {
  if (!(await isGitRepo())) throw new NotAGitRepoError();
  const branch = await currentBranch();
  if (branch === '') throw new DetachedHeadError();
  if (branch === PROTECTED_BASE) throw new ProtectedBranchError();
  if (!(await isClean())) throw new DirtyTreeError();
  const commitMessages = (await git(['log', '--format=%s', `${PROTECTED_BASE}..HEAD`]))
    .split('\n')
    .filter(Boolean);
  if (commitMessages.length === 0) throw new NoCommitsToPrError();
  await ghAvailable();
  await ghAuthenticated();
  const existing = await findOpenPr(branch);
  if (existing) return existing; // already open: idempotent no-op
  if (!(await hasUpstream())) {
    await git(['push', '-u', 'origin', branch]);
  }
  return await createPr(branch, title, buildPrBody(commitMessages), PROTECTED_BASE);
}
