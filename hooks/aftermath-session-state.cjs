'use strict';

// aftermath — persistent state for hook-based hosts (Claude Code, Codex).
// The OpenCode plugin keeps state in memory; process-per-hook hosts need a file.

const fs = require('fs');
const path = require('path');
const os = require('os');
const signals = require('./aftermath-signals.cjs');

const STATE_VERSION = 1;

function getStatePath() {
  const base =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'aftermath', 'state.json');
}

function defaultState() {
  return {
    version: STATE_VERSION,
    failureUnresolved: false,
    lastErrorExcerpt: null,
    lastTestResult: null,
    editSinceLastFailure: false,
    outcomes: {},
    attempts: {},
    updatedAt: null,
  };
}

function normalizeState(value) {
  const state = defaultState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return state;
  state.failureUnresolved = value.failureUnresolved === true;
  state.lastErrorExcerpt =
    typeof value.lastErrorExcerpt === 'string' ? value.lastErrorExcerpt : null;
  state.lastTestResult =
    value.lastTestResult === 'pass' || value.lastTestResult === 'fail'
      ? value.lastTestResult
      : null;
  state.editSinceLastFailure = value.editSinceLastFailure === true;
  state.outcomes =
    value.outcomes && typeof value.outcomes === 'object' ? value.outcomes : {};
  state.attempts =
    value.attempts && typeof value.attempts === 'object' ? value.attempts : {};
  state.updatedAt =
    typeof value.updatedAt === 'string' ? value.updatedAt : null;
  return state;
}

function readState() {
  try {
    return normalizeState(
      JSON.parse(fs.readFileSync(getStatePath(), 'utf8'))
    );
  } catch (_) {
    return defaultState();
  }
}

function writeState(state) {
  const file = getStatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = { ...state, version: STATE_VERSION, updatedAt: new Date().toISOString() };
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return next;
}

function updateState(mutator) {
  const state = readState();
  mutator(state);
  return writeState(state);
}

function clearFailure(state) {
  state.failureUnresolved = false;
  state.lastErrorExcerpt = null;
  state.editSinceLastFailure = false;
  state.attempts = {};
}

function loadOutcomeTracker(state) {
  const tracker = signals.createOutcomeTracker();
  for (const [key, outcomes] of Object.entries(state.outcomes || {})) {
    if (!Array.isArray(outcomes)) continue;
    const clean = outcomes
      .filter((entry) => entry === 'pass' || entry === 'fail')
      .slice(-tracker.window);
    if (clean.length) {
      tracker.entries.set(key, { outcomes: clean, alternations: 0, lastAt: 0 });
    }
  }
  return tracker;
}

function saveOutcomeTracker(state, tracker) {
  state.outcomes = {};
  for (const [key, entry] of tracker.entries) {
    state.outcomes[key] = entry.outcomes;
  }
}

function loadAttemptLedger(state) {
  const ledger = signals.createAttemptLedger();
  for (const [key, entry] of Object.entries(state.attempts || {})) {
    if (
      entry &&
      Number.isInteger(entry.count) &&
      Number.isFinite(entry.lastAt)
    ) {
      ledger.entries.set(key, { count: entry.count, lastAt: entry.lastAt });
    }
  }
  return ledger;
}

function saveAttemptLedger(state, ledger) {
  state.attempts = {};
  for (const [key, entry] of ledger.entries) {
    state.attempts[key] = { count: entry.count, lastAt: entry.lastAt };
  }
}

module.exports = {
  STATE_VERSION,
  getStatePath,
  defaultState,
  readState,
  writeState,
  updateState,
  clearFailure,
  loadOutcomeTracker,
  saveOutcomeTracker,
  loadAttemptLedger,
  saveAttemptLedger,
};
