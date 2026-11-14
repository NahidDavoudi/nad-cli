import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from '../core/config.js';
import { detectProject } from '../core/detect.js';
import { ui } from '../core/ui.js';

export const inspectCommand = new Command('inspect')
  .description('Show what Nad detects about the current project')
  .option('--json', 'Print machine-readable JSON')
  .action(async (options: { json?: boolean }) => {
    const dir = resolve(process.cwd());
    const detection = detectProject(dir);
    const config = await loadConfig(dir);
    const initialised = existsSync(join(dir, 'nad.project.yml'));

    if (options.json) {
      ui.plain(JSON.stringify({ ...detection, initialised, config }, null, 2));
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
    if (config) {
      if (config.name) ui.plain(`Name:        ${config.name}`);
      if (config.server) ui.plain(`Server:      ${config.server}`);
      if (config.domain) ui.plain(`Domain:      ${config.domain}`);
      ui.plain(`Port:        ${config.port ?? 80}`);
      for (const mount of config.data ?? []) {
        ui.plain(`Data:        ${mount.host} -> ${mount.container}`);
      }
    }
    if (!initialised) ui.hint(`Run ${ui.code('nad init --dry-run')} to preview the generated files.`);
  });
