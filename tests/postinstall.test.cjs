'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const POSTINSTALL = path.join(REPO_ROOT, 'scripts', 'postinstall.js');
const POSTUNINSTALL = path.join(REPO_ROOT, 'scripts', 'postuninstall.js');

let tmp;
let proj;
let home;
let binDir;
let callLog;
let prevEnv;

// A fake CLI that records how it was invoked and exits 0. Keeps these tests
// hermetic: the real claude/codex/opencode binaries are never executed and the
// real ~/.claude, ~/.codex, ~/.config/opencode are never touched.
function makeShim(name, exitCode = 0, stdout = '') {
  const file = path.join(binDir, name);
  fs.writeFileSync(
    file,
    '#!/bin/sh\n' +
      'printf "%s %s\\n" "' +
      name +
      '" "$*" >> "' +
      callLog +
      '"\n' +
      // --version must succeed so the installer sees the CLI as present;
      // every other invocation exits with the requested code.
      'if [ "$1" = "--version" ]; then exit 0; fi\n' +
      (stdout ? 'printf "%s\\n" "' + stdout + '"\n' : '') +
      'exit ' +
      exitCode +
      '\n'
  );
  fs.chmodSync(file, 0o755);
}

function runScript(script, env) {
  return spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      // Hermetic: ONLY the shim dir is on PATH, so the real claude/codex/
      // opencode binaries can never be executed by these tests.
      PATH: binDir,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      ...env,
    },
    encoding: 'utf8',
    timeout: 60000,
  });
}

function calls() {
  if (!fs.existsSync(callLog)) return [];
  return fs.readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean);
}

beforeEach(() => {
  prevEnv = { ...process.env };
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-postinstall-'));
  proj = path.join(tmp, 'project');
  home = path.join(tmp, 'home');
  binDir = path.join(tmp, 'bin');
  callLog = path.join(tmp, 'calls.log');
  fs.mkdirSync(proj);
  fs.mkdirSync(home);
  fs.mkdirSync(binDir);
  fs.writeFileSync(callLog, '');
  // No agent CLIs by default — each test opts in.
  makeShim('claude', 0, 'aftermath@aftermath (scope: project)');
  makeShim('codex', 0, 'aftermath@aftermath');
  makeShim('opencode', 0, '0.5.3');
  fs.unlinkSync(path.join(binDir, 'claude'));
  fs.unlinkSync(path.join(binDir, 'codex'));
  fs.unlinkSync(path.join(binDir, 'opencode'));
});

