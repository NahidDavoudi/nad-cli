import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ConfigError } from './errors.js';
import { loadConfig } from './config.js';

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function dirWithConfig(yamlText: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'nad-config-'));
  roots.push(dir);
  if (yamlText !== null) writeFileSync(join(dir, 'nad.project.yml'), yamlText);
  return dir;
}

test('loadConfig: parses all fields and keeps unknown keys ignored', async () => {
  const config = await loadConfig(
    dirWithConfig(
      [
        'schemaVersion: 1',
        'name: famo-api',
        'server: vps',
        'domain: famo.example.com',
        'port: 8080',
        'futureKey: whatever',
        'data:',
        '  - host: uploads',
        '    container: /var/www/html/uploads',
        '  - host: logs',
        '    container: /var/www/html/storage/logs',
      ].join('\n'),
    ),
  );
  assert.deepEqual(config, {
    name: 'famo-api',
    server: 'vps',
    domain: 'famo.example.com',
    port: 8080,
    data: [
      { host: 'uploads', container: '/var/www/html/uploads' },
      { host: 'logs', container: '/var/www/html/storage/logs' },
    ],
  });
});

test('loadConfig: missing file -> null', async () => {
  assert.equal(await loadConfig(dirWithConfig(null)), null);
});

test('loadConfig: empty file -> null-ish empty config object', async () => {
  assert.deepEqual(await loadConfig(dirWithConfig('')), {});
});

test('loadConfig: invalid YAML throws ConfigError naming the file', async () => {
  await assert.rejects(
    () => loadConfig(dirWithConfig('name: [unbalanced')),
    (error: unknown) =>
      error instanceof ConfigError && /nad\.project\.yml/.test(error.message) && /YAML/.test(error.message),
  );
});

test('loadConfig: wrong types name the field', async () => {
  await assert.rejects(
    () => loadConfig(dirWithConfig('name: 12\n')),
    (error: unknown) =>
      error instanceof ConfigError && /name/.test(error.message) && /string/.test(error.message),
  );
  await assert.rejects(
    () => loadConfig(dirWithConfig('port: eighty\n')),
    (error: unknown) => error instanceof ConfigError && /port/.test(error.message),
  );
  await assert.rejects(
    () => loadConfig(dirWithConfig('data: uploads\n')),
    (error: unknown) => error instanceof ConfigError && /data/.test(error.message),
  );
  await assert.rejects(
    () => loadConfig(dirWithConfig('data:\n  - host: 1\n    container: /x\n')),
    (error: unknown) => error instanceof ConfigError && /host/.test(error.message),
  );
});

test('loadConfig: data host must be relative, no .., no leading /, no backslashes', async () => {
  for (const host of ['/abs', '../up', 'a/../b', 'back\\slash', '/leading/slash', 'C:\\win']) {
    await assert.rejects(
      () => loadConfig(dirWithConfig(`data:\n  - host: ${JSON.stringify(host)}\n    container: /c\n`)),
      (error: unknown) => error instanceof ConfigError && /host/.test(error.message),
      host,
    );
  }
});

test('loadConfig: data container must be absolute', async () => {
  await assert.rejects(
    () => loadConfig(dirWithConfig('data:\n  - host: uploads\n    container: relative/path\n')),
    (error: unknown) => error instanceof ConfigError && /container/.test(error.message),
  );
});

test('loadConfig: duplicate hosts are rejected', async () => {
  await assert.rejects(
    () =>
      loadConfig(
        dirWithConfig('data:\n  - host: uploads\n    container: /a\n  - host: uploads\n    container: /b\n'),
      ),
    (error: unknown) => error instanceof ConfigError && /uploads/.test(error.message),
  );
});
