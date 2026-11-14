import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DataMount } from './config.js';
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
      scripts: { build: true, start: true, lint: true, test: true },
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

test('php compose mounts config data under ./data and keeps .env:ro', () => {
  const compose = renderTemplate(context('php'))['docker-compose.yml'] ?? '';
  assert.match(compose, /- \.\/data\/uploads:\/var\/www\/html\/uploads\n/);
  assert.match(compose, /- \.\/data\/logs:\/var\/www\/html\/storage\/logs\n/);
  assert.match(compose, /- \.\/\.env:\/var\/www\/html\/\.env:ro\n/);
  assert.doesNotMatch(compose, /- \.\/uploads:/);
  assert.doesNotMatch(compose, /- \.\/storage\/logs:/);
});

test('php compose: config-provided data overrides the defaults', () => {
  const data: DataMount[] = [{ host: 'media', container: '/srv/media' }];
  const compose = renderTemplate({ ...context('php'), data })['docker-compose.yml'] ?? '';
  assert.match(compose, /- \.\/data\/media:\/srv\/media\n/);
  assert.doesNotMatch(compose, /\/data\/uploads/);
});

test('php compose: public dir also mounts ./data/uploads at public/uploads', () => {
  const compose = renderTemplate({
    ...context('php'),
    facts: { ...context('php').facts, phpPublicDir: true },
  })['docker-compose.yml'] ?? '';
  assert.match(compose, /- \.\/data\/uploads:\/var\/www\/html\/public\/uploads\n/);
});

test('php dockerignore excludes data/, node keeps its existing data line', () => {
  const ignore = (type: ProjectType) => (renderTemplate(context(type))['.dockerignore'] ?? '').split('\n');
  assert.ok(ignore('php').includes('data'));
  assert.ok(ignore('node').includes('data'));
});

test('php project yml: server/domain placeholders, port and data defaults; other types have no data', () => {
  const php = renderTemplate(context('php'))['nad.project.yml'] ?? '';
  assert.match(php, /^# server: vps$/m);
  assert.match(php, /^# domain: example\.com$/m);
  assert.match(php, /^port: 80$/m);
  assert.match(php, /data:\n {2}- host: uploads\n {4}container: \/var\/www\/html\/uploads\n {2}- host: logs\n {4}container: \/var\/www\/html\/storage\/logs\n/m);

  const node = renderTemplate(context('node'))['nad.project.yml'] ?? '';
  assert.doesNotMatch(node, /^data:/m);
  assert.match(node, /^port: 3000$/m);
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

test('ci: parts {docker: false, ci: true} writes only the workflow and project yml', () => {
  const files = renderTemplate({ ...context('node'), parts: { docker: false, ci: true } });
  assert.deepEqual(Object.keys(files).sort(), ['.github/workflows/ci.yml', 'nad.project.yml']);
});

test('ci: default writes docker files but no workflow, docker ignored', () => {
  const files = renderTemplate(context('node'));
  assert.ok(!('.github/workflows/ci.yml' in files));
  assert.ok('Dockerfile' in files);
});

test('ci: workflow gets the docker job only with docker parts or an existing Dockerfile', () => {
  const workflow = (files: ReturnType<typeof renderTemplate>) => files['.github/workflows/ci.yml'] ?? '';
  const withParts = renderTemplate({ ...context('node'), parts: { docker: true, ci: true } });
  assert.match(workflow(withParts), /^  docker:$/m);
  assert.match(workflow(withParts), /needs: test/);

  const existingFile = renderTemplate({
    ...context('node'),
    parts: { docker: false, ci: true },
    hasDockerfile: true,
  });
  assert.match(workflow(existingFile), /^  docker:$/m);

  const ciOnly = renderTemplate({ ...context('node'), parts: { docker: false, ci: true } });
  assert.doesNotMatch(workflow(ciOnly), /^  docker:$/m);
});

test('ci: node/next test steps follow the npm facts', () => {
  const steps = (scripts: { build: boolean; start: boolean; lint: boolean; test: boolean }, lock: boolean) =>
    renderTemplate({
      ...context('node'),
      parts: { docker: false, ci: true },
      facts: { ...context('node').facts, scripts, hasPackageLock: lock },
    })['.github/workflows/ci.yml'] ?? '';

  const full = steps({ build: true, start: false, lint: true, test: true }, true);
  assert.match(full, /npm ci/);
  assert.match(full, /npm run lint/);
  assert.match(full, /npm test/);
  assert.match(full, /npm run build/);
  assert.match(full, /cache: npm/);

  const bare = steps({ build: false, start: false, lint: false, test: false }, false);
  assert.match(bare, /npm install/);
  assert.doesNotMatch(bare, /npm run lint|npm test|npm run build|cache: npm/);
});

test('ci: php uses composer + php -l, python compileall, static checks index.html', () => {
  const wf = (type: ProjectType) =>
    (renderTemplate({ ...context(type), parts: { docker: false, ci: true } })['.github/workflows/ci.yml'] ?? '');
  assert.match(wf('php'), /setup-php@v2/);
  assert.match(wf('php'), /composer install --no-interaction --prefer-dist/);
  assert.match(wf('php'), /php -l/);
  assert.match(wf('python'), /pip install -r requirements\.txt/);
  assert.match(wf('python'), /python -m compileall -q \./);
  assert.match(wf('static'), /test -f index\.html/);
});
