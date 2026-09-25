#!/usr/bin/env node
// Verify the always-on rule copies stay aligned with AFTERMATH.md.
// Fails if the six rung keywords drift out of skills/aftermath/SKILL.md.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const ladder = fs.readFileSync(path.join(root, 'AFTERMATH.md'), 'utf8');
const skill = fs.readFileSync(
  path.join(root, 'skills', 'aftermath', 'SKILL.md'),
  'utf8'
);
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

const rungs = [
  'Revert now',
  'last-known-good',
  'exact error',
  'Confirm',
  'Say so out loud',
  'Do not defend',
];

let failed = false;
for (const rung of rungs) {
  if (!skill.includes(rung)) {
    console.error(`MISSING in skills/aftermath/SKILL.md: "${rung}"`);
    failed = true;
  }
}
for (const phrase of ['AFTERMATH.md', 'never hide a break', 'aftermath-status']) {
  if (!agents.includes(phrase)) {
    console.error(`MISSING in AGENTS.md: "${phrase}"`);
    failed = true;
  }
}
const ladderLines = ladder.split('\n').filter((l) => l.trim().length > 0);
if (ladderLines.length > 20) {
  console.error(`AFTERMATH.md too long: ${ladderLines.length} non-empty lines (target ~dozen)`);
  failed = true;
}

if (failed) process.exit(1);
console.log('rule copies aligned.');
