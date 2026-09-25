#!/usr/bin/env node
// aftermath — shared configuration resolver
//
// Resolution order for default mode:
//   1. AFTERMATH_DEFAULT_MODE environment variable
//   2. Config file defaultMode field:
//      - $XDG_CONFIG_HOME/aftermath/config.json (any platform, if set)
//      - ~/.config/aftermath/config.json (macOS / Linux fallback)
//      - %APPDATA%\aftermath\config.json (Windows fallback)
//   3. 'full'

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_MODE = 'full';
const VALID_MODES = ['off', 'lite', 'full', 'ultra'];
const RUNTIME_MODES = ['off', 'lite', 'full', 'ultra'];

function normalizeMode(mode) {
  if (typeof mode !== 'string') return null;
  const normalized = mode.trim().toLowerCase();
  return RUNTIME_MODES.includes(normalized) ? normalized : null;
}

function normalizePersistedMode(mode) {
  return normalizeMode(mode);
}

function getConfigDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'aftermath');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'aftermath'
    );
  }
  return path.join(os.homedir(), '.config', 'aftermath');
}

function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

function getStatePath() {
  const base =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'opencode', '.aftermath-active');
}

function getDefaultMode() {
  const envMode = process.env.AFTERMATH_DEFAULT_MODE;
  if (envMode && RUNTIME_MODES.includes(String(envMode).toLowerCase())) {
    return String(envMode).toLowerCase();
  }
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8').replace(/^\uFEFF/, '');
    const config = JSON.parse(raw);
    if (
      config &&
      typeof config.defaultMode === 'string' &&
      RUNTIME_MODES.includes(config.defaultMode.toLowerCase())
    ) {
      return config.defaultMode.toLowerCase();
    }
  } catch (_) {
    // missing or invalid — fall through to default
  }
  return DEFAULT_MODE;
}

function readMode() {
  try {
    const persisted = fs.readFileSync(getStatePath(), 'utf8').trim();
    return normalizePersistedMode(persisted) || getDefaultMode();
  } catch (_) {
    return getDefaultMode();
  }
}

function writeMode(mode) {
  const normalized = normalizePersistedMode(mode);
  if (!normalized) return null;
  const statePath = getStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, normalized, 'utf8');
  return normalized;
}

// Substrings that signal the user is correcting the agent.
// Kept here so OpenCode, Claude, and Codex adapters share one list.
const CORRECTION_SIGNALS = [
  'you broke',
  "you didn't",
  'you did not',
  'wrong',
  'revert',
  'undo that',
  'not what i asked',
  'out of scope',
  'stop and',
];

function containsCorrectionSignal(text) {
  const t = String(text || '').toLowerCase();
  return CORRECTION_SIGNALS.some((s) => t.includes(s));
}

module.exports = {
  DEFAULT_MODE,
  VALID_MODES,
  RUNTIME_MODES,
  CORRECTION_SIGNALS,
  containsCorrectionSignal,
  normalizeMode,
  normalizePersistedMode,
  getConfigDir,
  getConfigPath,
  getStatePath,
  getDefaultMode,
  readMode,
  writeMode,
};
