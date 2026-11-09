import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  DetachedHeadError,
  EmptyMessageError,
  NotAGitRepoError,
  NothingToCommitError,
  ProtectedBranchError
} from './errors.js';
import { commitAll } from './git.js';

const roots: string[] = [];
const originalCwd = process.cwd();
after(() => {
  process.chdir(originalCwd);
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function runGit(args: string[]): string {
  return execFileSync('git', args, { cwd: process.cwd(), stdio: 'pipe', encoding: 'utf8' }).trim();
}

function repo(dirty: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'nad-commit-'));
  roots.push(dir);
  runGitInit(dir);
  process.chdir(dir);
  writeFileSync(join(dir, 'f.txt'), 'x\n');
  runGit(['add', '-A']);
  runGit(['commit', '-qm', 'init']);
  if (dirty) writeFileSync(join(dir, 'f.txt'), 'y\n');
  return dir;
}

function runGitInit(dir: string): void {
  execFileSync(
    'git',
    ['init', '-q', '--initial-branch=main', dir],
    { stdio: 'pipe' },
  );
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t'], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't'], { stdio: 'pipe' });
}

test('not a git repository', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nad-commit-'));
  roots.push(dir);
  process.chdir(dir);
  await assert.rejects(() => commitAll('hi'), NotAGitRepoError);
});

test('empty message (whitespace only)', async () => {
  repo(true);
  await assert.rejects(() => commitAll('   '), EmptyMessageError);
});

test('clean tree: nothing to commit', async () => {
  repo(false);
  runGit(['checkout', '-qb', 'dev']);
  await assert.rejects(() => commitAll('hi'), NothingToCommitError);
});

test('protected branch: main', async () => {
  repo(true);
  await assert.rejects(() => commitAll('hi'), ProtectedBranchError);
});

test('detached HEAD', async () => {
  repo(true);
  runGit(['checkout', '-q', '--detach', 'HEAD']);
  await assert.rejects(() => commitAll('hi'), DetachedHeadError);
});

test('commits everything and returns the short hash', async () => {
  repo(true);
  runGit(['checkout', '-qb', 'dev']);
  const hash = await commitAll('real commit');
  assert.equal(hash, runGit(['rev-parse', '--short', 'HEAD']));
  assert.match(hash, /^[0-9a-f]{7}$/);
  assert.equal(runGit(['log', '-1', '--pretty=%s']), 'real commit');
  assert.equal(runGit(['status', '--porcelain']), '');
});
