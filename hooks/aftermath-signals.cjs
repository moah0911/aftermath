'use strict';

// aftermath — pure failure-signal detectors shared by the OpenCode plugin
// and the test suite. No I/O, no side effects. Keep every pattern tight:
// a false positive nags; a false negative just falls back to the always-on ladder.

const DESTRUCTIVE_PATTERNS = [
  /git\s+push\b[^|&;]*--force/i,
  /git\s+push\b[^|&;]*\s-f(?=\s|$)/,
  /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\b/i,
  /\brm\s+[^|&;]*-[a-z]*r[a-z]*f/i, // rm -rf / rm -fr (any flag combo containing r+f)
  /\brm\s+-[a-z]*r\b/i, // rm -r
  /kubectl\s+delete\b/i,
  /terraform\s+(destroy|apply)\b/i,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/, // fork bomb
];

const TEST_COMMAND_PATTERN =
  /\b(?:pytest|jest|vitest|phpunit|rspec)\b|npm\s+(test|run\s+test)|yarn\s+test|pnpm\s+test|bun\s+test|go\s+test|dotnet\s+test|rails\s+test/i;

const FAILURE_MARKERS = [
  /\bFAILED\b/,
  /\bFAIL\b/,
  /✕/,
  /failing/i,
  /AssertionError/,
  /Traceback \(most recent call last\)/,
  /FAILURES?:/i,
  /tests?:\s+\d+\s+failed/i,
  /\d+\s+failed/i,
  /coverage .* below threshold/i,
];

function isDestructiveCommand(cmd) {
  const text = String(cmd || '');
  return DESTRUCTIVE_PATTERNS.some((re) => re.test(text));
}

function isTestCommand(cmd) {
  return TEST_COMMAND_PATTERN.test(String(cmd || ''));
}

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function indicatesTestFailure(outputText) {
  const text = stripAnsi(outputText);
  return FAILURE_MARKERS.some((re) => re.test(text));
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

module.exports = {
  DESTRUCTIVE_PATTERNS,
  isDestructiveCommand,
  isTestCommand,
  indicatesTestFailure,
  fingerprintError,
  isRepeatError,
};
