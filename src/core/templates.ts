import type { Detection, ProjectType } from './detect.js';

export interface TemplateContext {
  name: string;
  type: ProjectType;
  port: number;
  facts: Detection['facts'];
}

/** path (relative, forward slashes) -> file content */
export type FileMap = Record<string, string>;

/** Host port suggested per type, so several projects can live on one VPS. */
export const DEFAULT_PORTS: Record<ProjectType, number> = {
  php: 8080,
  next: 3000,
  node: 4000,
  python: 8000,
  static: 8081,
};

const lines = (...parts: (string | false | undefined)[]): string =>
  parts.filter((p): p is string => typeof p === 'string').join('\n') + '\n';

const slug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';

// ---------------------------------------------------------------- Dockerfiles

function phpDockerfile(c: TemplateContext): string {
  const docroot = c.facts.phpPublicDir ? '/var/www/html/public' : '/var/www/html';
  return lines(
    c.facts.hasComposer && 'FROM composer:2 AS vendor',
    c.facts.hasComposer && 'WORKDIR /app',
    c.facts.hasComposer && 'COPY composer.json composer.lock* ./',
    c.facts.hasComposer &&
      'RUN composer install --no-dev --no-scripts --no-interaction --prefer-dist --optimize-autoloader',
    c.facts.hasComposer && '',
    'FROM php:8.3-apache',
    'RUN apt-get update && apt-get install -y --no-install-recommends \\',
    '      libpng-dev libjpeg-dev libwebp-dev libzip-dev libicu-dev \\',
    ' && docker-php-ext-configure gd --with-jpeg --with-webp \\',
    ' && docker-php-ext-install -j"$(nproc)" gd pdo_mysql zip intl opcache \\',
    ' && a2enmod rewrite headers expires \\',
    ' && rm -rf /var/lib/apt/lists/*',
    '',
    `ENV APACHE_DOCUMENT_ROOT=${docroot}`,
    "RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' \\",
    '      /etc/apache2/sites-available/*.conf /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf',
    '',
    'WORKDIR /var/www/html',
    'COPY . .',
    c.facts.hasComposer && 'COPY --from=vendor /app/vendor ./vendor',
    'RUN chown -R www-data:www-data /var/www/html',
    'EXPOSE 80',
  );
}

function nextDockerfile(c: TemplateContext): string {
  const install = c.facts.hasPackageLock ? 'npm ci' : 'npm install';
  return lines(
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
    'FROM node:22-alpine AS run',
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
    'FROM node:22-alpine AS build',
    'WORKDIR /app',
    'COPY package.json package-lock.json* ./',
    `RUN ${install}`,
    'COPY . .',
    'RUN npm run build --if-present',
    'RUN npm prune --omit=dev',
    '',
    'FROM node:22-alpine',
    'WORKDIR /app',
    'ENV NODE_ENV=production PORT=3000',
    'COPY --from=build /app .',
    '# Persistent data (SQLite etc.) lives here; the compose file mounts a volume on it',
    'RUN mkdir -p /app/data && chown -R node:node /app/data',
    'USER node',
    'EXPOSE 3000',
    'CMD ["npm", "start"]',
  );
}

function pythonDockerfile(c: TemplateContext): string {
  return lines(
    'FROM python:3.12-slim',
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
  return lines('FROM nginx:alpine', 'COPY . /usr/share/nginx/html', 'EXPOSE 80');
}

// ------------------------------------------------------------------- Compose

const INTERNAL_PORT: Record<ProjectType, number> = {
  php: 80,
  next: 3000,
  node: 3000,
  python: 8000,
  static: 80,
};

function compose(c: TemplateContext): string {
  const image = `${slug(c.name)}:local`;
  const app = [
    '  app:',
    '    build: .',
    `    image: ${image}`,
    '    restart: unless-stopped',
    '    env_file:',
    '      - path: .env',
    '        required: false',
    '    ports:',
    `      - "127.0.0.1:\${APP_PORT:-${c.port}}:${INTERNAL_PORT[c.type]}"`,
  ];

  if (c.type === 'php') {
    app.push('    depends_on:', '      - db');
    return lines(
      'services:',
      ...app,
      '  db:',
      '    image: mariadb:11',
      '    restart: unless-stopped',
      '    environment:',
      '      MARIADB_DATABASE: ${DB_NAME:-app}',
      '      MARIADB_USER: ${DB_USER:-app}',
      '      MARIADB_PASSWORD: ${DB_PASS:-change-me}',
      '      MARIADB_ROOT_PASSWORD: ${DB_ROOT_PASSWORD:-change-me-too}',
      '    volumes:',
      '      - db_data:/var/lib/mysql',
      '',
      'volumes:',
      '  db_data:',
    );
  }

  if (c.type === 'node') {
    app.push('    volumes:', '      - data:/app/data');
    return lines('services:', ...app, '', 'volumes:', '  data:');
  }

  return lines('services:', ...app);
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
  php: ['vendor'],
  next: ['node_modules', '.next', 'out'],
  node: ['node_modules', 'dist'],
  python: ['__pycache__', '*.pyc', '.venv', 'venv'],
  static: [],
};

function envExample(c: TemplateContext): string {
  const common = [`APP_PORT=${c.port}`];
  const extra: Record<ProjectType, string[]> = {
    php: ['DB_HOST=db', 'DB_NAME=app', 'DB_USER=app', 'DB_PASS=change-me', 'DB_ROOT_PASSWORD=change-me-too'],
    next: [],
    node: [],
    python: ['APP_MODULE=main:app'],
    static: [],
  };
  return lines(...common, ...extra[c.type]);
}

function projectYml(c: TemplateContext): string {
  return lines(
    'schemaVersion: 1',
    `name: ${slug(c.name)}`,
    `type: ${c.type}`,
    'baseBranch: main',
    'docker:',
    `  port: ${c.port}`,
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

  return {
    'Dockerfile': dockerfile,
    '.dockerignore': lines(...COMMON_IGNORE, ...EXTRA_IGNORE[c.type]),
    'docker-compose.yml': compose(c),
    '.env.example': envExample(c),
    'nad.project.yml': projectYml(c),
  };
}
