#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();
program.name('nad').description('NAD CLI').version('0.0.1');

program.command('hi').argument('[name]', 'Name to greet').description('Say hi').action((name) => {
  console.log(`Hello there, ${name ?? 'love'}!`);
});
program.parse(process.argv);