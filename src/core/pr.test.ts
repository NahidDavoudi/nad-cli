import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  DetachedHeadError,
  DirtyTreeError,
  NotAGitRepoError,
  NoCommitsToPrError,
  ProtectedBranchError
} from './errors.js';
import { buildPrBody, createPullRequest } from './pr.js';

const roots: string[] = [];
const originalCwd = process.cwd();
after(() => {
  process.chdir(originalCwd);
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function git(args: string[]): string {
  return execFileSync('git', args, { stdio: 'pipe', encoding: 'utf8' }).trim();
}

function repo(dirty: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'nad-pr-'));
  roots.push(dir);
  execFileSync('git', ['init', '-q', '--initial-branch=main', dir], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t'], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't'], { stdio: 'pipe' });
  process.chdir(dir);
  writeFileSync(join(dir, 'f.txt'), 'x\n');
  git(['add', '-A']);
  git(['commit', '-qm', 'init']);
  if (dirty) writeFileSync(join(dir, 'f.txt'), 'y\n');
  return dir;
}

test('buildPrBody: one bullet per commit', () => {
  const body = buildPrBody(['feat: add pr command', 'test: cover createPullRequest']);
  assert.equal(
    body,
    '- feat: add pr command\n- test: cover createPullRequest\n',
  );
});

test('not a git repository', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nad-pr-'));
  roots.push(dir);
  process.chdir(dir);
  await assert.rejects(() => createPullRequest('t'), NotAGitRepoError);
});

test('protected branch: main', async () => {
  repo(true);
  await assert.rejects(() => createPullRequest('t'), ProtectedBranchError);
});

test('dirty tree', async () => {
  repo(true);
  git(['checkout', '-qb', 'feature/x']);
  await assert.rejects(() => createPullRequest('t'), DirtyTreeError);
});

test('detached HEAD', async () => {
  repo(false);
  git(['checkout', '-q', '--detach', 'HEAD']);
  await assert.rejects(() => createPullRequest('t'), DetachedHeadError);
});

test('branch with no commits ahead of main', async () => {
  repo(false);
  git(['checkout', '-qb', 'feature/x']);
  await assert.rejects(() => createPullRequest('t'), NoCommitsToPrError);
});

interface PrDeps {
  findOpenPr: (branch: string) => Promise<string | null>;
  createPr: (branch: string, title: string, body: string, base: string) => Promise<string>;
  waitForChecks: (branch: string) => Promise<void>;
  mergePr: (branch: string) => Promise<void>;
}

/** Repo on feature/x with one commit ahead of main, pushed to a local bare origin. */
function repoWithRemote(): string {
  repo(false);
  git(['checkout', '-qb', 'feature/x']);
  writeFileSync(join(process.cwd(), 'f.txt'), 'feat\n');
  git(['add', '-A']);
  git(['commit', '-qm', 'feat: x']);
  const remote = mkdtempSync(join(tmpdir(), 'nad-pr-remote-'));
  roots.push(remote);
  execFileSync('git', ['init', '-q', '--bare', remote], { stdio: 'pipe' });
  git(['remote', 'add', 'origin', remote]);
  git(['push', '-q', '-u', 'origin', 'main']);
  git(['push', '-u', 'origin', 'feature/x']);
  return remote;
}

function fakeDeps(calls: string[], url: string): PrDeps {
  return {
    findOpenPr: async (branch) => {
      calls.push(`findOpenPr:${branch}`);
      return url;
    },
    createPr: async () => {
      calls.push('createPr');
      return url;
    },
    waitForChecks: async (branch) => {
      calls.push(`waitForChecks:${branch}`);
    },
    mergePr: async (branch) => {
      calls.push(`mergePr:${branch}`);
    },
  };
}

const URL = 'https://example.com/pr/1';

test('flow: existing PR open → push → wait checks → merge → sync main', async () => {
  repoWithRemote();
  const calls: string[] = [];
  const url = await createPullRequest('t', { merge: true }, fakeDeps(calls, URL));
  assert.equal(url, URL);
  assert.deepEqual(calls, [
    'findOpenPr:feature/x',
    'waitForChecks:feature/x',
    'mergePr:feature/x',
  ]);
  assert.equal(git(['branch', '--show-current']), 'main');
});

test('flow: --no-merge skips checks and merge', async () => {
  repoWithRemote();
  const calls: string[] = [];
  const url = await createPullRequest('t', { merge: false }, fakeDeps(calls, URL));
  assert.equal(url, URL);
  assert.deepEqual(calls, ['findOpenPr:feature/x']);
  assert.equal(git(['branch', '--show-current']), 'feature/x');
});

test('flow: no open PR → createPr is used', async () => {
  repoWithRemote();
  const calls: string[] = [];
  const deps = fakeDeps(calls, URL);
  deps.findOpenPr = async (branch) => {
    calls.push(`findOpenPr:${branch}`);
    return null;
  };
  const url = await createPullRequest('t', { merge: false }, deps);
  assert.equal(url, URL);
  assert.deepEqual(calls, ['findOpenPr:feature/x', 'createPr']);
});
