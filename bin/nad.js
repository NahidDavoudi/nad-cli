#!/usr/bin/env node

const command = process.argv[2];
if (command === null || command === undefined) {
    console.error('No command provided.');
    process.exit(1);
}else if (command === 'hi') {
    console.log('Hello, There!');
} else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}