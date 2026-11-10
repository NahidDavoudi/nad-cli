import type { Detection, ProjectType } from './detect.js';

export interface TemplateContext {
  name: string;
  type: ProjectType;
  /** `owner/repo` (lowercase) used for the GHCR image name. */
  imageRepo: string;
  facts: Detection['facts'];
  /** Which file groups to generate. Defaults to docker only (command always passes it). */
  parts?: Parts;
  /** ci.yml adds the image build+push job when a Dockerfile is generated or already exists. */
  hasDockerfile?: boolean;
}

export interface Parts {
  docker: boolean;
  ci: boolean;
}

/** path (relative, forward slashes) -> file content */
export type FileMap = Record<string, string>;

/** Port the app listens on *inside* the container (Caddy proxies to it by name). */
export const CONTAINER_PORT: Record<ProjectType, number> = {
  php: 80,
  next: 3000,
  node: 3000,
  python: 8000,
  static: 80,
};

const lines = (...parts: (string | false | undefined)[]): string =>
  parts.filter((p): p is string => typeof p === 'string').join('\n') + '\n';

export const slug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';

/** Extensions the generated PHP image has: the ones we install plus those built into php:*-apache. */
export const PHP_PROVIDED_EXTENSIONS = new Set([
  'gd', 'pdo_mysql', 'mysqli', 'zip', 'intl', 'opcache', 'bcmath',
  'mbstring', 'json', 'curl', 'openssl', 'pdo', 'pdo_sqlite', 'sqlite3', 'ctype', 'dom',
  'fileinfo', 'filter', 'hash', 'iconv', 'libxml', 'pcre', 'phar', 'posix', 'readline',
  'reflection', 'session', 'simplexml', 'sodium', 'spl', 'standard', 'tokenizer', 'xml',
  'xmlreader', 'xmlwriter', 'zlib', 'date', 'mysqlnd', 'random',
]);

// ---------------------------------------------------------------- Dockerfiles

function phpDockerfile(c: TemplateContext): string {
  const docroot = c.facts.phpPublicDir ? '/var/www/html/public' : '/var/www/html';
  return lines(
    '# syntax=docker/dockerfile:1',
    '# Build context: the repository root',
    '',
    c.facts.hasComposer && 'FROM composer:2 AS vendor',
    c.facts.hasComposer && 'WORKDIR /app',
    c.facts.hasComposer && 'COPY composer.json composer.lock* ./',
    c.facts.hasComposer &&
      'RUN composer install --no-dev --no-interaction --no-scripts --prefer-dist --optimize-autoloader',
    c.facts.hasComposer && '',
    'FROM php:8.4-apache AS runtime',
    'RUN apt-get update && apt-get install -y --no-install-recommends \\',
    '    libpng-dev libjpeg-dev libwebp-dev libfreetype6-dev libzip-dev libicu-dev \\',
    ' && docker-php-ext-configure gd --with-jpeg --with-webp --with-freetype \\',
    ' && docker-php-ext-install -j"$(nproc)" gd pdo_mysql mysqli zip intl opcache bcmath \\',
    ' && a2enmod rewrite headers remoteip \\',
    ' && rm -rf /var/lib/apt/lists/*',
    '',
    'RUN mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"',
    'COPY docker/custom.ini "$PHP_INI_DIR/conf.d/zz-custom.ini"',
    'COPY docker/remoteip.conf /etc/apache2/conf-available/remoteip.conf',
    'COPY docker/apache-tune.conf /etc/apache2/conf-available/apache-tune.conf',
    'RUN a2enconf remoteip apache-tune',
    '',
    docroot !== '/var/www/html' &&
      `RUN sed -ri "s!/var/www/html!${docroot}!g" \\\n    /etc/apache2/sites-available/*.conf /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf`,
    'RUN sed -ri "s/AllowOverride None/AllowOverride All/g" /etc/apache2/apache2.conf',
    '',
    'COPY . /var/www/html/',
    c.facts.hasComposer && 'COPY --from=vendor /app/vendor/ /var/www/html/vendor/',
    'RUN mkdir -p /var/www/html/uploads /var/www/html/storage/cache /var/www/html/storage/logs \\',
    ' && chown -R www-data:www-data /var/www/html',
    '',
    'EXPOSE 80',
  );
}

