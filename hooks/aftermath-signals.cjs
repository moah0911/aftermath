'use strict';

// aftermath — pure failure-signal detectors shared by the OpenCode plugin
// and the test suite. No I/O, no side effects. Keep every pattern tight:
// a false positive nags; a false negative just falls back to the always-on ladder.

const DESTRUCTIVE_PATTERNS = [
  /git\s+push\b[^|&;]*--force/i,
  /git\s+push\b[^|&;]*\s-f(?=\s|$)/,
  /git\s+reset\b[^|&;]*--hard/i,
  /git\s+clean\b[^|&;]*(?:-[a-z]*f|--force)/i,
  /git\s+branch\b[^|&;]*\s-D(?=\s|$)/,
  /git\s+stash\s+(?:drop|clear)\b/i,
  /git\s+checkout\b[^|&;]*(?:--\s+)?\.(?=\s|$)/,
  /git\s+restore\b[^|&;]*(?:--\s+)?\.(?=\s|$)/,
  /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\b/i,
  /\brm\s+[^|&;]*-[a-zA-Z]*r[a-zA-Z]*f/i, // rm -rf / rm -Rf
  /\brm\s+[^|&;]*-[a-zA-Z]*f[a-zA-Z]*r/i, // rm -fr
  /\brm\s+-[a-zA-Z]*r\b/i, // rm -r
  /\brm\b[^|&;]*--recursive[^|&;]*--force/i,
  /\brm\b[^|&;]*--force[^|&;]*--recursive/i,
  /\bkubectl\s+delete\b/i,
  /\bhelm\s+uninstall\b/i,
  /\bdocker\s+system\s+prune\b/i,
  /\bdocker\s+volume\s+rm\b/i,
  /\bterraform\s+(destroy|apply)\b/i,
  /\bprisma\s+migrate\s+reset\b/i,
  /\bdropdb\b/i,
  /\bshred\b/i,
  /\bdd\b[^|&;]*\bof=/i,
  /\bmkfs(?:\.\w+)?\b/i,
  /\bfind\b[^|&;]*-delete\b/i,
  /\bxargs\b[^|&;]*\brm\b/i,
  /\bchmod\s+-R\s+777\b/i,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/, // fork bomb
];

const TEST_COMMAND_PATTERN = new RegExp(
  [
    '\\b(?:pytest|jest|vitest|phpunit|rspec|mocha|ava)\\b',
    'npm\\s+(?:test|run\\s+test)',
    'yarn\\s+test',
    'pnpm\\s+test',
    'bun\\s+test',
    'go\\s+test',
    'dotnet\\s+test',
    'cargo\\s+(?:test|nextest\\s+run)',
    'node\\s+--test',
    'deno\\s+test',
    'make\\s+(?:test|check)',
    'tox\\b',
    'nox\\b',
    'mix\\s+test',
    'swift\\s+test',
    '(?:gradlew|gradle)\\s+test',
    'mvn\\s+(?:test|verify)',
    'ctest\\b',
    'php\\s+artisan\\s+test',
    'bin/rails\\s+test',
    'rails\\s+test',
    'bundle\\s+exec\\s+(?:rspec|rake\\s+test)',
  ].join('|'),
  'i'
);

const FAILURE_MARKERS = [
  /\bFAILED\b/,
  /\bFAIL\b/,
  /[✕✗]/,
  /\b[1-9]\d*\s+failing\b/i,
  /AssertionError/,
  /Traceback \(most recent call last\)/,
  /FAILURES?:/i,
  /\btests?:\s*[1-9]\d*\s+failed\b/i,
  /\b[1-9]\d*\s+failed\b/i,
  /coverage .* below threshold/i,
  /test result:\s*FAILED/i,
  /---\s*FAIL/,
  /\bpanicked at\b/i,
  /\berror\[E\d+\]/,
  /\berror TS\d+/i,
  /\bBUILD FAILURE\b/i,
  /\bBUILD FAILED\b/i,
  /\bFailures:\s*[1-9]\d*/,
  /\bcompilation failed\b/i,
  /\bnpm ERR!/i,
];

