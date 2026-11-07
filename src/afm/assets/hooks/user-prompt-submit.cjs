#!/usr/bin/env node
// aftermath UserPromptSubmit hook for Claude Code / Codex.
// Persists `/aftermath <mode>`, clears failure state on revert/lite/off, and
// injects correction + unresolved-failure reminders into the prompt context.
'use strict';

const {
  readMode,
  writeMode,
  containsCorrectionSignal,
} = require('./aftermath-config');
const stateStore = require('./aftermath-session-state.cjs');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  try {
    const payload = raw.trim() ? JSON.parse(raw) : {};
    const prompt = String(
      payload.prompt ||
        payload.user_prompt ||
        payload.userPrompt ||
        payload.text ||
        payload.message ||
        ''
    );

    const modeMatch = prompt.match(
      /(?:^|\s)\/aftermath\s+(off|lite|full|ultra)\b/i
    );
    if (modeMatch) {
      writeMode(modeMatch[1].toLowerCase());
      if (modeMatch[1].toLowerCase() === 'off' || modeMatch[1].toLowerCase() === 'lite') {
        stateStore.updateState((state) => stateStore.clearFailure(state));
      }
    }

    if (/(?:^|\s)\/aftermath-revert\b/i.test(prompt)) {
      stateStore.updateState((state) => stateStore.clearFailure(state));
    }

    const mode = readMode();
    const lines = [];
    if (containsCorrectionSignal(prompt)) {
      lines.push(
        'AFTERMATH SIGNAL: user corrected you. Do not defend the last step. Find the diff. Fix only that.'
      );
    }
    const state = stateStore.readState();
    if (state.failureUnresolved && mode !== 'off') {
      lines.push(
        'AFTERMATH STATE: failure unresolved. Forward edits are blocked at full/ultra until a test command passes, /aftermath-revert runs, or the level drops to lite/off.'
      );
    }
    if (lines.length) process.stdout.write(lines.join('\n\n') + '\n');
  } catch (_) {
    // hooks stay quiet on malformed input
  }
  process.exit(0);
});
