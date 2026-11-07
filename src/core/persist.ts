import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { ProjectType } from './detect.js';

export type PersistKind = 'uploads' | 'logs' | 'database';

export interface PersistentPath {
  /** Directory relative to the project root, forward slashes, no trailing slash. */
  path: string;
  kind: PersistKind;
  /** Where we learned about it (shown by `nad inspect`). */
  evidence: string;
}

const ENV_FILES = ['.env.example', '.env.sample', '.env.dist'];
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', 'dist', '.next', 'build', '__pycache__', 'venv', '.venv']);
const DB_FILE = /\.(sqlite3?|db)$/i;

function envKind(key: string): PersistKind | null {
  if (/^(UPLOADS?|MEDIA)(_DIR|_PATH|_FOLDER)?$/.test(key)) return 'uploads';
  if (/^LOGS?(_DIR|_PATH|_FILE)?$/.test(key)) return 'logs';
  if (/^(DB|DATABASE|SQLITE)(_FILE|_PATH)$/.test(key) || key === 'DATABASE_URL') return 'database';
  return null;
}

/** Turns an env value / ignore entry into a relative directory, or null when it can't be a mount. */
function toRelDir(raw: string, kind: PersistKind): string | null {
  let v = raw.trim().replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '');
  if (kind === 'database') v = v.replace(/^(?:sqlite|file):(?:\/\/\/)?/i, '');
  if (!v || /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /^([a-z]:)?[\\/]/i.test(v)) return null; // URL or absolute
  v = posix.normalize(v.replace(/\\/g, '/')).replace(/\/+$/, '');
  if (v === '.' || v === '' || v.startsWith('..')) return null;
  if (/\.[a-z0-9]{1,6}$/i.test(posix.basename(v))) v = posix.dirname(v); // a file: mount its folder
  return v === '.' ? null : v;
}

function readLines(file: string): string[] {
  try {
    return readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    return [];
  }
}

/** Folders (depth <= 2) that contain a SQLite/.db file. */
function findDatabaseDirs(root: string): string[] {
  const dirs = new Set<string>();
  const walk = (rel: string, depth: number): void => {
    let entries: string[];
    try {
      entries = readdirSync(join(root, rel));
    } catch {
      return;
    }
    for (const name of entries) {
      const childRel = rel ? `${rel}/${name}` : name;
      let isDir = false;
      try {
        isDir = statSync(join(root, childRel)).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (depth < 2 && !SKIP_DIRS.has(name)) walk(childRel, depth + 1);
      } else if (DB_FILE.test(name) && rel) {
        dirs.add(rel);
      }
    }
  };
  walk('', 0);
  return [...dirs];
}

/**
 * Finds where a project keeps runtime data. Sources, strongest first:
 *   1. .env.example keys  (UPLOADS_PATH=./uploads, DATABASE_URL=file:./data/x.db, ...)
 *   2. .gitignore entries (ignored folders are runtime folders)
 *   3. folders / database files that exist on disk
 * Reads files only; never executes anything.
 */
export function detectPersistentPaths(dir: string, type: ProjectType): PersistentPath[] {
  const found: PersistentPath[] = [];
  const add = (path: string | null, kind: PersistKind, evidence: string): void => {
    if (!path) return;
    if (found.some((f) => f.path === path)) return;
    found.push({ path, kind, evidence });
  };

  // 1. env example files
  for (const file of ENV_FILES) {
    for (const line of readLines(join(dir, file))) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
      const kind = m?.[1] ? envKind(m[1]) : null;
      if (m?.[1] && m[2] !== undefined && kind) add(toRelDir(m[2], kind), kind, `${m[1]} in ${file}`);
    }
  }

  // 2. .gitignore
  let ignoresDbFiles = false;
  for (const line of readLines(join(dir, '.gitignore'))) {
    const entry = line.trim();
    if (!entry || entry.startsWith('#') || entry.startsWith('!')) continue;
    if (/\*\.(sqlite3?|db)$/i.test(entry)) {
      ignoresDbFiles = true;
      continue;
    }
    if (/[*?[]/.test(entry)) continue;
    const path = entry.replace(/^\/+/, '').replace(/\/+$/, '');
    const last = posix.basename(path).toLowerCase();
    if (['uploads', 'upload', 'media'].includes(last)) add(path, 'uploads', '.gitignore');
    else if (['logs', 'log'].includes(last)) add(path, 'logs', '.gitignore');
    else if (['data', 'db'].includes(last)) add(path, 'database', '.gitignore');
  }

  // 3. what exists on disk
  for (const rel of ['uploads', 'public/uploads']) {
    if (existsSync(join(dir, rel))) add(rel, 'uploads', 'folder exists');
  }
  for (const rel of ['storage/logs', 'logs']) {
    if (existsSync(join(dir, rel))) add(rel, 'logs', 'folder exists');
  }
  for (const rel of findDatabaseDirs(dir)) {
    add(rel, 'database', ignoresDbFiles ? 'database file (ignored in .gitignore)' : 'database file exists');
  }

  // PHP shops talk to an external MySQL: a data folder is not a database we manage.
  return type === 'php' ? found.filter((f) => f.kind !== 'database') : found;
}

/** Types whose containers keep state on disk. */
export const PERSISTENT_TYPES: ProjectType[] = ['php', 'node', 'python'];

/** What the template falls back to when nothing was detected for a kind. */
export function withDefaults(type: ProjectType, found: PersistentPath[]): PersistentPath[] {
  const defaults: Partial<Record<ProjectType, PersistentPath[]>> = {
    php: [
      { path: 'uploads', kind: 'uploads', evidence: 'default' },
      { path: 'storage/logs', kind: 'logs', evidence: 'default' },
    ],
    node: [{ path: 'data', kind: 'database', evidence: 'default' }],
  };
  const result = PERSISTENT_TYPES.includes(type) ? [...found] : [];
  for (const d of defaults[type] ?? []) {
    if (!result.some((r) => r.kind === d.kind)) result.push(d);
  }
  return result;
}
