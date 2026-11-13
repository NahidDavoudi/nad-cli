import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { DetachedHeadError, DirtyTreeError, NotAGitRepoError, ProtectedBranchError } from './errors.js';
import { detectRepairIssues, findKnownBad, groupByTopDir, untrack } from './repair.js';

const roots: string[] = [];
const originalCwd = process.cwd();
after(() => {
  process.chdir(originalCwd);
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function git(args: string[]): string {
  return execFileSync('git', args, { stdio: 'pipe', encoding: 'utf8' }).trim();
}

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nad-repair-'));
  roots.push(dir);
  execFileSync('git', ['init', '-q', '--initial-branch=main', dir], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t'], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't'], { stdio: 'pipe' });
  process.chdir(dir);
  writeFileSync(join(dir, 'f.txt'), 'x\n');
  writeFileSync(join(dir, '.gitignore'), 'ignored/\n');
  git(['add', '-A']);
  git(['commit', '-qm', 'init']);
  return dir;
}

/** Commits every file (useful to track files that .gitignore would ignore). */
function commitAll(): void {
  git(['add', '-A', '-f']);
  git(['commit', '-qm', 'wip']);
}

/** Commits changes to already-tracked files (never force-adds ignored files). */
function commitTracked(): void {
  git(['add', '-u']);
  git(['commit', '-qm', 'wip']);
}

function featureBranch(): void {
  git(['checkout', '-qb', 'feature/x']);
}

function lsFiles(): string[] {
  return git(['ls-files']).split('\n').filter(Boolean);
}

function mkdirAndWrite(dir: string, name: string, content: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content);
}

// ----------------------------------------------------------------- pure tests

test('groupByTopDir: counts per top-level directory, root files under "."', () => {
  const groups = groupByTopDir(['node_modules/a.js', 'node_modules/b.js', 'vendor/x.php', 'src/i.ts', 'root.txt']);
  assert.deepEqual(groups, [
    { dir: 'node_modules', count: 2 },
    { dir: 'vendor', count: 1 },
    { dir: 'src', count: 1 },
    { dir: '.', count: 1 },
  ]);
});

test('findKnownBad: known-bad directories and secrets-like files, .env.example exempt', () => {
  const paths = [
    'node_modules/a.js',
    'node_modules/b/c.js',
    'vendor/autoload.php',
    '.env',
    '.env.example',
    '.env.prod',
    'certs/server.pem',
    'id_rsa',
    'id_rsa.pub',
    'src/index.ts',
  ];
  assert.deepEqual(findKnownBad(paths), [
    { dir: 'node_modules', count: 2 },
    { dir: 'vendor', count: 1 },
    { dir: '.', count: 4 },
    { dir: 'certs', count: 1 },
  ]);
});

// ---------------------------------------------------------- detect integration

test('detect: ignored-but-tracked, known-bad and vendor warning on a temp repo', async () => {
  repo();
  writeFileSync('.gitignore', 'node_modules/\n');
  mkdirAndWrite('node_modules', 'lib.js', 'x\n');
  mkdirAndWrite('vendor', 'x.php', '<?php\n');
  writeFileSync('.env', 'SECRET=1\n');
  commitAll();

  const result = await detectRepairIssues();
  assert.deepEqual(result.ignored, [{ dir: 'node_modules', count: 1 }]);
  assert.deepEqual(result.knownBad, [
    { dir: '.', count: 1 },
    { dir: 'node_modules', count: 1 },
    { dir: 'vendor', count: 1 },
  ]);
  assert.equal(result.vendorWarning, true);

  // With a Dockerfile that installs Composer, vendor is deliberate: no warning.
  writeFileSync('Dockerfile', 'RUN composer install\n');
  assert.equal((await detectRepairIssues()).vendorWarning, false);
});

test('detect: throws outside a git repository', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nad-repair-'));
  roots.push(dir);
  process.chdir(dir);
  await assert.rejects(() => detectRepairIssues(), NotAGitRepoError);
});

// ------------------------------------------------------------------- untrack

test('untrack dry run: reports counts and sizes, changes nothing', async () => {
  repo();
  featureBranch();
  writeFileSync('.gitignore', 'ignored/\n');
  mkdirAndWrite('node_modules', 'lib.js', 'x\n');
  writeFileSync('.env', 'SECRET=1\n');
  commitAll();
  const indexBefore = lsFiles().join('\n');
  const ignoreBefore = readFileSync('.gitignore', 'utf8');

  const result = await untrack(['node_modules', '.env', 'ghost/'], false);
  assert.equal(result.apply, false);
  assert.deepEqual(
    result.items.map((i) => [i.path, i.files, i.bytes > 0]),
    [
      ['node_modules', 1, true],
      ['.env', 1, true],
    ],
  );
  assert.deepEqual(lsFiles(), indexBefore.split('\n'));
  assert.equal(readFileSync('.gitignore', 'utf8'), ignoreBefore);
});

test('untrack --apply: index cleaned, files stay, .gitignore updated, rerun is a no-op', async () => {
  repo();
  featureBranch();
  mkdirAndWrite('node_modules', 'lib.js', 'x\n');
  writeFileSync('.env', 'SECRET=1\n');
  commitAll();

  const result = await untrack(['node_modules', '.env'], true);
  assert.equal(result.apply, true);
  assert.equal(result.gitignoreUpdated, true);
  assert.deepEqual(result.gitkeeps, []);
  assert.ok(!lsFiles().includes('node_modules/lib.js'));
  assert.ok(!lsFiles().includes('.env'));
  assert.ok(readFileSync(join('node_modules', 'lib.js'), 'utf8'));
  assert.equal(readFileSync('.gitignore', 'utf8'), 'ignored/\nnode_modules/\n.env\n');

  commitTracked();
  const ignoreAfterFirst = readFileSync('.gitignore', 'utf8');
  const rerun = await untrack(['node_modules', '.env'], true);
  assert.deepEqual(rerun.items, []);
  assert.equal(rerun.gitignoreUpdated, false);
  assert.equal(readFileSync('.gitignore', 'utf8'), ignoreAfterFirst);
});

test('untrack: blocked on main, on a dirty tree, and on detached HEAD', async () => {
  repo();
  await assert.rejects(() => untrack(['.env'], false), ProtectedBranchError);

  featureBranch();
  writeFileSync('f.txt', 'dirty\n');
  await assert.rejects(() => untrack(['.env'], false), DirtyTreeError);

  git(['checkout', '-q', '--detach', 'HEAD']);
  await assert.rejects(() => untrack(['.env'], false), DetachedHeadError);
});

test('untrack: nothing tracked succeeds without changes', async () => {
  repo();
  featureBranch();
  const ignoreBefore = readFileSync('.gitignore', 'utf8');
  const result = await untrack(['ghost/'], true);
  assert.deepEqual(result.items, []);
  assert.equal(result.gitignoreUpdated, false);
  assert.equal(readFileSync('.gitignore', 'utf8'), ignoreBefore);
});

test('untrack: uploads gets a tracked .gitkeep after --apply', async () => {
  repo();
  featureBranch();
  mkdirAndWrite('uploads', 'a.txt', 'x\n');
  commitAll();

  const result = await untrack(['uploads'], true);
  assert.deepEqual(result.gitkeeps, ['uploads/.gitkeep']);
  assert.ok(readFileSync(join('uploads', '.gitkeep'), 'utf8') !== undefined);
  assert.ok(lsFiles().includes('uploads/.gitkeep'));
  assert.ok(!lsFiles().includes('uploads/a.txt'));
});

