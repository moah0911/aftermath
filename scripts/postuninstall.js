#!/usr/bin/env node
// aftermath postuninstall — remove only what the aftermath installer created.
// Identity-checked: we never delete files that differ from what we staged,
// and never touch user-modified files. No blanket deletes.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_URL = 'https://github.com/moah0911/aftermath';
const PROJECT_PLUGIN_SPEC = './.opencode/plugins/aftermath.mjs';

const PROJECT_ASSET_DIRS = [
  ['.opencode', 'plugins'],
  ['.opencode', 'commands'],
  ['hooks'],
  ['skills'],
];

function log(...args) {
  console.log('[aftermath:uninstall]', ...args);
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const rel of walkFiles(abs)) out.push(path.join(entry.name, rel));
    } else {
      out.push(entry.name);
    }
  }
  return out;
}

function filesEqual(a, b) {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch (_) {
    return false;
  }
}

function loadOpencodeJson(file) {
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  } catch (_) {
    return {};
  }
}

function removePluginEntry(cfg) {
  const list = Array.isArray(cfg.plugin) ? cfg.plugin : [];
  const next = list.filter((e) => {
    const s = typeof e === 'string' ? e : Array.isArray(e) ? e[0] : '';
    return !(typeof s === 'string' && s.includes('aftermath'));
  });
  return { changed: next.length !== list.length, next };
}

function unstageProjectAssets(repoDir, root) {
  let removed = 0;
  for (const rel of PROJECT_ASSET_DIRS) {
    const srcDir = path.join(repoDir, ...rel);
    for (const file of walkFiles(srcDir)) {
      const src = path.join(srcDir, file);
      const dest = path.join(root, ...rel, file);
      if (fs.existsSync(dest) && filesEqual(src, dest)) {
        fs.unlinkSync(dest);
        removed++;
      }
    }
  }
  // Tidy empty dirs (best-effort).
  for (const rel of PROJECT_ASSET_DIRS) {
    let dir = path.join(root, ...rel);
    while (dir !== root && dir.startsWith(root)) {
      try {
        fs.rmdirSync(dir);
      } catch (_) {
        break;
      }
      dir = path.dirname(dir);
    }
  }
  return removed;
}

function unwireOpencodeProject(repoDir, root) {
  const file = path.join(root, 'opencode.json');
  if (!fs.existsSync(file)) return { removed: 0 };
  const cfg = loadOpencodeJson(file);
  const { changed, next } = removePluginEntry(cfg);
  if (changed) {
    cfg.plugin = next;
    if (cfg.plugin.length === 0) delete cfg.plugin;
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  }
  const removed = unstageProjectAssets(repoDir, root);
  return { removed };
}

function runCmd(cmd, args) {
  return spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', timeout: 120000 });
}

function unwireClaude() {
  if (!fs.existsSync(path.join(os.homedir(), '.claude'))) return null;
  const results = [];
  const list = runCmd('claude', ['plugin', 'list']);
  if (list.status === 0 && /aftermath/.test(list.stdout || '')) {
    const rm = runCmd('claude', ['plugin', 'remove', 'aftermath@aftermath']);
    results.push(
      rm.status === 0
        ? 'claude: removed aftermath plugin'
        : `claude: remove failed: ${(rm.stderr || '').trim()}`
    );
  } else {
    results.push('claude: aftermath plugin not installed');
  }
  return results;
}

function unwireCodex() {
  const results = [];
  const list = runCmd('codex', ['plugin', 'list']);
  if (list.status === 0 && /aftermath/.test(list.stdout || '')) {
    const rm = runCmd('codex', ['plugin', 'remove', 'aftermath@aftermath']);
    results.push(
      rm.status === 0
        ? 'codex: removed aftermath plugin'
        : `codex: remove failed: ${(rm.stderr || '').trim()}`
    );
  } else {
    results.push('codex: aftermath plugin not installed');
  }
  return results;
}

function main() {
  if (process.env.AFM_SKIP_INSTALL === '1') {
    log('skipped (AFM_SKIP_INSTALL=1)');
    return 0;
  }
  const initCwd = process.env.INIT_CWD;
  if (process.env.npm_config_global === 'true') {
    log('global uninstall — removing user-scope artifacts is manual (see README)');
    return 0;
  }
  const root = path.resolve(initCwd);
  const repoDir = path.join(__dirname, '..'); // package root (one level above scripts/)

  try {
    const { removed } = unwireOpencodeProject(repoDir, root);
    log(`opencode: removed ${removed} staged file(s)`);
  } catch (e) {
    log('opencode unwiring failed:', e && e.message ? e.message : e);
  }
  try {
    const claude = unwireClaude();
    if (claude) for (const line of claude) log(line);
  } catch (e) {
    log('claude unwiring failed:', e && e.message ? e.message : e);
  }
  try {
    const codex = unwireCodex();
    if (codex) for (const line of codex) log(line);
  } catch (e) {
    log('codex unwiring failed:', e && e.message ? e.message : e);
  }
  log('done.');
  return 0;
}

process.exitCode = main();
