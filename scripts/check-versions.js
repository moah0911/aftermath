#!/usr/bin/env node
// Fail if the three version pins drift apart:
// package.json, .claude-plugin/plugin.json, .codex-plugin/plugin.json.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

const versions = {
  'package.json': read('package.json').version,
  '.claude-plugin/plugin.json': read('.claude-plugin/plugin.json').version,
  '.codex-plugin/plugin.json': read('.codex-plugin/plugin.json').version,
};

const unique = [...new Set(Object.values(versions))];
if (unique.length !== 1 || !unique[0]) {
  for (const [file, v] of Object.entries(versions)) {
    console.error(`${file}: ${v}`);
  }
  console.error('versions drifted — bump all three together');
  process.exit(1);
}
console.log(`versions aligned at ${unique[0]}.`);