function nextDockerfile(c: TemplateContext): string {
  const install = c.facts.hasPackageLock ? 'npm ci' : 'npm install';
  return lines(
    '# syntax=docker/dockerfile:1',
    'FROM node:22-alpine AS deps',
    'WORKDIR /app',
    'COPY package.json package-lock.json* ./',
    `RUN ${install}`,
    '',
    'FROM node:22-alpine AS build',
    'WORKDIR /app',
    'COPY --from=deps /app/node_modules ./node_modules',
    'COPY . .',
    'ENV NEXT_TELEMETRY_DISABLED=1',
    'RUN npm run build',
    '',
    'FROM node:22-alpine AS runtime',
    'WORKDIR /app',
    'ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0',
    '# Needs `output: "standalone"` in next.config',
    'COPY --from=build /app/.next/standalone ./',
    'COPY --from=build /app/.next/static ./.next/static',
    c.facts.hasNextPublicDir && 'COPY --from=build /app/public ./public',
    'USER node',
    'EXPOSE 3000',
    'CMD ["node", "server.js"]',
  );
}

function nodeDockerfile(c: TemplateContext): string {
  const install = c.facts.hasPackageLock ? 'npm ci' : 'npm install';
  return lines(
    '# syntax=docker/dockerfile:1',
    'FROM node:22-alpine AS build',
    'WORKDIR /app',
    'COPY package.json package-lock.json* ./',
    `RUN ${install}`,
    'COPY . .',
    'RUN npm run build --if-present',
    'RUN npm prune --omit=dev',
    '',
    'FROM node:22-alpine AS runtime',
    'WORKDIR /app',
    'ENV NODE_ENV=production PORT=3000',
    'COPY --from=build /app .',
    '# Persistent data (SQLite etc.) lives here; compose mounts a volume on it',
    'RUN mkdir -p /app/data && chown -R node:node /app/data',
    'USER node',
    'EXPOSE 3000',
    'CMD ["npm", "start"]',
  );
}

function pythonDockerfile(c: TemplateContext): string {
  return lines(
    '# syntax=docker/dockerfile:1',
    'FROM python:3.12-slim AS runtime',
    'WORKDIR /app',
    'ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1',
    c.facts.hasRequirements ? 'COPY requirements.txt ./' : 'COPY . .',
    c.facts.hasRequirements
      ? 'RUN pip install --no-cache-dir -r requirements.txt'
      : 'RUN pip install --no-cache-dir .',
    c.facts.hasRequirements && 'COPY . .',
    'RUN useradd -m app && chown -R app /app',
    'USER app',
    'EXPOSE 8000',
    '# Override the app entry with APP_MODULE (default: main:app)',
    'CMD ["sh", "-c", "uvicorn ${APP_MODULE:-main:app} --host 0.0.0.0 --port 8000"]',
  );
}

function staticDockerfile(): string {
  return lines(
    '# syntax=docker/dockerfile:1',
    'FROM nginx:alpine AS runtime',
    'COPY . /usr/share/nginx/html',
    'EXPOSE 80',
  );
}

// ------------------------------------------------------------------- Compose

/**
 * Production-shaped compose: no published ports, the container joins the
 * external `proxy` network (Caddy reaches it by container name), and PHP also
 * joins `db_net` where the shared database lives.
 * One-time setup on a machine: docker network create proxy && docker network create db_net
 */
