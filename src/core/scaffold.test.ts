import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { after, test } from 'node:test';
import { applyFiles, planFiles } from './scaffold.js';

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nad-scaffold-'));
  roots.push(dir);
  return dir;
}

const FILES = { 'a.txt': 'new content\n' };

test('missing file -> create', () => {
  const dir = scratch();
  const [op] = planFiles(dir, FILES, false);
  assert.equal(op?.action, 'create');
});

test('identical file -> unchanged', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'a.txt'), FILES['a.txt'] as string, 'utf8');
  const [op] = planFiles(dir, FILES, false);
  assert.equal(op?.action, 'unchanged');
});

test('different file, no --force -> skip', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'a.txt'), 'original\n', 'utf8');
  const [op] = planFiles(dir, FILES, false);
  assert.equal(op?.action, 'skip');
});

test('different file, --force -> overwrite; original backed up, target replaced', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'a.txt'), 'original\n', 'utf8');
  const [op] = planFiles(dir, FILES, true);
  assert.equal(op?.action, 'overwrite');

  const backupDir = applyFiles(dir, [op as NonNullable<typeof op>]);

  assert.ok(backupDir);
  assert.ok(backupDir.includes(join('.nad', 'backup')));
  assert.equal(readFileSync(join(backupDir, 'a.txt'), 'utf8'), 'original\n');
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), FILES['a.txt']);
});

test('create ops touch nothing but the target', () => {
  const dir = scratch();
  mkdirSync(join(dir, '.nad'), { recursive: true });
  applyFiles(dir, planFiles(dir, FILES, false));
  assert.ok(!existsSync(join(dir, '.nad', 'backup')));
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), FILES['a.txt']);
});
