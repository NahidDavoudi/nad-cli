import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FileMap } from './templates.js';

export type OpAction = 'create' | 'unchanged' | 'skip' | 'overwrite';

export interface FileOp {
  path: string;
  action: OpAction;
  content: string;
}

/**
 * Decides what would happen to each file. Never touches the disk.
 *  - missing            -> create
 *  - identical          -> unchanged
 *  - different          -> skip (or overwrite with --force)
 */
export function planFiles(dir: string, files: FileMap, force: boolean): FileOp[] {
  return Object.entries(files).map(([path, content]) => {
    const target = join(dir, path);
    if (!existsSync(target)) return { path, action: 'create', content };
    if (readFileSync(target, 'utf8') === content) return { path, action: 'unchanged', content };
    return { path, action: force ? 'overwrite' : 'skip', content };
  });
}

/** Writes create/overwrite ops. Overwritten files are copied to .nad/backup/<timestamp>/ first. */
export function applyFiles(dir: string, ops: FileOp[]): string | null {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let backupDir: string | null = null;

  for (const op of ops) {
    if (op.action !== 'create' && op.action !== 'overwrite') continue;
    const target = join(dir, op.path);

    if (op.action === 'overwrite') {
      backupDir ??= join(dir, '.nad', 'backup', stamp);
      const backup = join(backupDir, op.path);
      mkdirSync(dirname(backup), { recursive: true });
      copyFileSync(target, backup);
    }

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, op.content, 'utf8');
  }

  return backupDir;
}
