import { Command } from 'commander';

export const hiCommand = new Command('hi');

hiCommand.argument('[name]', 'Name to greet').description('Say hi').action((name: string | undefined) => {
  console.log(`Hello there, ${name ?? 'love'}!`);
});

