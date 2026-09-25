#!/usr/bin/env node
// aftermath installer — OpenCode + Claude Code + Codex, global or project scope.
//
//   node scripts/install.js [--project] [--host opencode|claude|codex|all]
//                           [--ref main] [--source <dir>] [--mode lite|full|ultra|off]
//                           [--dry-run] [--uninstall]
//
// Source: clones moah0911/aftermath (or uses --source). Scope: global
// (~/.config/opencode) by default, current project with --project. Every step
// is idempotent — re-runs are no-ops. --dry-run prints actions, changes nothing.
// Stdlib only.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO_URL = 'https://github.com/moah0911/aftermath';
const PLUGIN_BASENAME = 'aftermath.mjs';
const SCHEMA_URL = 'https://opencode.ai/config.json';

function usage() {
  return [
    'Usage: node scripts/install.js [options]',
    '',
    '  --project          wire the current directory instead of the global config',
    '  --host <h>         opencode|claude|codex|all (default: all)',
    '  --ref <ref>        git ref to install (default: main)',
    '  --source <dir>     use a local checkout instead of cloning',
    '  --mode <m>         persist intensity: lite|full|ultra|off',
    '  --dry-run          print planned actions, change nothing',
    '  --uninstall        remove aftermath wiring (leaves the clone in place)',
    '  -h, --help         this text',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = {
    project: false,
    host: 'all',
    ref: 'main',
    source: null,
    mode: null,
    dryRun: false,
    uninstall: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') opts.project = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--uninstall') opts.uninstall = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--host' || a === '--ref' || a === '--source' || a === '--mode') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`);
      opts[a.slice(2)] = v;
    } else if (a.startsWith('--')) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      throw new Error(`unexpected argument: ${a}`);
    }
  }
  const hosts = ['opencode', 'claude', 'codex', 'all'];
  if (!hosts.includes(opts.host)) throw new Error(`--host must be one of: ${hosts.join('|')}`);
  if (opts.mode) {
    const m = String(opts.mode).trim().toLowerCase();
    if (!['lite', 'full', 'ultra', 'off'].includes(m)) {
      throw new Error('--mode must be one of: lite|full|ultra|off');
    }
    opts.mode = m;
  }
  return opts;
}

function wants(host, opts) {
  return opts.host === 'all' || opts.host === host;
}

function configBase() {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function repoCacheDir() {
  return path.join(configBase(), 'aftermath', 'repo');
}

function run(cmd, args, opts) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts });
}

function preflight() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) throw new Error(`node >= 18 required (found ${process.version})`);
  try {
    run('git', ['--version']);
  } catch (_) {
    throw new Error('git is required but not on PATH');
  }
}

function validateRepo(dir) {
  const need = [
    'AFTERMATH.md',
    path.join('.opencode', 'plugins', PLUGIN_BASENAME),
    path.join('.opencode', 'commands'),
  ];
  for (const rel of need) {
    if (!fs.existsSync(path.join(dir, rel))) {
      throw new Error(`not an aftermath checkout (missing ${rel}): ${dir}`);
    }
  }
}

function ensureRepo(opts, log) {
  if (opts.source) {
    const dir = path.resolve(opts.source);
    validateRepo(dir);
    log(`using local source: ${dir}`);
    return dir;
  }
  const dir = repoCacheDir();
  if (fs.existsSync(path.join(dir, '.git'))) {
    log(`updating cached clone: ${dir}`);
    if (!opts.dryRun) {
      run('git', ['-C', dir, 'fetch', 'origin']);
      run('git', ['-C', dir, 'checkout', opts.ref]);
      run('git', ['-C', dir, 'pull', '--ff-only', 'origin', opts.ref]);
    }
  } else {
    log(`cloning ${REPO_URL}#${opts.ref} → ${dir}`);
    if (!opts.dryRun) {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      run('git', ['clone', '--branch', opts.ref, '--depth', '1', REPO_URL, dir]);
    }
  }
  return dir;
}