function compose(c: TemplateContext): string {
  const name = slug(c.name);
  const needsDb = c.type === 'php';
  const networks = needsDb ? ['proxy', 'db_net'] : ['proxy'];

  const volumes: Record<ProjectType, string[]> = {
    php: [
      './uploads:/var/www/html/uploads',
      ...(c.facts.phpPublicDir ? ['./uploads:/var/www/html/public/uploads'] : []),
      './.env:/var/www/html/.env:ro',
      './storage/logs:/var/www/html/storage/logs',
    ],
    node: ['data:/app/data'],
    next: [],
    python: [],
    static: [],
  };

  return lines(
    'services:',
    `  ${name}:`,
    '    build: .',
    `    image: ghcr.io/${c.imageRepo}:latest`,
    `    container_name: ${name}`,
    '    restart: unless-stopped',
    '    env_file:',
    '      - path: .env',
    '        required: false',
    '    environment:',
    '      TZ: Asia/Tehran',
    volumes[c.type].length > 0 && '    volumes:',
    ...volumes[c.type].map((v) => `      - ${v}`),
    '    mem_limit: 512m',
    `    networks: [${networks.join(', ')}]`,
    '',
    'networks:',
    ...networks.flatMap((n) => [`  ${n}:`, '    external: true']),
    c.type === 'node' && '',
    c.type === 'node' && 'volumes:',
    c.type === 'node' && '  data:',
  );
}

// ------------------------------------------------------------- Support files

const COMMON_IGNORE = [
  '.git',
  '.github',
  '.nad',
  '.env',
  '.env.*',
  '!.env.example',
  '*.log',
  '.DS_Store',
  'Dockerfile',
  'docker-compose*.yml',
  '.dockerignore',
];

const EXTRA_IGNORE: Record<ProjectType, string[]> = {
  // uploads and logs are mounted at runtime, never baked into the image
  php: ['vendor', 'uploads', 'storage/logs', 'storage/cache'],
  next: ['node_modules', '.next', 'out'],
  node: ['node_modules', 'dist', 'data'],
  python: ['__pycache__', '*.pyc', '.venv', 'venv'],
  static: [],
};

/** PHP tuning files copied by the Dockerfile. Starting points sized for a 512 MB container. */
const PHP_SUPPORT: FileMap = {
  'docker/custom.ini': lines(
    '; Loaded after php.ini-production',
    'date.timezone = Asia/Tehran',
    'memory_limit = 256M',
    'upload_max_filesize = 10M',
    'post_max_size = 12M',
    'max_execution_time = 30',
    'expose_php = Off',
    'display_errors = Off',
    'log_errors = On',
    'error_log = /dev/stderr',
    'opcache.enable = 1',
    'opcache.memory_consumption = 128',
    'opcache.max_accelerated_files = 10000',
    'opcache.validate_timestamps = 0',
  ),
  'docker/remoteip.conf': lines(
    '# Trust X-Forwarded-For only from the Docker networks (Caddy)',
    'RemoteIPHeader X-Forwarded-For',
    'RemoteIPInternalProxy 172.16.0.0/12',
    'RemoteIPInternalProxy 10.0.0.0/8',
    'RemoteIPInternalProxy 192.168.0.0/16',
  ),
  'docker/apache-tune.conf': lines(
    'ServerTokens Prod',
    'ServerSignature Off',
    'KeepAlive On',
    'KeepAliveTimeout 3',
    'Timeout 60',
    '',
    '<IfModule mpm_prefork_module>',
    '    StartServers 2',
    '    MinSpareServers 2',
    '    MaxSpareServers 4',
    '    MaxRequestWorkers 12',
    '    MaxConnectionsPerChild 500',
    '</IfModule>',
  ),
};

function envExample(c: TemplateContext): string | null {
  // PHP projects own their .env.example (it is application-specific).
  if (c.type === 'python') return lines('APP_MODULE=main:app');
  return null;
}

function projectYml(c: TemplateContext): string {
  return lines(
    'schemaVersion: 1',
    `name: ${slug(c.name)}`,
    `type: ${c.type}`,
    'baseBranch: main',
    'docker:',
    `  container: ${slug(c.name)}`,
    `  port: ${CONTAINER_PORT[c.type]}`,
    '  networks:',
    '    - proxy',
    ...(c.type === 'php' ? ['    - db_net'] : []),
  );
}

// ------------------------------------------------------------------------ CI

