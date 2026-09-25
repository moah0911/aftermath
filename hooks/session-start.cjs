#!/usr/bin/env node
// aftermath SessionStart hook: print the active ladder for injection.
// Set AFTERMATH_DIR to the repo root; falls back to the hooks/ parent.
'use strict';
const path = require('path');

const root =
  process.env.AFTERMATH_DIR || path.join(__dirname, '..');
const instructions = require(path.join(root, 'hooks', 'aftermath-instructions'));
const config = require(path.join(root, 'hooks', 'aftermath-config'));

try {
  const mode = config.readMode();
  if (mode === 'off') process.exit(0);
  const text = instructions.getAftermathInstructions(mode);
  if (text) process.stdout.write(text + '\n');
} catch (_) {
  // hooks stay quiet instead of erroring every prompt when node env is odd
}
