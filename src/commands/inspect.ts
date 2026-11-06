import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { detectProject } from '../core/detect.js';
import { ui } from '../core/ui.js';

export const inspectCommand = new Command('inspect')
  .description('Show what Nad detects about the current project')
  .option('--json', 'Print machine-readable JSON')
  .action((options: { json?: boolean }) => {
    const dir = resolve(process.cwd());
    const detection = detectProject(dir);
    const initialised = existsSync(join(dir, 'nad.project.yml'));

    if (options.json) {
      ui.plain(JSON.stringify({ ...detection, initialised }, null, 2));
      return;
    }

    if (!detection.type) {
      ui.warn('No known project type detected.');
      ui.hint('Use: nad init --template <php|next|node|python|static>');
      return;
    }

    ui.plain(`Type:        ${ui.name(detection.type)}`);
    ui.plain(`Evidence:    ${detection.evidence.join('; ')}`);
    if (detection.candidates.length > 1) {
      ui.plain(`Also found:  ${detection.candidates.slice(1).join(', ')}`);
    }
    ui.plain(`Initialised: ${initialised ? 'yes (nad.project.yml)' : 'no'}`);
    if (!initialised) ui.hint(`Run ${ui.code('nad init --dry-run')} to preview the generated files.`);
  });
