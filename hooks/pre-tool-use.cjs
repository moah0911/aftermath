#!/usr/bin/env node
// aftermath PreToolUse hook (Bash matcher): block destructive commands.
// Reads the Claude/Codex hook JSON payload from stdin. Exit 2 blocks with
// the stderr message; exit 0 allows. Quiet on malformed input.
'use strict';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const payload = raw.trim() ? JSON.parse(raw) : {};
    const toolInput = payload.tool_input || payload.toolInput || {};
    const cmd = toolInput.command || toolInput.cmd || '';
    if (!cmd) process.exit(0);

    const { readMode, getPolicy } = require('./aftermath-config');
    const {
      evaluateDestructiveCommand,
    } = require('./aftermath-destructive-policy.cjs');
    const mode = readMode();
    if (mode === 'off' || mode === 'lite') process.exit(0);

    const verdict = evaluateDestructiveCommand(String(cmd), getPolicy());
    if (verdict.destructive && verdict.decision === 'block') {
      process.stderr.write(
        'AFTERMATH: destructive command blocked (' +
          verdict.reason +
          ')' +
          (verdict.target ? ' target: ' + verdict.target + '.' : '') +
          ' Confirm current state explicitly (git status, target) before proceeding. Command: ' +
          String(cmd).slice(0, 200) +
          '\n'
      );
      process.exit(2);
    }
  } catch (_) {
    // malformed payload — allow, hooks stay quiet
  }
  process.exit(0);
});
