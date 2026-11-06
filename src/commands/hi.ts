import { Command } from 'commander';
import { ui } from '../core/ui.js';

export const hiCommand = new Command('hi')
  .argument('[name]', 'Name to greet')
  .description('Say hi')
  .action((name: string | undefined) => {
    ui.success(`Hello there, ${ui.name(name ?? 'love')}!`);
  });