#!/usr/bin/env node
// aftermath PostToolUse hook (Bash + edit tools) for Claude Code / Codex.
// Detects test/build/dependency/merge signals, persists failure state, and
// feeds the matching skill pointer back to the model via exit 2 + stderr.
'use strict';

const signals = require('./aftermath-signals.cjs');
const stateStore = require('./aftermath-session-state.cjs');
const { readMode, getTestCommands } = require('./aftermath-config');

function excerpt(text, max = 200) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

function responseText(response) {
  if (typeof response === 'string') return response;
  if (!response || typeof response !== 'object') return String(response || '');
  const parts = [];
  for (const key of ['output', 'stdout', 'stderr', 'text', 'result']) {
    if (typeof response[key] === 'string' && response[key]) {
      parts.push(response[key]);
    }
  }
  if (parts.length) return parts.join('\n');
  try {
    return JSON.stringify(response);
  } catch (_) {
    return '';
  }
}

function handleTestFailure(state, cmd, text) {
  const messages = [];
  const fingerprint = signals.fingerprintError(text);
  const tracker = stateStore.loadOutcomeTracker(state);
  const outcome = signals.recordOutcome(
    tracker,
    signals.errorKey(cmd, ''),
    'fail',
    { hadEdit: state.editSinceLastFailure }
  );
  stateStore.saveOutcomeTracker(state, tracker);

  const wasGreen = state.lastTestResult === 'pass';
  state.lastTestResult = 'fail';
  state.lastErrorExcerpt = excerpt(text);

  if (outcome.flaky) {
    state.failureUnresolved = false;
    messages.push(
      'AFTERMATH SIGNAL: test result alternated without code edits. Load the `flaky-test` skill: rerun to confirm, find nondeterminism, do not revert working code. Auto-revert is unavailable on this host.'
    );
  } else {
    state.failureUnresolved = true;
    messages.push(
      'AFTERMATH SIGNAL: test suite just went ' +
        (wasGreen ? 'green->red' : 'red') +
        '. Load the `test-regression` skill: diff against last-known-good, isolate one hunk, revert just that. No forward edits.'
    );
  }

  const ledger = stateStore.loadAttemptLedger(state);
  const attempt = signals.recordAttempt(
    ledger,
    signals.errorKey(cmd, fingerprint),
    { hadEdit: state.editSinceLastFailure }
  );
  stateStore.saveAttemptLedger(state, ledger);
  state.editSinceLastFailure = false;
  if (attempt.escalated && !outcome.flaky) {
    messages.push(
      'AFTERMATH SIGNAL: same error recurred after ' +
        attempt.attempt +
        ' attempts. Load the `retry-loop` skill: stop varying the fix, state exact error + theory, ask.'
    );
  }
  if (state.lastErrorExcerpt) {
    messages.push('Exact error: ' + state.lastErrorExcerpt);
  }
  return messages.join('\n');
}

function handleTestPass(state, cmd) {
  const tracker = stateStore.loadOutcomeTracker(state);
  signals.recordOutcome(tracker, signals.errorKey(cmd, ''), 'pass', {
    hadEdit: state.editSinceLastFailure,
  });
  stateStore.saveOutcomeTracker(state, tracker);
  state.lastTestResult = 'pass';
  stateStore.clearFailure(state);
  return '';
}

function handleOther(state, cmd, text) {
  const messages = [];

  if (signals.indicatesMergeConflict(text)) {
    messages.push(
      'AFTERMATH SIGNAL: merge conflict detected. Load the `merge-conflict` skill: read both sides, never blindly take ours/theirs, run affected tests after resolving.'
    );
  }
  if (
    signals.isDependencyCommand(cmd) &&
    signals.indicatesDependencyFailure(text)
  ) {
    messages.push(
      'AFTERMATH SIGNAL: dependency install/resolution failed. Load the `dependency-failure` skill: paste the exact resolver error, respect the lockfile, one change at a time. Error: ' +
        excerpt(text)
    );
  }
  if (signals.isBuildCommand(cmd) && signals.indicatesBuildFailure(text)) {
    messages.push(
      'AFTERMATH SIGNAL: build failed. Load the `build-failure` skill: read the first error, isolate the hunk, no tests until the build is green. Error: ' +
        excerpt(text)
    );
  }

  if (text && /error|fail|exception|traceback/i.test(text)) {
    const fingerprint = signals.fingerprintError(text);
    const ledger = stateStore.loadAttemptLedger(state);
    const attempt = signals.recordAttempt(
      ledger,
      signals.errorKey(cmd, fingerprint),
      { hadEdit: state.editSinceLastFailure }
    );
    stateStore.saveAttemptLedger(state, ledger);
    state.editSinceLastFailure = false;
    state.lastErrorExcerpt = excerpt(text);
    if (attempt.escalated) {
      state.failureUnresolved = true;
      messages.push(
        'AFTERMATH SIGNAL: same error recurred after ' +
          attempt.attempt +
          ' attempts. Load the `retry-loop` skill: stop varying the fix, state exact error + theory, ask. Error: ' +
          excerpt(text)
      );
    }
  }
  return messages.join('\n');
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let message = '';
  try {
    const payload = raw.trim() ? JSON.parse(raw) : {};
    const toolName = String(
      payload.tool_name || payload.toolName || payload.tool || ''
    ).toLowerCase();
    const toolInput = payload.tool_input || payload.toolInput || {};
    const mode = readMode();
    if (mode === 'off') process.exit(0);

    if (toolName === 'edit' || toolName === 'write' || toolName === 'multiedit') {
      stateStore.updateState((state) => {
        state.editSinceLastFailure = true;
      });
      process.exit(0);
    }
    if (toolName && toolName !== 'bash') process.exit(0);

    const cmd = String(toolInput.command || toolInput.cmd || '');
    if (!cmd) process.exit(0);
    const text = responseText(
      payload.tool_response ||
        payload.toolResponse ||
        payload.output ||
        payload.result ||
        ''
    );
    if (!text) process.exit(0);

    const state = stateStore.readState();
    const configuredTest = getTestCommands().some((entry) =>
      cmd.includes(entry)
    );
    if (signals.isTestCommand(cmd) || configuredTest) {
      message = signals.indicatesTestFailure(text)
        ? handleTestFailure(state, cmd, text)
        : handleTestPass(state, cmd);
    } else {
      message = handleOther(state, cmd, text);
    }
    stateStore.writeState(state);
  } catch (_) {
    // hooks stay quiet; never break the tool flow
  }

  if (message) {
    process.stderr.write(message + '\n');
    process.exit(2);
  }
  process.exit(0);
});