const BUILD_COMMAND_PATTERN =
  /\btsc\b|npm\s+run\s+build|yarn\s+build|pnpm\s+(?:run\s+)?build|bun\s+(?:run\s+)?build|vite\s+build|next\s+build|cargo\s+build|go\s+build|dotnet\s+build|mvn\s+(?:compile|package)|gradlew?\s+build|make\b/i;

const DEPENDENCY_COMMAND_PATTERN =
  /\bnpm\s+(?:install|ci|update)\b|\byarn\s+(?:install|add)\b|\bpnpm\s+(?:install|add)\b|\bbun\s+(?:install|add)\b|\bpip3?\s+install\b|\bpython\s+-m\s+pip\s+install\b|\bpoetry\s+install\b|\buv\s+sync\b|\bcargo\s+(?:fetch|update)\b|\bgo\s+mod\s+(?:download|tidy)\b|\bbundle\s+install\b|\bcomposer\s+install\b|\bdotnet\s+restore\b/i;

const BUILD_FAILURE_MARKERS = [
  /\berror TS\d+/i,
  /\berror\[E\d+\]/,
  /\bBUILD FAILED\b/i,
  /\bBUILD FAILURE\b/i,
  /failed to compile/i,
  /compilation failed/i,
  /module not found/i,
  /\bSyntaxError\b/,
  /\bELIFECYCLE\b/,
  /\bnpm ERR!/i,
];

const DEPENDENCY_FAILURE_MARKERS = [
  /\bERESOLVE\b/,
  /could not resolve/i,
  /no matching distribution/i,
  /failed to select a version/i,
  /cannot find module/i,
  /lock ?file .*needs? to be updated/i,
  /bundler could not find/i,
  /\bETIMEDOUT\b|\bENOTFOUND\b|\bECONNREFUSED\b/,
  /\bnpm ERR!/i,
];

const MERGE_CONFLICT_MARKERS = [
  /\bCONFLICT\b/,
  /Automatic merge failed/i,
  /Unmerged paths/i,
  /<<<<<<</,
  />>>>>>>/,
  /both modified/i,
  /rebase in progress/i,
  /fix conflicts and then commit/i,
];

const DEFAULT_OUTCOME_WINDOW = 6;

const DEFAULT_LEDGER_MAX_ENTRIES = 32;
const DEFAULT_LEDGER_TTL_MS = 30 * 60 * 1000;

function isDestructiveCommand(cmd) {
  const text = String(cmd || '');
  return DESTRUCTIVE_PATTERNS.some((re) => re.test(text));
}

function isTestCommand(cmd) {
  return TEST_COMMAND_PATTERN.test(String(cmd || ''));
}

function isBuildCommand(cmd) {
  return BUILD_COMMAND_PATTERN.test(String(cmd || ''));
}

function isDependencyCommand(cmd) {
  return DEPENDENCY_COMMAND_PATTERN.test(String(cmd || ''));
}

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function indicatesTestFailure(outputText) {
  const text = stripAnsi(outputText);
  return FAILURE_MARKERS.some((re) => re.test(text));
}

function indicatesBuildFailure(outputText) {
  const text = stripAnsi(outputText);
  if (FAILURE_MARKERS.some((re) => re.test(text))) return true;
  return BUILD_FAILURE_MARKERS.some((re) => re.test(text));
}

function indicatesDependencyFailure(outputText) {
  const text = stripAnsi(outputText);
  return DEPENDENCY_FAILURE_MARKERS.some((re) => re.test(text));
}

function indicatesMergeConflict(outputText) {
  const text = stripAnsi(outputText);
  return MERGE_CONFLICT_MARKERS.some((re) => re.test(text));
}

function fingerprintError(text) {
  const clean = stripAnsi(text)
    .toLowerCase()
    .replace(/[0-9]+(\.[0-9]+)+/g, '<ver>')
    .replace(/\b0x[0-9a-f]+\b/g, '<addr>')
    .replace(/\s+/g, ' ')
    .trim();
  // First 300 chars carry the error identity; the tail is usually a repeat of frames.
  return clean.slice(0, 300);
}

