#!/usr/bin/env node
// aftermath — CLI dispatcher: `aftermath init` and `aftermath install`.
'use strict';

const command = process.argv[2];
const args = process.argv.slice(3);

function usage() {
  return [
    'Usage: aftermath <command> [options]',
    '',
    '  init       initialize destructive-safe recovery for a project',
    '  install    install the plugin, commands, and skills for a host',
    '',
    'Run `aftermath init --help` or `aftermath install --help` for details.',
  ].join('\n');
}

if (!command || command === '-h' || command === '--help') {
  console.log(usage());
  process.exit(0);
}

if (command === 'init') {
  process.exit(require('./init').cli(args));
}

if (command === 'install') {
  process.exit(require('./install').cli(args));
}

console.error('aftermath: unknown command: ' + command);
console.log(usage());
process.exit(1);