/** Install + check steps for the `test` job, per project type. */
function ciTestSteps(c: TemplateContext): string[] {
  const f = c.facts;
  switch (c.type) {
    case 'node':
    case 'next':
      return [
        '      - uses: actions/setup-node@v4',
        '        with:',
        '          node-version: 22',
        ...(f.hasPackageLock ? ['          cache: npm'] : []),
        `      - run: ${f.hasPackageLock ? 'npm ci' : 'npm install'}`,
        ...(f.scripts.lint ? ['      - run: npm run lint'] : []),
        ...(f.scripts.test ? ['      - run: npm test'] : []),
        ...(f.scripts.build ? ['      - run: npm run build'] : []),
      ];
    case 'php':
      return [
        '      - uses: shivammathur/setup-php@v2',
        '        with:',
        "          php-version: '8.4'",
        '          tools: composer',
        ...(f.hasComposer ? ['      - run: composer install --no-interaction --prefer-dist'] : []),
        '      - name: Lint PHP files',
        "        run: find . -name '*.php' -not -path './vendor/*' -print0 | xargs -0 -n1 php -l",
      ];
    case 'python':
      return [
        '      - uses: actions/setup-python@v5',
        '        with:',
        "          python-version: '3.12'",
        f.hasRequirements ? '      - run: pip install -r requirements.txt' : '      - run: pip install .',
        '      - run: python -m compileall -q .',
      ];
    case 'static':
      return ['      - run: test -f index.html'];
  }
}

const CI_DOCKER_JOB: string[] = [
  '  docker:',
  '    needs: test',
  "    if: github.event_name == 'push'",
  '    runs-on: ubuntu-latest',
  '    permissions:',
  '      contents: read',
  '      packages: write',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - uses: docker/setup-buildx-action@v3',
  '      - uses: docker/login-action@v3',
  '        with:',
  '          registry: ghcr.io',
  '          username: ${{ github.actor }}',
  '          password: ${{ secrets.GITHUB_TOKEN }}',
  '      - uses: docker/metadata-action@v5',
  '        id: meta',
  '        with:',
  '          images: ghcr.io/${{ github.repository }}',
  '          tags: |',
  '            type=raw,value=latest,enable={{is_default_branch}}',
  '            type=sha',
  '            type=semver,pattern={{version}}',
  '      - uses: docker/build-push-action@v6',
  '        with:',
  '          context: .',
  '          push: true',
  '          tags: ${{ steps.meta.outputs.tags }}',
  '          labels: ${{ steps.meta.outputs.labels }}',
  '          cache-from: type=gha',
  '          cache-to: type=gha,mode=max',
];

function ciWorkflow(c: TemplateContext): string {
  const withDocker = Boolean(c.parts?.docker || c.hasDockerfile);
  return lines(
    'name: CI',
    '',
    'on:',
    '  push:',
    '    branches: [main]',
    withDocker && '    tags: ["v*"]',
    '  pull_request:',
    '',
    'permissions:',
    '  contents: read',
    '',
    'concurrency:',
    '  group: ci-${{ github.ref }}',
    "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    '',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    ...ciTestSteps(c),
    ...(withDocker ? ['', ...CI_DOCKER_JOB] : []),
  );
}

// -------------------------------------------------------------------- Public

function dockerFiles(c: TemplateContext): FileMap {
  const dockerfile = {
    php: phpDockerfile,
    next: nextDockerfile,
    node: nodeDockerfile,
    python: pythonDockerfile,
    static: staticDockerfile,
  }[c.type](c);

  const env = envExample(c);

  return {
    'Dockerfile': dockerfile,
    '.dockerignore': lines(...COMMON_IGNORE, ...EXTRA_IGNORE[c.type]),
    'docker-compose.yml': compose(c),
    ...(env ? { '.env.example': env } : {}),
    ...(c.type === 'php' ? PHP_SUPPORT : {}),
  };
}

export function renderTemplate(c: TemplateContext): FileMap {
  const parts = c.parts ?? { docker: true, ci: false };
  return {
    ...(parts.docker ? dockerFiles(c) : {}),
    ...(parts.ci ? { '.github/workflows/ci.yml': ciWorkflow(c) } : {}),
    'nad.project.yml': projectYml(c),
  };
}
