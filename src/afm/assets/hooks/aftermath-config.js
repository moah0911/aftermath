#!/usr/bin/env node
// aftermath — shared configuration resolver.
//
// Global config:
//   $XDG_CONFIG_HOME/aftermath/config.json (or ~/.config, %APPDATA%)
// Project config:
//   <project>/.aftermath/config.json, found by walking up from cwd to the first
//   directory with .git or .aftermath/config.json. AFTERMATH_PROJECT_DIR overrides.
//
// Merge rules: scalars use the project value; allowlists/commands/protected paths
// union; safePaths use the project value when present. Env mode still wins.

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_MODE = 'full';
const VALID_MODES = ['off', 'lite', 'full', 'ultra'];
const RUNTIME_MODES = ['off', 'lite', 'full', 'ultra'];
const UNION_KEYS = [
  'destructiveAllowlist',
  'testCommands',
  'buildCommands',
  'protectedPaths',
];

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

function readJsonObject(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
  } catch (_) {
    return {};
  }
}

function readUserConfig() {
  return readJsonObject(getConfigPath());
}

function getProjectRoot() {
  const override = process.env.AFTERMATH_PROJECT_DIR;
  if (override) {
    const dir = path.resolve(override);
    try {
      return fs.statSync(dir).isDirectory() ? dir : null;
    } catch (_) {
      return null;
    }
  }
  let dir = process.cwd();
  while (true) {
    if (
      fs.existsSync(path.join(dir, '.git')) ||
      fs.existsSync(path.join(dir, '.aftermath', 'config.json'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function getProjectConfigPath() {
  const root = getProjectRoot();
  return root ? path.join(root, '.aftermath', 'config.json') : null;
}

function readProjectConfig() {
  const file = getProjectConfigPath();
  return file ? readJsonObject(file) : {};
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    const cleaned = entry.trim();
    if (!out.includes(cleaned)) out.push(cleaned);
  }
  return out;
}

function mergeConfigs(user, project) {
  const merged = { ...user };
  for (const [key, value] of Object.entries(project)) {
    if (UNION_KEYS.includes(key)) {
      merged[key] = stringArray([
        ...stringArray(user[key]),
        ...stringArray(value),
      ]);
    } else if (key === 'safePaths') {
      if (Array.isArray(value)) merged[key] = stringArray(value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function readConfig() {
  return mergeConfigs(readUserConfig(), readProjectConfig());
}

function getDefaultMode() {
  const envMode = process.env.AFTERMATH_DEFAULT_MODE;
  if (envMode && RUNTIME_MODES.includes(String(envMode).toLowerCase())) {
    return String(envMode).toLowerCase();
  }
  const config = readConfig();
  if (typeof config.defaultMode === 'string') {
    const configured = config.defaultMode.trim().toLowerCase();
    if (RUNTIME_MODES.includes(configured)) return configured;
  }
  return DEFAULT_MODE;
}

function getAutoRevert() {
  return readConfig().autoRevert === true;
}

function getTestCommands() {
  return stringArray(readConfig().testCommands);
}

function getBuildCommands() {
  return stringArray(readConfig().buildCommands);
}

function getSafePaths() {
  return stringArray(readConfig().safePaths);
}

function getProtectedPaths() {
  return stringArray(readConfig().protectedPaths);
}

function getDestructiveAllowlist() {
  return stringArray(readConfig().destructiveAllowlist);
}

function isDestructiveAllowed(cmd) {
  const text = String(cmd || '').toLowerCase();
  if (!text) return false;
  return getDestructiveAllowlist().some((entry) =>
    text.includes(entry.toLowerCase())
  );
}

function getPolicy() {
  return {
    projectRoot: getProjectRoot(),
    safePaths: getSafePaths(),
    protectedPaths: getProtectedPaths(),
    destructiveAllowlist: getDestructiveAllowlist(),
  };
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
// Phrase-level on purpose: bare "wrong" or "revert" fires on questions.
const CORRECTION_SIGNALS = [
  'you broke',
  "you didn't",
  'you did not',
  'that is wrong',
  "that's wrong",
  'revert it',
  'revert that',
  'undo that',
  'not what i asked',
  'out of scope',
  'stop and revert',
  'stop and fix',
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
  getProjectRoot,
  getProjectConfigPath,
  readJsonObject,
  readUserConfig,
  readProjectConfig,
  readConfig,
  getDefaultMode,
  getAutoRevert,
  getTestCommands,
  getBuildCommands,
  getSafePaths,
  getProtectedPaths,
  getDestructiveAllowlist,
  isDestructiveAllowed,
  getPolicy,
  readMode,
  writeMode,
};
