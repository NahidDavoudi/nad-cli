import type { Detection, ProjectType } from './detect.js';
import { withDefaults, type PersistentPath } from './persist.js';

export interface TemplateContext {
  name: string;
  type: ProjectType;
  /** `owner/repo` (lowercase) used for the GHCR image name. */
  imageRepo: string;
  facts: Detection['facts'];
  /** Runtime folders found by detectPersistentPaths (defaults are added here). */
  persist: PersistentPath[];
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

const APP_ROOT: Record<ProjectType, string> = {
  php: '/var/www/html',
  next: '/app',
  node: '/app',
  python: '/app',
  static: '/usr/share/nginx/html',
};

const volumeName = (path: string): string => path.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();

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

/** Dockerfile lines creating the runtime folders so a non-root user can write to them. */
function persistDirs(c: TemplateContext, user: string): string[] {
  const paths = withDefaults(c.type, c.persist).map((p) => `${APP_ROOT[c.type]}/${p.path}`);
  if (paths.length === 0) return [];
  return [
    '# Runtime folders (compose mounts volumes on them)',
    `RUN mkdir -p ${paths.join(' ')} && chown -R ${user}:${user} ${paths.join(' ')}`,
  ];
}

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
    `RUN mkdir -p ${[...new Set([...withDefaults('php', c.persist).map((p) => p.path), 'storage/cache'])]
      .map((p) => `/var/www/html/${p}`)
      .join(' ')} \\`,
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
    ...persistDirs(c, 'node'),
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
    ...persistDirs(c, 'app'),
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

  const persist = withDefaults(c.type, c.persist);
  const root = APP_ROOT[c.type];
  // PHP: bind mounts (easy to back up, matches the existing server setup).
  // Node/Python: named volumes, so the non-root user can write without chown on the host.
  const named = c.type !== 'php';
  const mounts: string[] = [
    ...persist.map((p) => (named ? `${volumeName(p.path)}:${root}/${p.path}` : `./${p.path}:${root}/${p.path}`)),
    ...(c.type === 'php' ? ['./.env:/var/www/html/.env:ro'] : []),
  ];
  const namedVolumes = named ? persist.map((p) => volumeName(p.path)) : [];

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
    mounts.length > 0 && '    volumes:',
    ...mounts.map((v) => `      - ${v}`),
    '    mem_limit: 512m',
    `    networks: [${networks.join(', ')}]`,
    '',
    'networks:',
    ...networks.flatMap((n) => [`  ${n}:`, '    external: true']),
    namedVolumes.length > 0 && '',
    namedVolumes.length > 0 && 'volumes:',
    ...namedVolumes.map((v) => `  ${v}:`),
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
  php: ['vendor', 'storage/cache'],
  next: ['node_modules', '.next', 'out'],
  node: ['node_modules', 'dist'],
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
  const persist = withDefaults(c.type, c.persist);
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
    ...(persist.length > 0 ? ['persist:'] : []),
    ...persist.flatMap((p) => [`  - path: ${p.path}`, `    kind: ${p.kind}`]),
  );
}

// -------------------------------------------------------------------- Public

export function renderTemplate(c: TemplateContext): FileMap {
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
    '.dockerignore': lines(
      ...new Set([...COMMON_IGNORE, ...EXTRA_IGNORE[c.type], ...withDefaults(c.type, c.persist).map((p) => p.path)]),
    ),
    'docker-compose.yml': compose(c),
    ...(env ? { '.env.example': env } : {}),
    ...(c.type === 'php' ? PHP_SUPPORT : {}),
    'nad.project.yml': projectYml(c),
  };
}
