import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { NadError } from '../core/errors.js';
import { PROJECT_TYPES, detectProject, type ProjectType } from '../core/detect.js';
import { PHP_PROVIDED_EXTENSIONS, renderTemplate, slug } from '../core/templates.js';
import { applyFiles, planFiles, type OpAction } from '../core/scaffold.js';
import { ui } from '../core/ui.js';

const LABEL: Record<OpAction, string> = {
  create: 'create   ',
  unchanged: 'unchanged',
  skip: 'skip     ',
  overwrite: 'overwrite',
};

function isProjectType(value: string): value is ProjectType {
  return (PROJECT_TYPES as readonly string[]).includes(value);
}

/** `owner/repo` from `origin` (GHCR needs it lowercase), or null when unknown. */
function githubRepo(dir: string): string | null {
  try {
    const url = execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: dir, encoding: 'utf8' });
    const match = url.trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/i);
    if (match?.[1] && match[2]) return `${match[1]}/${match[2]}`.toLowerCase();
  } catch {
    // no git / no remote: fall through
  }
  return null;
}

interface InitOptions {
  template?: string;
  name?: string;
  dryRun?: boolean;
  force?: boolean;
}

export const initCommand = new Command('init')
  .description('Generate Dockerfile, compose file and nad.project.yml for this project')
  .option('-t, --template <type>', `Project type (${PROJECT_TYPES.join(' | ')}); auto-detected if omitted`)
  .option('-n, --name <name>', 'Container / image name (default: folder name)')
  .option('--dry-run', 'Show what would be written without writing anything')
  .option('--force', 'Overwrite files that differ (originals are backed up to .nad/backup/)')
  .action((options: InitOptions) => {
    const dir = resolve(process.cwd());
    const detection = detectProject(dir);

    let type: ProjectType;
    if (options.template) {
      if (!isProjectType(options.template)) {
        throw new NadError(
          `Unknown template '${options.template}'.`,
          `Available: ${PROJECT_TYPES.join(', ')}`,
        );
      }
      type = options.template;
    } else if (detection.type) {
      type = detection.type;
      ui.info(`Detected ${ui.name(type)} (${detection.evidence.join(', ')})`);
      if (detection.candidates.length > 1) {
        ui.warn(`Also matched: ${detection.candidates.slice(1).join(', ')}. Use --template to override.`);
      }
    } else {
      throw new NadError(
        'Could not detect the project type.',
        `Pick one with: nad init --template <${PROJECT_TYPES.join('|')}>`,
      );
    }

    if (type === 'next' && detection.facts.nextStandalone === false) {
      ui.warn(`next.config has no ${ui.code("output: 'standalone'")} — the generated Dockerfile needs it.`);
    }
    if (type === 'next' && detection.facts.packageManager && detection.facts.packageManager !== 'npm') {
      ui.warn(`Found a ${detection.facts.packageManager} lockfile; the template installs with npm.`);
    }

    const missingExts = detection.facts.phpExtensions.filter((e) => !PHP_PROVIDED_EXTENSIONS.has(e));
    if (type === 'php' && missingExts.length > 0) {
      ui.warn(`composer.json requires ext-${missingExts.join(', ext-')}, which the generated Dockerfile does not install.`);
    }
    if (type === 'next' && !detection.facts.scripts.build) {
      ui.warn(`package.json has no "build" script; the Dockerfile runs ${ui.code('npm run build')}.`);
    }
    if (type === 'node' && !detection.facts.scripts.start) {
      ui.warn(`package.json has no "start" script; the container runs ${ui.code('npm start')}.`);
    }
    if (type === 'php' && !existsSync(join(dir, '.env'))) {
      ui.warn('The compose file bind-mounts ./.env; if the file does not exist, Docker creates a directory named .env instead.');
      ui.hint(`Create ${ui.code('.env')} before the first docker compose up.`);
    }

    const name = options.name ?? basename(dir);
    const files = renderTemplate({
      name,
      type,
      imageRepo: githubRepo(dir) ?? `nahiddavoudi/${slug(name)}`,
      facts: detection.facts,
    });
    const ops = planFiles(dir, files, Boolean(options.force));

    for (const op of ops) ui.plain(`  ${LABEL[op.action]}  ${op.path}`);

    const skipped = ops.filter((o) => o.action === 'skip');
    const changes = ops.filter((o) => o.action === 'create' || o.action === 'overwrite');

    if (options.dryRun) {
      ui.info('Dry run — nothing was written.');
      return;
    }

    if (changes.length === 0) {
      if (skipped.length === 0) ui.success('Nothing to do — everything is already up to date.');
    } else {
      const backup = applyFiles(dir, ops);
      ui.success(`Wrote ${changes.length} file(s).`);
      ui.hint(`First time on this machine: ${ui.code('docker network create proxy')}${type === 'php' ? ' && docker network create db_net' : ''}`);
      if (backup) {
        ui.info(`Originals backed up to ${ui.code(backup)}`);
        const gitignore = join(dir, '.gitignore');
        const ignoresNad =
          existsSync(gitignore) &&
          readFileSync(gitignore, 'utf8').split(/\r?\n/).some((line) => /^\s*\.nad\/?\s*$/.test(line));
        if (!ignoresNad) {
          ui.hint(`Consider adding ${ui.code('.nad/')} to .gitignore — backups live under ${ui.code('.nad/backup')}.`);
        }
      }
    }

    if (skipped.length > 0) {
      ui.warn(`${skipped.length} existing file(s) differ and were left alone.`);
      ui.hint('Review them, or re-run with --force to overwrite (with backup).');
    }
  });
