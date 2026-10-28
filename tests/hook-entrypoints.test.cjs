'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const preToolUse = path.join(root, 'hooks', 'pre-tool-use.cjs');
const sessionStart = path.join(root, 'hooks', 'session-start.cjs');

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-hooks-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function run(script, input, env = {}, cwd = process.cwd()) {
  return spawnSync('node', [script], {
    input,
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      XDG_CONFIG_HOME: tmp,
      AFTERMATH_DIR: root,
      ...env,
    },
  });
}

describe('pre-tool-use hook', () => {
  it('blocks destructive commands with exit 2', () => {
    const r = run(
      preToolUse,
      JSON.stringify({ tool_input: { command: 'rm -rf /tmp/build' } })
    );
    assert.equal(r.status, 2);
    assert.match(r.stderr, /destructive command blocked/);
    assert.match(r.stderr, /rm -rf/);
  });

  it('allows safe commands', () => {
    const r = run(
      preToolUse,
      JSON.stringify({ tool_input: { command: 'git status --short' } })
    );
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  it('stays quiet on malformed input', () => {
    const r = run(preToolUse, '{not json');
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  it('accepts toolInput/cmd aliases and empty commands', () => {
    const blocked = run(
      preToolUse,
      JSON.stringify({ toolInput: { cmd: 'rm -rf /tmp/build' } })
    );
    assert.equal(blocked.status, 2);

    const empty = run(preToolUse, JSON.stringify({ tool_input: {} }));
    assert.equal(empty.status, 0);
    assert.equal(empty.stderr, '');
  });

  it('uses project safe/protected paths and mode gating', () => {
    const project = path.join(tmp, 'project');
    fs.mkdirSync(path.join(project, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    fs.mkdirSync(path.join(project, '.aftermath'), { recursive: true });
    fs.writeFileSync(
      path.join(project, '.aftermath', 'config.json'),
      JSON.stringify({ safePaths: ['node_modules'], protectedPaths: ['src'] })
    );
    const env = { AFTERMATH_PROJECT_DIR: project };

    const safe = run(
      preToolUse,
      JSON.stringify({ tool_input: { command: 'rm -rf node_modules' } }),
      env,
      project
    );
    assert.equal(safe.status, 0);

    const protectedRun = run(
      preToolUse,
      JSON.stringify({ tool_input: { command: 'rm -rf src' } }),
      env,
      project
    );
    assert.equal(protectedRun.status, 2);
    assert.match(protectedRun.stderr, /protected-path/);

    fs.mkdirSync(path.join(tmp, 'opencode'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'opencode', '.aftermath-active'), 'lite');
    const lite = run(
      preToolUse,
      JSON.stringify({ tool_input: { command: 'rm -rf src' } }),
      env,
      project
    );
    assert.equal(lite.status, 0);
  });
});

describe('session-start hook', () => {
  it('prints the ladder at full by default', () => {
    const r = run(sessionStart, '');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /AFTERMATH MODE ACTIVE — level: full/);
    assert.match(r.stdout, /Revert now/);
  });

  it('prints nothing when mode is off', () => {
    const scope = path.join(tmp, 'opencode');
    fs.mkdirSync(scope, { recursive: true });
    fs.writeFileSync(path.join(scope, '.aftermath-active'), 'off');
    const r = run(sessionStart, '');
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  it('stays quiet when the install root is missing', () => {
    const r = run(sessionStart, '', { AFTERMATH_DIR: path.join(tmp, 'missing') });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });
});
