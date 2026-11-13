import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const roots: string[] = [];
const cli = join(import.meta.dirname, '..', 'cli.js');
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function project(yaml: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'nad-inspect-'));
  roots.push(dir);
  writeFileSync(join(dir, 'index.html'), '<h1>x</h1>\n');
  if (yaml) writeFileSync(join(dir, 'nad.project.yml'), yaml);
  return dir;
}

function runInspectJson(dir: string): {
  config: Record<string, unknown> | null;
  initialised?: boolean;
} {
  const stdout = execFileSync('node', [cli, 'inspect', '--json'], { cwd: dir, encoding: 'utf8' });
  return JSON.parse(stdout) as { config: Record<string, unknown> | null; initialised?: boolean };
}

test('inspect --json: config is null when nad.project.yml is missing', () => {
  const out = runInspectJson(project(null));
  assert.equal(out.config, null);
  assert.equal(out.initialised, false);
});

test('inspect --json: config carries name/server/domain/port/data', () => {
  const out = runInspectJson(
    project(
      [
        'name: famo-api',
        'server: vps',
        'domain: famo.example.com',
        'port: 8080',
        'data:',
        '  - host: uploads',
        '    container: /var/www/html/uploads',
        '  - host: logs',
        '    container: /var/www/html/storage/logs',
      ].join('\n'),
    ),
  );
  assert.deepEqual(out.config, {
    name: 'famo-api',
    server: 'vps',
    domain: 'famo.example.com',
    port: 8080,
    data: [
      { host: 'uploads', container: '/var/www/html/uploads' },
      { host: 'logs', container: '/var/www/html/storage/logs' },
    ],
  });
  assert.equal(out.initialised, true);
});

test('inspect --json: invalid config fails with a ConfigError message', () => {
  const dir = project('port: eighty\n');
  let stderr = '';
  try {
    execFileSync('node', [cli, 'inspect', '--json'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    stderr = String((error as { stderr?: string }).stderr ?? '');
  }
  assert.match(stderr, /nad\.project\.yml: port must be a number/);
});
