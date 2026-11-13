import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execa } from 'execa';
import {
  DetachedHeadError,
  DirtyTreeError,
  InvalidPathError,
  NoPathsGivenError,
  NotAGitRepoError,
  ProtectedBranchError,
} from './errors.js';
import { currentBranch, git, isClean, isGitRepo } from './git.js';

// ------------------------------------------------------------------- detect

export interface Finding {
  dir: string;
  count: number;
}

export interface RepairDetectResult {
  ignored: Finding[];
  knownBad: Finding[];
  vendorWarning: boolean;
}

const KNOWN_BAD_DIRS = new Set([
  'node_modules',
  'vendor',
  'uploads',
  'storage',
  'dist',
  'build',
  '.next',
  '__pycache__',
]);

function isSecretLike(basename: string): boolean {
  if (basename === '.env.example') return false;
  if (basename === '.env' || /^\.env\..+/.test(basename)) return true;
  if (basename.endsWith('.pem')) return true;
  return basename.startsWith('id_rsa');
}

/** Pure: group paths by their top-level directory; root files group under their own name. */
export function groupByTopDir(paths: string[]): Finding[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const path of paths) {
    const dir = path.includes('/') ? path.split('/')[0] : path;
    if (!counts.has(dir)) {
      counts.set(dir, 0);
      order.push(dir);
    }
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return order.map((dir) => ({ dir, count: counts.get(dir) ?? 0 }));
}

/** Pure: tracked paths that are known-bad even when not ignored, grouped by top-level directory. */
export function findKnownBad(paths: string[]): Finding[] {
  const bad = paths.filter((path) => {
    const top = path.includes('/') ? path.split('/')[0] : path;
    if (KNOWN_BAD_DIRS.has(top)) return true;
    const basename = path.split('/').pop() ?? path;
    return isSecretLike(basename);
  });
  return groupByTopDir(bad);
}

/** vendor tracked on purpose? Only if a Dockerfile exists and installs Composer. */
function dockerfileInstallsComposer(): boolean {
  if (!existsSync('Dockerfile')) return false;
  return readFileSync('Dockerfile', 'utf8').includes('composer install');
}

export async function detectRepairIssues(): Promise<RepairDetectResult> {
  if (!(await isGitRepo())) throw new NotAGitRepoError();
  const [ignoredOut, trackedOut] = await Promise.all([
    git(['ls-files', '-ci', '--exclude-standard']),
    git(['ls-files']),
  ]);
  const ignoredPaths = ignoredOut.split('\n').filter(Boolean);
  const trackedPaths = trackedOut.split('\n').filter(Boolean);
  const vendorTracked = trackedPaths.some((path) => path === 'vendor' || path.startsWith('vendor/'));
  return {
    ignored: groupByTopDir(ignoredPaths),
    knownBad: findKnownBad(trackedPaths),
    vendorWarning: vendorTracked && !dockerfileInstallsComposer(),
  };
}

// ------------------------------------------------------------------ untrack

export interface UntrackItem {
  path: string;
  files: number;
  bytes: number;
}

export interface GitkeepEntry {
  path: string;
  /** true when .gitkeep already existed on disk and was re-added. */
  restored: boolean;
}

export interface UntrackResult {
  apply: boolean;
  items: UntrackItem[];
  gitignoreUpdated: boolean;
  gitkeeps: GitkeepEntry[];
}

function sizeOnDisk(path: string): number {
  const st = statSync(path, { throwIfNoEntry: false });
  if (!st) return 0;
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const entry of readdirSync(path)) total += sizeOnDisk(`${path}/${entry}`);
  return total;
}

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/**
 * Normalize a user path before anything is touched: backslashes to '/',
 * no leading './', no trailing '/'. Rejects anything that is not a
 * clean relative path inside the repository.
 */
function normalizePath(raw: string): string {
  const path = raw.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (path === '' || path === '.' || path === '..') throw new InvalidPathError(raw);
  if (/^[a-zA-Z]:/.test(path) || path.startsWith('/')) throw new InvalidPathError(raw);
  if (path.split('/').some((segment) => segment === '..')) throw new InvalidPathError(raw);
  return path;
}

/** `.gitignore` line for a path: `dir/` for directories, the path as-is for files. */
function ignoreLineFor(path: string): string {
  return isDirectory(path) ? `${path}/` : path;
}

function stripSlashes(line: string): string {
  return line.trim().replace(/\/+$/, '');
}

/** Append lines to .gitignore without duplicates; true when the file changed. */
function ensureGitignoreLines(lines: string[]): boolean {
  const existing = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf8') : '';
  const have = new Set(existing.split('\n').map(stripSlashes));
  const add = [...new Set(lines)].filter((line) => line !== '' && !have.has(stripSlashes(line)));
  if (add.length === 0) return false;
  let content = existing;
  if (content !== '' && !content.endsWith('\n')) content += '\n';
  content += `${add.join('\n')}\n`;
  writeFileSync('.gitignore', content);
  return true;
}

/** .gitkeep in an untracked directory, force-added so the dir survives. Only
 * skips when it is already tracked (an existing-but-untracked keep is restored). */
async function ensureGitkeep(dir: string): Promise<GitkeepEntry | null> {
  const keep = `${dir}/.gitkeep`;
  if ((await git(['ls-files', '--', keep])).trim() !== '') return null;
  const restored = existsSync(keep);
  if (!restored) writeFileSync(keep, '');
  await execa('git', ['add', '-f', keep]);
  return { path: keep, restored };
}

export async function untrack(paths: string[], apply: boolean): Promise<UntrackResult> {
  // All checks and validation run before anything is changed.
  const normalized = [...new Set(paths.map(normalizePath))];
  if (normalized.length === 0) throw new NoPathsGivenError();
  if (!(await isGitRepo())) throw new NotAGitRepoError();
  const branch = await currentBranch();
  if (branch === '') throw new DetachedHeadError();
  if (branch === 'main') throw new ProtectedBranchError();
  if (!(await isClean())) throw new DirtyTreeError();

  const items: UntrackItem[] = [];
  for (const path of normalized) {
    const listed = (await git(['ls-files', '--', path])).split('\n').filter(Boolean);
    if (listed.length === 0) continue;
    items.push({ path, files: listed.length, bytes: sizeOnDisk(path) });
  }
  if (items.length === 0) return { apply, items: [], gitignoreUpdated: false, gitkeeps: [] };
  if (!apply) return { apply: false, items, gitignoreUpdated: false, gitkeeps: [] };

  for (const { path } of items) {
    await execa('git', ['rm', '-r', '--cached', '--quiet', '--', path]);
  }
  const gitignoreUpdated = ensureGitignoreLines(items.map((item) => ignoreLineFor(item.path)));

  const gitkeeps: GitkeepEntry[] = [];
  for (const { path } of items) {
    // Only runtime data directories need to survive as empty folders.
    const base = path.split('/').pop() ?? path;
    if ((base === 'uploads' || base === 'storage') && isDirectory(path)) {
      const keep = await ensureGitkeep(path);
      if (keep) gitkeeps.push(keep);
    }
  }
  return { apply: true, items, gitignoreUpdated, gitkeeps };
}
