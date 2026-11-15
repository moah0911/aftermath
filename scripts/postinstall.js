#!/usr/bin/env node
// aftermath postinstall — wire the plugin into detected coding agents at
// PROJECT scope (default) when the package is installed into a project.
// Global installs (npm i -g) skip auto-wiring.
//
// Design notes:
// - Project dir = INIT_CWD (where the user ran `npm i`), NOT the package
//   dir npm actually runs install scripts in (node_modules/...).
// - OpenCode: copy-staged project wiring with the portable relative spec
//   (same machinery as the `init` flow) — never a symlink into node_modules,
//   which npm prunes.
// - Claude Code / Codex: their marketplaces clone the GitHub repo into their
//   OWN durable caches, so the marketplace source is moah0911/aftermath.
// - Failures never fail the npm install: they are caught, summarized, and
//   printed as stderr warnings.
// - Opt out: AFM_SKIP_INSTALL=1 (or npm i --ignore-scripts).

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_URL = 'https://github.com/moah0911/aftermath';
const PLUGIN_BASENAME = 'aftermath.mjs';
const PROJECT_PLUGIN_SPEC = './.opencode/plugins/' + PLUGIN_BASENAME;

const PROJECT_ASSET_DIRS = [
  ['.opencode', 'plugins'],
  ['.opencode', 'commands'],
  ['hooks'],
  ['skills'],
];

function log(...args) {
  console.log('[aftermath:install]', ...args);
}

function warn(...args) {
  console.warn('[aftermath:install]', ...args);
}

function isGlobalInstall() {
  // npm sets npm_config_global=true for `npm i -g`; that is the canonical
  // signal (INIT_CWD is set for both local and global installs).
  return process.env.npm_config_global === 'true';
}

function commandExists(name) {
  try {
    const r = spawnSync(name, ['--version'], { stdio: 'pipe', timeout: 15000 });
    return r.status === 0;
  } catch (_) {
    return false;
  }
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

function copyFileIfNeeded(src, dest) {
  try {
    if (fs.existsSync(dest)) {
      if (fs.readFileSync(dest).equals(fs.readFileSync(src))) {
        return 'in-place';
      }
      return 'skip'; // user-modified file — never clobber
    }
  } catch (_) {
    // fall through to copy attempt
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return 'copied';
}

function stageProjectAssets(repoDir, root) {
  const counts = { copied: 0, skipped: 0 };
  for (const rel of PROJECT_ASSET_DIRS) {
    const srcDir = path.join(repoDir, ...rel);
    for (const file of walkFiles(srcDir)) {
      const outcome = copyFileIfNeeded(
        path.join(srcDir, file),
        path.join(root, ...rel, file)
      );
      counts[outcome === 'copied' ? 'copied' : 'skipped']++;
    }
  }
  return counts;
}

function loadOpencodeJson(file) {
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
      throw new Error(`${file} is not a JSON object — fix it first`);
    }
    return cfg;
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

function ensurePluginEntry(cfg, spec) {
  const list = Array.isArray(cfg.plugin) ? cfg.plugin : [];
  const present = list.some((e) =>
    typeof e === 'string' ? e === spec : Array.isArray(e) && e[0] === spec
  );
  if (present) return { changed: false };
  return { changed: true, next: [...list, spec] };
}

function wireOpencodeProject(repoDir, root) {
  const file = path.join(root, 'opencode.json');
  const cfg = loadOpencodeJson(file);
  if (!cfg.$schema) cfg.$schema = 'https://opencode.ai/config.json';
  const { changed, next } = ensurePluginEntry(cfg, PROJECT_PLUGIN_SPEC);
  if (changed) {
    cfg.plugin = next;
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  }
  const counts = stageProjectAssets(repoDir, root);
  return {
    spec: PROJECT_PLUGIN_SPEC,
    copied: counts.copied,
    skipped: counts.skipped,
  };
}

function runCmd(cmd, args) {
  return spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', timeout: 120000 });
}

function wireClaude(root) {
  if (!fs.existsSync(path.join(root, '.claude')) && !commandExists('claude')) {
    return null;
  }
  const results = [];
  const oneShot = runCmd('claude', [
    'plugin',
    'install',
    'aftermath',
    '--marketplace',
    REPO_URL,
    '--scope',
    'project',
    '--yes',
  ]);
  if (oneShot.status === 0) {
    results.push('claude: installed aftermath@aftermath (project scope)');
    return results;
  }
  // Fallback for older CLIs: add marketplace, then install.
  const add = runCmd('claude', ['plugin', 'marketplace', 'add', REPO_URL]);
  results.push(
    add.status === 0
      ? 'claude: marketplace added'
      : `claude: marketplace add failed: ${(add.stderr || '').trim()}`
  );
  const inst = runCmd('claude', [
    'plugin',
    'install',
    'aftermath@aftermath',
    '--scope',
    'project',
  ]);
  results.push(
    inst.status === 0
      ? 'claude: installed aftermath@aftermath (project scope)'
      : `claude: plugin install failed: ${(inst.stderr || '').trim()}`
  );
  return results;
}

function wireCodex() {
  if (!commandExists('codex')) return null;
  const results = [];
  const add = runCmd('codex', ['plugin', 'marketplace', 'add', REPO_URL]);
  results.push(
    add.status === 0
      ? 'codex: marketplace added'
      : `codex: marketplace add failed: ${(add.stderr || '').trim()}`
  );
  const inst = runCmd('codex', ['plugin', 'add', 'aftermath@aftermath']);
  results.push(
    inst.status === 0
      ? 'codex: installed aftermath@aftermath'
      : `codex: plugin add failed: ${(inst.stderr || '').trim()}`
  );
  return results;
}

function main() {
  if (process.env.AFM_SKIP_INSTALL === '1') {
    log('skipped (AFM_SKIP_INSTALL=1)');
    return 0;
  }

  const initCwd = process.env.INIT_CWD;
  if (isGlobalInstall()) {
    log('global install — auto-wiring skipped; run `aftermath-install` for user scope');
    return 0;
  }

  const root = path.resolve(initCwd);
  const repoDir = path.join(__dirname, '..'); // package root (one level above scripts/)

  const reports = [];

  // OpenCode: project-scope copy staging (portable relative spec).
  try {
    const opencodeWired = wireOpencodeProject(repoDir, root);
    reports.push(
      `opencode: ${opencodeWired.spec} (${opencodeWired.copied} copied, ${opencodeWired.skipped} in place)`
    );
  } catch (e) {
    warn('opencode wiring failed:', e && e.message ? e.message : e);
  }

  // Claude Code: project scope via its marketplace (durable cache).
  try {
    const claude = wireClaude(root);
    if (claude) reports.push(...claude);
    else reports.push('claude: not detected (no CLI / no ~/.claude)');
  } catch (e) {
    warn('claude wiring failed:', e && e.message ? e.message : e);
  }

  // Codex: user scope only (Codex has no project-scope plugin installs).
  try {
    const codex = wireCodex();
    if (codex) reports.push(...codex);
    else reports.push('codex: not detected (no CLI)');
  } catch (e) {
    warn('codex wiring failed:', e && e.message ? e.message : e);
  }

  log('project wiring summary:');
  for (const line of reports) log('  -', line);
  log('done — restart your agent(s) to load the plugin.');
  return 0;
}

process.exitCode = main();