afterEach(() => {
  process.env = prevEnv;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('postinstall', () => {
  it('skips auto-wiring on global installs', () => {
    const r = runScript(POSTINSTALL, {
      INIT_CWD: proj,
      npm_config_global: 'true',
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /global install — auto-wiring skipped/);
    assert.equal(fs.existsSync(path.join(proj, 'opencode.json')), false);
    assert.equal(fs.existsSync(path.join(proj, '.opencode')), false);
  });

  it('honors AFM_SKIP_INSTALL=1', () => {
    const r = runScript(POSTINSTALL, { INIT_CWD: proj, AFM_SKIP_INSTALL: '1' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /skipped \(AFM_SKIP_INSTALL=1\)/);
    assert.equal(fs.existsSync(path.join(proj, 'opencode.json')), false);
  });

  it('wires opencode at project scope with a relative spec and staged copies', () => {
    const r = runScript(POSTINSTALL, { INIT_CWD: proj });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /opencode: \.\/\.opencode\/plugins\/aftermath\.mjs/);

    const cfg = JSON.parse(fs.readFileSync(path.join(proj, 'opencode.json'), 'utf8'));
    assert.deepEqual(cfg.plugin, ['./.opencode/plugins/aftermath.mjs']);
    assert.equal(cfg.$schema, 'https://opencode.ai/config.json');

    // Real package assets staged into the project (not the scripts/ dir).
    assert.ok(fs.existsSync(path.join(proj, '.opencode', 'plugins', 'aftermath.mjs')));
    assert.ok(fs.existsSync(path.join(proj, '.opencode', 'plugins', 'aftermath-frontmatter.cjs')));
    assert.ok(fs.existsSync(path.join(proj, 'hooks', 'aftermath-config.js')));
    assert.ok(fs.existsSync(path.join(proj, 'skills', 'aftermath', 'SKILL.md')));
    const commands = fs.readdirSync(path.join(proj, '.opencode', 'commands'));
    assert.ok(commands.includes('aftermath.md'));
  });

  it('installs claude and codex through their CLIs when present', () => {
    makeShim('claude', 0, 'aftermath@aftermath (scope: project)');
    makeShim('codex', 0, 'aftermath@aftermath');
    const r = runScript(POSTINSTALL, { INIT_CWD: proj });
    assert.equal(r.status, 0);

    const claudeCalls = calls().filter((c) => c.startsWith('claude '));
    assert.ok(
      claudeCalls.some((c) => /plugin install aftermath --marketplace/.test(c)),
      'expected one-shot claude plugin install, got: ' + claudeCalls.join(' | ')
    );
    assert.ok(claudeCalls.some((c) => /--scope project/.test(c)));

    const codexCalls = calls().filter((c) => c.startsWith('codex '));
    assert.ok(codexCalls.some((c) => /plugin marketplace add/.test(c)));
    assert.ok(codexCalls.some((c) => /plugin add aftermath@aftermath/.test(c)));
  });

  it('reports agents that are not installed without failing', () => {
    const r = runScript(POSTINSTALL, { INIT_CWD: proj });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /claude: not detected/);
    assert.match(r.stdout, /codex: not detected/);
  });

  it('never exits non-zero when an agent CLI fails', () => {
    makeShim('claude', 3);
    makeShim('codex', 4);
    const r = runScript(POSTINSTALL, { INIT_CWD: proj });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /claude: plugin install failed|claude: marketplace add failed/);
  });

  it('is idempotent and never clobbers user-modified staged files', () => {
    const env = { INIT_CWD: proj };
    runScript(POSTINSTALL, env);
    const cmdFile = path.join(proj, '.opencode', 'commands', 'aftermath.md');
    fs.writeFileSync(cmdFile, 'EDITED BY USER\n');

    const r2 = runScript(POSTINSTALL, env);
    assert.equal(r2.status, 0);
    assert.equal(fs.readFileSync(cmdFile, 'utf8'), 'EDITED BY USER\n');
    assert.match(r2.stdout, /in place/);
  });
});

describe('postuninstall', () => {
  it('removes staged project assets and the opencode entry', () => {
    const env = { INIT_CWD: proj };
    runScript(POSTINSTALL, env);
    assert.equal(fs.existsSync(path.join(proj, 'opencode.json')), true);

    const r = runScript(POSTUNINSTALL, env);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /opencode: removed/);

    const cfg = JSON.parse(fs.readFileSync(path.join(proj, 'opencode.json'), 'utf8'));
    assert.equal(cfg.plugin, undefined);
    assert.equal(fs.existsSync(path.join(proj, '.opencode', 'plugins', 'aftermath.mjs')), false);
    assert.equal(fs.existsSync(path.join(proj, 'hooks', 'aftermath-config.js')), false);
    assert.equal(fs.existsSync(path.join(proj, 'skills', 'aftermath', 'SKILL.md')), false);
  });

  it('preserves user-modified files', () => {
    const env = { INIT_CWD: proj };
    runScript(POSTINSTALL, env);
    const cmdFile = path.join(proj, '.opencode', 'commands', 'aftermath.md');
    fs.writeFileSync(cmdFile, 'EDITED BY USER\n');

    const r = runScript(POSTUNINSTALL, env);
    assert.equal(r.status, 0);
    assert.equal(fs.readFileSync(cmdFile, 'utf8'), 'EDITED BY USER\n');
    assert.equal(fs.existsSync(path.join(proj, '.opencode', 'plugins', 'aftermath.mjs')), false);
  });

  it('skips on global uninstall', () => {
    const r = runScript(POSTUNINSTALL, {
      INIT_CWD: proj,
      npm_config_global: 'true',
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /global uninstall/);
    assert.equal(fs.existsSync(path.join(proj, 'opencode.json')), false);
  });
});

describe('claude plugin manifest', () => {
  it('passes the shape claude plugin requires', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')
    );
    assert.equal(typeof manifest.author, 'object');
    assert.ok(manifest.skills.startsWith('./'), 'skills must start with ./');
    assert.ok(manifest.hooks.startsWith('./'), 'hooks must start with ./');
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'skills')));
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'hooks', 'claude-codex-hooks.json')));
  });

  it('codex manifest uses the same relative paths', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, '.codex-plugin', 'plugin.json'), 'utf8')
    );
    assert.ok(manifest.skills.startsWith('./'));
    assert.ok(manifest.hooks.startsWith('./'));
  });
});