function isRepeatError(prevFingerprint, currFingerprint) {
  if (!prevFingerprint || !currFingerprint) return false;
  return prevFingerprint === currFingerprint;
}

function errorKey(command, fingerprint) {
  const cmd = String(command || '').trim().replace(/\s+/g, ' ').toLowerCase();
  return cmd + '::' + String(fingerprint || '');
}

function createAttemptLedger(options = {}) {
  const maxEntries =
    Number.isInteger(options.maxEntries) && options.maxEntries > 0
      ? options.maxEntries
      : DEFAULT_LEDGER_MAX_ENTRIES;
  const ttlMs =
    Number.isFinite(options.ttlMs) && options.ttlMs > 0
      ? options.ttlMs
      : DEFAULT_LEDGER_TTL_MS;
  return { entries: new Map(), maxEntries, ttlMs };
}

function pruneLedger(ledger, now) {
  for (const [key, entry] of ledger.entries) {
    if (now - entry.lastAt > ledger.ttlMs) ledger.entries.delete(key);
  }
  while (ledger.entries.size > ledger.maxEntries) {
    let oldestKey;
    let oldest = Infinity;
    for (const [key, entry] of ledger.entries) {
      if (entry.lastAt < oldest) {
        oldest = entry.lastAt;
        oldestKey = key;
      }
    }
    if (oldestKey === undefined) break;
    ledger.entries.delete(oldestKey);
  }
}

// Same fingerprint without an intervening edit is the same attempt.
// A repeat after an edit is the 2nd+ failed attempt and escalates.
function recordAttempt(ledger, key, options = {}) {
  const normalized = String(key || '').trim();
  const hadEdit = options.hadEdit === true;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  if (!normalized) return { attempt: 0, escalated: false, first: false };

  pruneLedger(ledger, now);
  const entry = ledger.entries.get(normalized);
  if (!entry) {
    ledger.entries.set(normalized, { count: 1, lastAt: now });
    pruneLedger(ledger, now);
    return { attempt: 1, escalated: false, first: true };
  }

  if (hadEdit) entry.count += 1;
  entry.lastAt = now;
  ledger.entries.set(normalized, entry);
  return { attempt: entry.count, escalated: entry.count >= 2, first: false };
}

function resetLedger(ledger) {
  if (ledger && ledger.entries) ledger.entries.clear();
}

function createOutcomeTracker(options = {}) {
  const window =
    Number.isInteger(options.window) && options.window > 1
      ? options.window
      : DEFAULT_OUTCOME_WINDOW;
  return { entries: new Map(), window };
}

// Pass/fail flips without an intervening edit escalate flakiness.
// Any edit resets the command's history: the code under test changed.
function recordOutcome(tracker, key, result, options = {}) {
  const normalized = String(key || '').trim();
  const outcome = result === 'pass' || result === 'fail' ? result : null;
  if (!normalized || !outcome) return { flaky: false, alternations: 0 };

  if (options.hadEdit === true) tracker.entries.delete(normalized);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const previous = tracker.entries.get(normalized);
  const outcomes = [...(previous ? previous.outcomes : []), outcome].slice(
    -tracker.window
  );
  let alternations = 0;
  for (let i = 1; i < outcomes.length; i++) {
    if (outcomes[i] !== outcomes[i - 1]) alternations += 1;
  }
  tracker.entries.set(normalized, { outcomes, alternations, lastAt: now });
  return { flaky: alternations >= 2, alternations };
}

function resetOutcomes(tracker) {
  if (tracker && tracker.entries) tracker.entries.clear();
}

module.exports = {
  DESTRUCTIVE_PATTERNS,
  isDestructiveCommand,
  isTestCommand,
  isBuildCommand,
  isDependencyCommand,
  indicatesTestFailure,
  indicatesBuildFailure,
  indicatesDependencyFailure,
  indicatesMergeConflict,
  fingerprintError,
  isRepeatError,
  errorKey,
  createAttemptLedger,
  recordAttempt,
  resetLedger,
  createOutcomeTracker,
  recordOutcome,
  resetOutcomes,
};
