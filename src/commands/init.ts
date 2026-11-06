import { Command } from 'commander';
import { basename, resolve } from 'node:path';
import { NadError } from '../core/errors.js';
import { PROJECT_TYPES, detectProject, type ProjectType } from '../core/detect.js';
import { DEFAULT_PORTS, renderTemplate } from '../core/templates.js';
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

interface InitOptions {
  template?: string;
  port?: string;
  dryRun?: boolean;
  force?: boolean;
}

export const initCommand = new Command('init')
  .description('Generate Dockerfile, compose file and nad.project.yml for this project')
  .option('-t, --template <type>', `Project type (${PROJECT_TYPES.join(' | ')}); auto-detected if omitted`)
  .option('-p, --port <number>', 'Host port for the container (127.0.0.1 only)')
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

    const port = options.port ? Number(options.port) : DEFAULT_PORTS[type];
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new NadError(`Invalid port '${options.port}'.`, 'Use a number between 1 and 65535.');
    }

    if (type === 'next' && detection.facts.nextStandalone === false) {
      ui.warn(`next.config has no ${ui.code("output: 'standalone'")} — the generated Dockerfile needs it.`);
    }
    if (type === 'next' && detection.facts.packageManager && detection.facts.packageManager !== 'npm') {
      ui.warn(`Found a ${detection.facts.packageManager} lockfile; the template installs with npm.`);
    }

    const files = renderTemplate({ name: basename(dir), type, port, facts: detection.facts });
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
      if (backup) ui.info(`Originals backed up to ${ui.code(backup)}`);
    }

    if (skipped.length > 0) {
      ui.warn(`${skipped.length} existing file(s) differ and were left alone.`);
      ui.hint('Review them, or re-run with --force to overwrite (with backup).');
    }
  });
