import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PROJECT_TYPES, type ProjectType } from './detect.js';
import { renderTemplate } from './templates.js';

function context(type: ProjectType) {
  return {
    name: 'demo-app',
    type,
    imageRepo: 'owner/demo-app',
    facts: {
      hasComposer: true,
      phpPublicDir: false,
      hasPackageLock: true,
      hasNextPublicDir: false,
      nextStandalone: true,
      packageManager: 'npm' as const,
      hasRequirements: true,
      phpExtensions: [],
      scripts: { build: true, start: true },
    },
  };
}

test('php output includes the three Apache/PHP support files', () => {
  const files = renderTemplate(context('php'));
  assert.ok('docker/custom.ini' in files);
  assert.ok('docker/remoteip.conf' in files);
  assert.ok('docker/apache-tune.conf' in files);
});

test('no generated compose file publishes ports', () => {
  for (const type of PROJECT_TYPES) {
    const compose = renderTemplate(context(type))['docker-compose.yml'] ?? '';
    assert.ok(!/(^|\s)ports:/.test(compose), `${type} compose must not contain "ports:"`);
  }
});

test('compose joins the external "proxy" network, php also "db_net"', () => {
  const proxyExternal = (body: string) => {
    assert.match(body, /networks: \[proxy(, db_net)?\]/);
    assert.match(body, /  proxy:\n    external: true/);
  };

  for (const type of PROJECT_TYPES) {
    const compose = renderTemplate(context(type))['docker-compose.yml'] ?? '';
    proxyExternal(compose);
  }

  const php = renderTemplate(context('php'))['docker-compose.yml'] ?? '';
  assert.match(php, /networks: \[proxy, db_net\]/);
  assert.match(php, /  db_net:\n    external: true/);
});
