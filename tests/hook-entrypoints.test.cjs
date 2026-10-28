'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const preToolUse = path.join(root, 'hooks', 'pre-tool-use.cjs');
const postToolUse = path.join(root, 'hooks', 'post-tool-use.cjs');
const userPromptSubmit = path.join(root, 'hooks', 'user-prompt-submit.cjs');
const sessionStart = path.join(root, 'hooks', 'session-start.cjs');
const stateFile = () => path.join(tmp, 'aftermath', 'state.json');

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-hooks-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function readHookState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeHookState(value) {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(value));
}

function setMode(mode) {
  fs.mkdirSync(path.join(tmp, 'opencode'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'opencode', '.aftermath-active'), mode);
}

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

describe('pre-tool-use edit freeze', () => {
  it('blocks edits while a failure is unresolved and allows after clearing', () => {
    writeHookState({ failureUnresolved: true, lastErrorExcerpt: 'auth.ts broke 3 tests' });
    const blocked = run(
      preToolUse,
      JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'auth.ts' } })
    );
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /forward edit blocked/);
    assert.match(blocked.stderr, /auth\.ts broke 3 tests/);

    writeHookState({ failureUnresolved: false });
    const allowed = run(
      preToolUse,
      JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'auth.ts' } })
    );
    assert.equal(allowed.status, 0);

    writeHookState({ failureUnresolved: true });
    setMode('lite');
    const lite = run(
      preToolUse,
      JSON.stringify({ tool_name: 'MultiEdit', tool_input: { file_path: 'auth.ts' } })
    );
    assert.equal(lite.status, 0);
  });
});

describe('post-tool-use hook', () => {
  const bash = (command, output) =>
    JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command },
      tool_response: { output },
    });

  it('records a test failure and clears it after a green run', () => {
    const failed = run(postToolUse, bash('pytest', 'FAILED tests/auth.spec.ts'));
    assert.equal(failed.status, 2);
    assert.match(failed.stderr, /test-regression/);
    assert.equal(readHookState().failureUnresolved, true);

    const passed = run(postToolUse, bash('pytest', '12 passed in 0.4s'));
    assert.equal(passed.status, 0);
    assert.equal(readHookState().failureUnresolved, false);
  });

  it('surfaces build, dependency, and merge signals without freezing', () => {
    const build = run(
      postToolUse,
      bash('npm run build', 'error TS2322: Type string is not assignable')
    );
    assert.equal(build.status, 2);
    assert.match(build.stderr, /build-failure/);
    assert.equal(readHookState().failureUnresolved, false);

    const dependency = run(
      postToolUse,
      bash('npm install', 'npm ERR! ERESOLVE unable to resolve dependency tree')
    );
    assert.equal(dependency.status, 2);
    assert.match(dependency.stderr, /dependency-failure/);
    assert.equal(readHookState().failureUnresolved, false);

    const merge = run(
      postToolUse,
      bash('git merge feature', 'CONFLICT (content): Merge conflict in src/auth.ts')
    );
    assert.equal(merge.status, 2);
    assert.match(merge.stderr, /merge-conflict/);
    assert.equal(readHookState().failureUnresolved, false);
  });

  it('detects flaky alternation and does not freeze', () => {
    run(postToolUse, bash('pytest', 'FAILED tests/auth.spec.ts'));
    run(postToolUse, bash('pytest', '12 passed in 0.4s'));
    const flaky = run(postToolUse, bash('pytest', 'FAILED tests/auth.spec.ts'));
    assert.equal(flaky.status, 2);
    assert.match(flaky.stderr, /flaky-test/);
    assert.equal(readHookState().failureUnresolved, false);
  });

  it('escalates repeated errors only after an edit', () => {
    const first = run(postToolUse, bash('node build.js', 'Error: cannot find auth'));
    assert.equal(first.status, 0);
    assert.equal(readHookState().failureUnresolved, false);

    run(
      postToolUse,
      JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'auth.js' } })
    );
    assert.equal(readHookState().editSinceLastFailure, true);

    const second = run(postToolUse, bash('node build.js', 'Error: cannot find auth'));
    assert.equal(second.status, 2);
    assert.match(second.stderr, /retry-loop/);
    assert.equal(readHookState().failureUnresolved, true);
  });

  it('ignores unknown tools and empty output', () => {
    const read = run(
      postToolUse,
      JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'x' } })
    );
    assert.equal(read.status, 0);
    const empty = run(postToolUse, bash('git status', ''));
    assert.equal(empty.status, 0);
  });
});

describe('user-prompt-submit hook', () => {
  it('injects correction and unresolved-failure reminders', () => {
    writeHookState({ failureUnresolved: true, lastErrorExcerpt: 'auth broke' });
    const r = run(
      userPromptSubmit,
      JSON.stringify({ prompt: 'you broke the build' })
    );
    assert.equal(r.status, 0);
    assert.match(r.stdout, /user corrected you/);
    assert.match(r.stdout, /failure unresolved/);
  });

  it('persists mode and clears failure on off or lite', () => {
    writeHookState({ failureUnresolved: true });
    run(userPromptSubmit, JSON.stringify({ prompt: '/aftermath off' }));
    assert.equal(
      fs.readFileSync(path.join(tmp, 'opencode', '.aftermath-active'), 'utf8'),
      'off'
    );
    assert.equal(readHookState().failureUnresolved, false);

    writeHookState({ failureUnresolved: true });
    run(userPromptSubmit, JSON.stringify({ prompt: '/aftermath lite' }));
    assert.equal(
      fs.readFileSync(path.join(tmp, 'opencode', '.aftermath-active'), 'utf8'),
      'lite'
    );
    assert.equal(readHookState().failureUnresolved, false);
  });

  it('clears failure on /aftermath-revert and stays quiet on malformed input', () => {
    writeHookState({ failureUnresolved: true });
    const revert = run(
      userPromptSubmit,
      JSON.stringify({ prompt: '/aftermath-revert' })
    );
    assert.equal(revert.status, 0);
    assert.equal(readHookState().failureUnresolved, false);

    const malformed = run(userPromptSubmit, '{not json');
    assert.equal(malformed.status, 0);
  });
});

describe('shared hook lifecycle config', () => {
  it('declares prompt, post-tool, and edit-freeze hooks', () => {
    const config = JSON.parse(
      fs.readFileSync(
        path.join(root, 'hooks', 'claude-codex-hooks.json'),
        'utf8'
      )
    );
    assert.ok(config.hooks.UserPromptSubmit);
    assert.ok(config.hooks.PostToolUse);
    assert.ok(
      config.hooks.PreToolUse.some(
        (entry) => entry.matcher === 'Edit|Write|MultiEdit'
      )
    );
    const commands = JSON.stringify(config.hooks);
    assert.match(commands, /CLAUDE_PLUGIN_ROOT/);
    assert.match(commands, /AFTERMATH_DIR/);
    const codex = JSON.parse(
      fs.readFileSync(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8')
    );
    assert.equal(codex.hooks, '../hooks/claude-codex-hooks.json');
  });
});