function loadOpencodeJson(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const cfg = JSON.parse(raw);
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

function removePluginEntry(cfg) {
  const list = Array.isArray(cfg.plugin) ? cfg.plugin : [];
  const next = list.filter((e) => {
    const s = typeof e === 'string' ? e : Array.isArray(e) ? e[0] : '';
    return !(typeof s === 'string' && s.includes('aftermath'));
  });
  return { changed: next.length !== list.length, next };
}

function pluginSpec(repoDir, projectDir) {
  const abs = path.join(repoDir, '.opencode', 'plugins', PLUGIN_BASENAME);
  // A checkout wiring itself uses the portable relative spec.
  if (projectDir && path.resolve(projectDir) === path.resolve(repoDir)) {
    return './.opencode/plugins/aftermath.mjs';
  }
  return abs;
}

function linkCommands(repoDir, targetCmdDir, opts, log) {
  const srcDir = path.join(repoDir, '.opencode', 'commands');
  const files = fs.existsSync(srcDir)
    ? fs.readdirSync(srcDir).filter((f) => f.endsWith('.md'))
    : [];
  let linked = 0;
  let skipped = 0;
  for (const file of files) {
    const src = path.join(srcDir, file);
    const dest = path.join(targetCmdDir, file);
    let existing = null;
    try {
      existing = fs.readlinkSync(dest);
    } catch (_) {
      if (fs.existsSync(dest)) {
        let same = false;
        try {
          same =
            fs.readFileSync(dest, 'utf8') === fs.readFileSync(src, 'utf8');
        } catch (_) {
          same = false;
        }
        if (same) {
          log(`already in place: ${dest}`);
          skipped++;
        } else {
          log(`skip (real file differs, left alone): ${dest}`);
          skipped++;
        }
        continue;
      }
    }
    if (existing === src) {
      skipped++;
      continue;
    }
    log(`link: ${dest} → ${src}`);
    if (!opts.dryRun) {
      fs.mkdirSync(targetCmdDir, { recursive: true });
      try {
        fs.unlinkSync(dest);
      } catch (_) {
        // nothing there
      }
      fs.symlinkSync(src, dest);
    }
    linked++;
  }
  return { linked, skipped };
}

function unlinkCommands(repoDir, targetCmdDir, opts, log) {
  if (!fs.existsSync(targetCmdDir)) return { removed: 0 };
  let removed = 0;
  for (const file of fs.readdirSync(targetCmdDir).filter((f) => f.endsWith('.md'))) {
    const dest = path.join(targetCmdDir, file);
    let target = null;
    try {
      target = fs.readlinkSync(dest);
    } catch (_) {
      continue; // real file — not ours
    }
    if (target && target.includes('aftermath')) {
      log(`unlink: ${dest}`);
      if (!opts.dryRun) fs.unlinkSync(dest);
      removed++;
    }
  }
  return { removed };
}

function wireOpencode(opts, repoDir, log) {
  const scope = opts.project ? process.cwd() : path.join(configBase(), 'opencode');
  const cmdDir = opts.project
    ? path.join(scope, '.opencode', 'commands')
    : path.join(scope, 'commands');
  const file = path.join(scope, 'opencode.json');
  const spec = opts.project ? pluginSpec(repoDir, process.cwd()) : pluginSpec(repoDir, null);

  if (opts.uninstall) {
    if (!fs.existsSync(file)) {
      log('nothing to remove (no opencode.json)');
      return;
    }
    const cfg = loadOpencodeJson(file);
    const { changed, next } = removePluginEntry(cfg);
    if (changed) {
      log(`remove aftermath plugin from ${file}`);
      if (!opts.dryRun) {
        cfg.plugin = next;
        if (cfg.plugin.length === 0) delete cfg.plugin;
        fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
      }
    } else {
      log('plugin entry already absent');
    }
    const { removed } = unlinkCommands(repoDir, cmdDir, opts, log);
    log(`removed ${removed} command link(s)`);
    return;
  }

  const cfg = opts.dryRun && !fs.existsSync(file) ? {} : loadOpencodeJson(file);
  if (!cfg.$schema) cfg.$schema = SCHEMA_URL;
  const { changed, next } = ensurePluginEntry(cfg, spec);
  if (changed) {
    log(`add plugin to ${file}: ${spec}`);
    if (!opts.dryRun) {
      cfg.plugin = next;
      fs.mkdirSync(scope, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
    }
  } else {
    log('plugin entry already present');
  }
  const { linked, skipped } = linkCommands(repoDir, cmdDir, opts, log);
  log(`commands: ${linked} linked, ${skipped} already in place`);
  log('skills auto-register via the plugin config hook — no action needed');
}

function printHostSteps(opts, log) {
  if (opts.uninstall) return;
  if (wants('claude', opts)) {
    log('Claude Code (interactive — run these two prompts):');
    log('  /plugin marketplace add moah0911/aftermath');
    log('  /plugin install aftermath@aftermath');
  }
  if (wants('codex', opts)) {
    log('Codex:');
    log('  codex plugin add aftermath@aftermath');
  }
}

function persistMode(opts, log) {
  if (!opts.mode || opts.uninstall) return;
  const cfg = require(path.join(__dirname, '..', 'hooks', 'aftermath-config'));
  log(`persist mode: ${opts.mode}`);
  if (!opts.dryRun) cfg.writeMode(opts.mode);
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(usage());
    return 0;
  }
  const prefix = opts.dryRun ? '[dry-run] ' : '';
  const log = (m) => console.log(prefix + m);
  preflight();
  const repoDir = ensureRepo(opts, log);
  if (!opts.dryRun) validateRepo(repoDir);
  if (wants('opencode', opts)) wireOpencode(opts, repoDir, log);
  else log('opencode wiring skipped (--host ' + opts.host + ')');
  persistMode(opts, log);
  printHostSteps(opts, log);
  if (wants('opencode', opts) && !opts.uninstall) {
    log('done — quit and restart opencode (config loads at startup)');
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error('aftermath install failed: ' + (e && e.message ? e.message : e));
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  ensurePluginEntry,
  removePluginEntry,
  pluginSpec,
  loadOpencodeJson,
  REPO_URL,
};
