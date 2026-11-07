import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { after, test } from 'node:test';
import { detectProject, type ProjectType } from './detect.js';

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string | null>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nad-detect-'));
  roots.push(dir);
  for (const [name, content] of Object.entries(files)) {
    if (content === null) {
      mkdirSync(join(dir, name), { recursive: true });
      continue;
    }
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content, 'utf8');
  }
  return dir;
}

test('php: composer.json wins as the highest match', () => {
  const d = detectProject(project({ 'composer.json': '{}' }));
  assert.equal(d.type, 'php');
  assert.deepEqual(d.candidates, ['php']);
});

test('next: package.json "next" dependency', () => {
  const d = detectProject(project({ 'package.json': JSON.stringify({ dependencies: { next: '^15' } }) }));
  assert.equal(d.type, 'next');
  assert.deepEqual(d.candidates, ['next']);
});

test('node: package.json only', () => {
  const d = detectProject(project({ 'package.json': '{"name":"x"}' }));
  assert.equal(d.type, 'node');
  assert.deepEqual(d.candidates, ['node']);
});

test('python: requirements.txt', () => {
  const d = detectProject(project({ 'requirements.txt': 'flask\n' }));
  assert.equal(d.type, 'python');
  assert.deepEqual(d.candidates, ['python']);
});

test('static: index.html only', () => {
  const d = detectProject(project({ 'index.html': '<html></html>' }));
  assert.equal(d.type, 'static');
  assert.deepEqual(d.candidates, ['static']);
});

test('empty folder: no type, no candidates', () => {
  const d = detectProject(project({}));
  assert.equal(d.type, null);
  assert.deepEqual(d.candidates, []);
});

test('php + package.json: node is not an extra candidate', () => {
  const d = detectProject(project({ 'composer.json': '{}', 'package.json': '{"name":"x"}' }));
  assert.equal(d.type, 'php');
  assert.deepEqual(d.candidates, ['php']);
});

test('priority order: next > php > python', () => {
  const d = detectProject(
    project({
      'package.json': JSON.stringify({ dependencies: { next: '^15' } }),
      'next.config.mjs': 'export default {}',
      'composer.json': '{}',
      'index.php': '<?php echo 1;',
      'requirements.txt': 'flask\n',
    }),
  );
  assert.equal(d.type, 'next');
  assert.deepEqual(d.candidates as ProjectType[], ['next', 'php', 'python']);
});
