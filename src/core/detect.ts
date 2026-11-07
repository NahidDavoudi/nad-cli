import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PROJECT_TYPES = ['php', 'next', 'node', 'python', 'static'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export interface Detection {
  /** Highest-priority match, or null when nothing matched. */
  type: ProjectType | null;
  /** Every type that matched, in priority order. */
  candidates: ProjectType[];
  /** Human-readable reasons, one per matched signal. */
  evidence: string[];
  /** Extra facts the templates need. */
  facts: {
    hasComposer: boolean;
    phpPublicDir: boolean;
    hasPackageLock: boolean;
    hasNextPublicDir: boolean;
    nextStandalone: boolean | null;
    packageManager: 'npm' | 'pnpm' | 'yarn' | null;
    hasRequirements: boolean;
    /** `ext-*` entries from composer.json `require` (without the `ext-` prefix). */
    phpExtensions: string[];
    /** Whether package.json defines these scripts (the Dockerfiles call them). */
    scripts: { build: boolean; start: boolean };
  };
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

function readComposerExtensions(dir: string): string[] {
  try {
    const data = JSON.parse(readFileSync(join(dir, 'composer.json'), 'utf8')) as {
      require?: Record<string, string>;
    };
    return Object.keys(data.require ?? {})
      .filter((name) => name.startsWith('ext-'))
      .map((name) => name.slice(4).toLowerCase());
  } catch {
    return [];
  }
}

function readPackageJson(dir: string): PackageJson | null {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PackageJson;
  } catch {
    return null;
  }
}

function has(dir: string, ...names: string[]): string | undefined {
  return names.find((name) => existsSync(join(dir, name)));
}

/**
 * Looks at files only (never runs anything).
 * Priority: next > php > node > python > static.
 * PHP beats node on purpose: PHP shops usually carry a package.json for
 * frontend tooling, so a package.json alone never adds a node candidate
 * once php matched.
 */
export function detectProject(dir: string): Detection {
  const evidence: string[] = [];
  const candidates: ProjectType[] = [];
  const pkg = readPackageJson(dir);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };

  const nextConfig = has(dir, 'next.config.ts', 'next.config.js', 'next.config.mjs');
  if (deps.next || nextConfig) {
    candidates.push('next');
    evidence.push(nextConfig ? `${nextConfig} found` : '"next" is in package.json');
  }

  const composer = has(dir, 'composer.json');
  const phpIndex = has(dir, 'public/index.php', 'index.php');
  if (composer || phpIndex) {
    candidates.push('php');
    if (composer) evidence.push('composer.json found');
    if (phpIndex) evidence.push(`${phpIndex} found`);
  }

  if (pkg && !candidates.includes('next') && !candidates.includes('php')) {
    candidates.push('node');
    evidence.push(has(dir, 'tsconfig.json') ? 'package.json + tsconfig.json found' : 'package.json found');
  }

  const requirements = has(dir, 'requirements.txt');
  const pyproject = has(dir, 'pyproject.toml');
  if (requirements || pyproject) {
    candidates.push('python');
    evidence.push(`${requirements ?? pyproject} found`);
  }

  if (has(dir, 'index.html') && !pkg && !composer) {
    candidates.push('static');
    evidence.push('index.html found (no package.json / composer.json)');
  }

  let nextStandalone: boolean | null = null;
  if (nextConfig) {
    nextStandalone = /output\s*:\s*['"]standalone['"]/.test(readFileSync(join(dir, nextConfig), 'utf8'));
  }

  const packageManager = has(dir, 'pnpm-lock.yaml')
    ? 'pnpm'
    : has(dir, 'yarn.lock')
      ? 'yarn'
      : pkg
        ? 'npm'
        : null;

  return {
    type: candidates[0] ?? null,
    candidates,
    evidence,
    facts: {
      hasComposer: Boolean(composer),
      phpPublicDir: existsSync(join(dir, 'public', 'index.php')),
      hasPackageLock: existsSync(join(dir, 'package-lock.json')),
      hasNextPublicDir: existsSync(join(dir, 'public')),
      nextStandalone,
      packageManager,
      hasRequirements: Boolean(requirements),
      phpExtensions: composer ? readComposerExtensions(dir) : [],
      scripts: { build: Boolean(pkg?.scripts?.build), start: Boolean(pkg?.scripts?.start) },
    },
  };
}
