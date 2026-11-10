import {
  DetachedHeadError,
  DirtyTreeError,
  NotAGitRepoError,
  NoCommitsToPrError,
  ProtectedBranchError
} from './errors.js';
import { currentBranch, git, isClean, isGitRepo } from './git.js';
import {
  createPr,
  findOpenPr,
  ghAuthenticated,
  ghAvailable,
  mergePr,
  waitForChecks
} from './github.js';
import { step } from './ui.js';

const PROTECTED_BASE = 'main';

/** pr.ts never shells out to gh in tests; the body is a pure function. */
export function buildPrBody(commitMessages: string[]): string {
  return commitMessages.map((message) => `- ${message}`).join('\n') + '\n';
}

export interface PrOptions {
  merge: boolean;
}

export async function createPullRequest(
  title: string,
  options: PrOptions = { merge: true },
  gh = {
    findOpenPr: (branch: string) => findOpenPr(branch),
    createPr: (...args: [string, string, string, string]) => createPr(...args),
    waitForChecks: (branch: string) => waitForChecks(branch),
    mergePr: (branch: string) => mergePr(branch),
    ghAvailable: () => ghAvailable(),
    ghAuthenticated: () => ghAuthenticated(),
  },
): Promise<string> {
  if (!(await isGitRepo())) throw new NotAGitRepoError();
  const branch = await currentBranch();
  if (branch === '') throw new DetachedHeadError();
  if (branch === PROTECTED_BASE) throw new ProtectedBranchError();
  if (!(await isClean())) throw new DirtyTreeError();
  const commitMessages = (await git(['log', '--format=%s', `${PROTECTED_BASE}..HEAD`]))
    .split('\n')
    .filter(Boolean);
  if (commitMessages.length === 0) throw new NoCommitsToPrError();
  await gh.ghAvailable();
  await gh.ghAuthenticated();

  // Always push: a no-op if up to date, and it also sends fix commits after a failed CI run.
  await step('Pushing branch', () => git(['push', '-u', 'origin', branch]));

  const url = await step('Opening pull request', async () =>
    (await gh.findOpenPr(branch)) ??
    (await gh.createPr(branch, title, buildPrBody(commitMessages), PROTECTED_BASE))
  );

  if (!options.merge) return url;

  await step('Waiting for CI checks', () => gh.waitForChecks(branch));
  await step('Merging (squash)', () => gh.mergePr(branch));
  await step('Syncing local main', async () => {
    await git(['switch', PROTECTED_BASE]);
    await git(['pull', '--ff-only']);
  });

  return url;
}
