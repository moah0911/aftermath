#!/usr/bin/env node
// aftermath PreToolUse hook for Claude Code / Codex.
// Bash: block destructive commands using the project path policy.
// Edit/Write/MultiEdit: block forward edits while a failure is unresolved.
// Reads the hook JSON payload from stdin. Exit 2 blocks with the stderr message.
'use strict';

const { readMode, getPolicy } = require('./aftermath-config');
const {
  evaluateDestructiveCommand,
} = require('./aftermath-destructive-policy.cjs');
const stateStore = require('./aftermath-session-state.cjs');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  try {
    const payload = raw.trim() ? JSON.parse(raw) : {};
    const toolName = String(
      payload.tool_name || payload.toolName || payload.tool || ''
    ).toLowerCase();
    const toolInput = payload.tool_input || payload.toolInput || {};
    const mode = readMode();
    if (mode === 'off' || mode === 'lite') process.exit(0);

    if (toolName === 'edit' || toolName === 'write' || toolName === 'multiedit') {
      const state = stateStore.readState();
      if (state.failureUnresolved) {
        process.stderr.write(
          'AFTERMATH: forward edit blocked — a failure is unresolved. Broke: ' +
            (state.lastErrorExcerpt || 'test regression') +
            '. Run /aftermath-status, revert the implicated hunk, and get tests green before editing again. ' +
            'Use /aftermath lite or /aftermath off to override.\n'
        );
        process.exit(2);
      }
      process.exit(0);
    }

    const cmd = toolInput.command || toolInput.cmd || '';
    if (!cmd) process.exit(0);

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
