import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import createPlugin, {
  pending,
  resetState,
} from '../.opencode/plugins/aftermath.mjs';

let prevEnv;
let tmpXdg;
let tmpFiles;

beforeEach(() => {
  prevEnv = { ...process.env };
  tmpXdg = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-plugin-'));
  tmpFiles = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-files-'));
  process.env.XDG_CONFIG_HOME = tmpXdg;
  delete process.env.AFTERMATH_DEFAULT_MODE;
  resetState();
});

afterEach(() => {
  process.env = prevEnv;
  fs.rmSync(tmpXdg, { recursive: true, force: true });
  fs.rmSync(tmpFiles, { recursive: true, force: true });
});

function writeConfig(value) {
  const dir = path.join(tmpXdg, 'aftermath');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(value));
}

function writeProjectConfig(dir, value) {
  fs.mkdirSync(path.join(dir, '.aftermath'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.aftermath', 'config.json'),
    JSON.stringify(value)
  );
}

async function makePlugin(client) {
  return createPlugin(client ? { client } : {});
}

async function setMode(plugin, mode) {
  await plugin['command.execute.before']({
    command: 'aftermath',
    arguments: mode,
  });
}

async function transform(plugin) {
  const out = { system: [] };
  await plugin['experimental.chat.system.transform']({}, out);
  return out.system.join('\n');
}

async function failTest(plugin) {
  await plugin['tool.execute.after'](
    { tool: 'bash', args: { command: 'pytest tests/ -q' } },
    { output: 'FAILED tests/auth.spec.ts::login' }
  );
}

async function passTest(plugin) {
  await plugin['tool.execute.after'](
    { tool: 'bash', args: { command: 'pytest tests/ -q' } },
    { output: '12 passed in 0.42s' }
  );
}

describe('opencode plugin', () => {
  it('registers commands + skills dir via config hook', async () => {
    const plugin = await makePlugin();
    const cfg = {};
    await plugin.config(cfg);
    for (const name of [
      'aftermath',
      'aftermath-status',
      'aftermath-revert',
      'aftermath-audit',
      'aftermath-log',
      'aftermath-checkpoint',
      'aftermath-init',
    ]) {
      assert.ok(cfg.command[name], `command ${name} not registered`);
      assert.ok(cfg.command[name].template.length > 20);
    }
    assert.ok(cfg.skills.paths.some((p) => p.endsWith('skills')));
  });

  it('preserves user commands and dedupes the skills path', async () => {
    const plugin = await makePlugin();
    const cfg = {
      command: { user: { description: 'mine', template: 'keep me' } },
      skills: { paths: ['/existing'] },
    };
    await plugin.config(cfg);
    await plugin.config(cfg);
    assert.deepEqual(cfg.command.user, {
      description: 'mine',
      template: 'keep me',
    });
    assert.equal(cfg.skills.paths.filter((p) => p.endsWith('skills')).length, 1);
    assert.ok(cfg.skills.paths.includes('/existing'));
  });

  it('injects ladder at full, stays silent at off', async () => {
    const plugin = await makePlugin();
    await setMode(plugin, 'full');
    const full = await transform(plugin);
    assert.match(full, /AFTERMATH MODE ACTIVE/);

    await setMode(plugin, 'off');
    const out = { system: ['base'] };
    await plugin['experimental.chat.system.transform']({}, out);
    assert.deepEqual(out.system, ['base']);
  });

  it('mode switch persists to next turn, ignores other commands', async () => {
    const plugin = await makePlugin();
    await setMode(plugin, 'ultra');
    assert.match(await transform(plugin), /level: ultra/);
    await plugin['command.execute.before']({
      command: 'something-else',
      arguments: 'x',
    });
    assert.match(await transform(plugin), /level: ultra/);
  });

  it('ignores bare or invalid /aftermath arguments', async () => {
    const plugin = await makePlugin();
    await setMode(plugin, 'ultra');
    await plugin['command.execute.before']({ command: 'aftermath', arguments: '' });
    await plugin['command.execute.before']({
      command: 'aftermath',
      arguments: 'banana',
    });
    assert.match(await transform(plugin), /level: ultra/);
  });

  it('blocks destructive commands at full but stays advisory at lite', async () => {
    const plugin = await makePlugin();
    await setMode(plugin, 'full');
    await assert.rejects(
      plugin['tool.execute.before']({
        tool: 'bash',
        args: { command: 'git push --force origin main' },
      }),
      /destructive command blocked/
    );
    assert.match(await transform(plugin), /destructive-action/);

    resetState();
    await setMode(plugin, 'lite');
    await plugin['tool.execute.before']({
      tool: 'bash',
      args: { command: 'git push --force origin main' },
    });
    assert.match(await transform(plugin), /destructive-action/);
  });

  it('honors the destructive allowlist and top-level command fallback', async () => {
    writeConfig({ destructiveAllowlist: ['git clean -fd'] });
    const plugin = await makePlugin();
    await setMode(plugin, 'full');
    await plugin['tool.execute.before']({
      tool: 'bash',
      args: { command: 'git clean -fd' },
    });
    await assert.rejects(
      plugin['tool.execute.before']({
        tool: 'bash',
        command: 'git push --force origin main',
      }),
      /destructive command blocked/
    );
  });

  it('allows artifact deletes and blocks protected targets from project config', async () => {
    const project = path.join(tmpFiles, 'policy-project');
    fs.mkdirSync(path.join(project, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    writeProjectConfig(project, {
      safePaths: ['node_modules'],
      protectedPaths: ['src'],
    });
    process.env.AFTERMATH_PROJECT_DIR = project;
    try {
      const plugin = await makePlugin();
      await setMode(plugin, 'full');
      await plugin['tool.execute.before']({
        tool: 'bash',
        args: { command: 'rm -rf node_modules' },
      });
      await assert.rejects(
        plugin['tool.execute.before']({
          tool: 'bash',
          args: { command: 'rm -rf src' },
        }),
        /protected-path/
      );
    } finally {
      delete process.env.AFTERMATH_PROJECT_DIR;
    }
  });

  it('surfaces build, dependency, and merge signals without freezing edits', async () => {
    const plugin = await makePlugin();
    await setMode(plugin, 'full');

    await plugin['tool.execute.after'](
      { tool: 'bash', args: { command: 'npm run build' } },
      { output: 'error TS2322: Type string is not assignable' }
    );
    assert.match(await transform(plugin), /build-failure/);

    await plugin['tool.execute.after'](
      { tool: 'bash', args: { command: 'npm install' } },
      { output: 'npm ERR! ERESOLVE unable to resolve dependency tree' }
    );
    assert.match(await transform(plugin), /dependency-failure/);

    await plugin['tool.execute.after'](
      { tool: 'bash', args: { command: 'git merge feature' } },
      { output: 'CONFLICT (content): Merge conflict in src/auth.ts' }
    );
    assert.match(await transform(plugin), /merge-conflict/);

    await plugin['tool.execute.before']({
      tool: 'edit',
      args: { filePath: path.join(tmpFiles, 'x.ts') },
    });
  });

  it('detects alternating outcomes as flaky and does not freeze edits', async () => {
    const plugin = await makePlugin();
    await setMode(plugin, 'full');
    const run = (output) =>
      plugin['tool.execute.after'](
        { tool: 'bash', args: { command: 'pytest' } },
        { output }
      );

    await run('FAILED tests/auth.spec.ts');
    await run('12 passed in 0.4s');
    await run('FAILED tests/auth.spec.ts');

    const out = await transform(plugin);
    assert.match(out, /flaky-test/);
    assert.doesNotMatch(out, /failure unresolved/);
    await plugin['tool.execute.before']({
      tool: 'edit',
      args: { filePath: path.join(tmpFiles, 'x.ts') },
    });
  });

  it('recognizes configured test commands', async () => {
    writeConfig({ testCommands: ['./scripts/check.sh'] });
    const plugin = await makePlugin();
    await setMode(plugin, 'full');
    await plugin['tool.execute.after'](
      { tool: 'bash', args: { command: './scripts/check.sh' } },
      { output: 'FAILED auth' }
    );
    assert.match(await transform(plugin), /test-regression/);
  });

  it('stays silent and non-blocking at off', async () => {
    const plugin = await makePlugin();
    await setMode(plugin, 'off');
    await plugin['tool.execute.before']({
      tool: 'bash',
      args: { command: 'git push --force origin main' },
    });
    const out = { system: ['base'] };
    await plugin['experimental.chat.system.transform']({}, out);
    assert.deepEqual(out.system, ['base']);
  });

  it('surfaces a correction on the next transform, then clears it', async () => {
    const plugin = await makePlugin();
    await setMode(plugin, 'full');
    await plugin.event({ type: 'chat.message', text: 'you broke the build' });
    assert.match(await transform(plugin), /user corrected you/);
    assert.doesNotMatch(await transform(plugin), /user corrected you/);
  });

  it('accepts prompt/object payloads and ignores corrections at off', async () => {
    const plugin = await makePlugin();
    await setMode(plugin, 'full');
    await plugin.event({ type: 'prompt', prompt: 'please revert it' });
    assert.match(await transform(plugin), /user corrected you/);

    await plugin.event({
      type: 'chat.message',
      message: { text: 'that is wrong, undo that' },
    });
    assert.match(await transform(plugin), /user corrected you/);

    await setMode(plugin, 'off');
    await plugin.event({ type: 'chat.message', text: 'you broke it' });
    const out = { system: ['base'] };
    await plugin['experimental.chat.system.transform']({}, out);
    assert.deepEqual(out.system, ['base']);
  });

  it('never breaks on circular event payloads', async () => {
    const plugin = await makePlugin();
    const data = {};
    data.self = data;
    await plugin.event({ type: 'chat.message', data });
  });

  it('logs signals and survives a throwing logger', async () => {
    const calls = [];
    const plugin = await makePlugin({
      app: { log: (entry) => calls.push(entry) },
    });
    await setMode(plugin, 'full');
    await assert.rejects(
      plugin['tool.execute.before']({
        tool: 'bash',
        args: { command: 'git push --force origin main' },
      })
    );
    assert.equal(calls[0].body.service, 'aftermath');

    const throwing = await makePlugin({
      app: {
        log: () => {
          throw new Error('logger down');
        },
      },
    });
    await setMode(throwing, 'full');
    await throwing.event({ type: 'chat.message', text: 'you broke it' });
    assert.match(await transform(throwing), /user corrected you/);
  });

  it('reports a green→red transition and freezes forward edits', async () => {
    const plugin = await makePlugin();
    await setMode(plugin, 'full');
    await passTest(plugin);
    await failTest(plugin);
    const out = await transform(plugin);
    assert.match(out, /went green->red/);
    assert.match(out, /failure unresolved/);
    assert.match(await transform(plugin), /failure unresolved/);

    await assert.rejects(
      plugin['tool.execute.before']({
        tool: 'edit',
        args: { filePath: path.join(tmpFiles, 'auth.ts') },
      }),
      /forward edit blocked/
    );

    await passTest(plugin);
    await plugin['tool.execute.before']({
      tool: 'edit',
      args: { filePath: path.join(tmpFiles, 'auth.ts') },
    });
  });

  it('reports a first red and clears the freeze on revert or off', async () => {
    const plugin = await makePlugin();
    await setMode(plugin, 'full');
    await failTest(plugin);
    assert.match(await transform(plugin), /went red/);

    await plugin['command.execute.before']({
      command: 'aftermath-revert',
      arguments: '',
    });
    await plugin['tool.execute.before']({
      tool: 'edit',
      args: { filePath: path.join(tmpFiles, 'auth.ts') },
    });

    await failTest(plugin);
    await setMode(plugin, 'off');
    await plugin['tool.execute.before']({
      tool: 'edit',
      args: { filePath: path.join(tmpFiles, 'auth.ts') },
    });
  });

  it('does not freeze edits at lite', async () => {
    const plugin = await makePlugin();
    await setMode(plugin, 'lite');
    await failTest(plugin);
    await plugin['tool.execute.before']({
      tool: 'edit',
      args: { filePath: path.join(tmpFiles, 'auth.ts') },
    });
  });

  it('escalates a repeat error only after an intervening edit', async () => {
    const plugin = await makePlugin();
    await setMode(plugin, 'lite');
    const error = 'AssertionError: expected 200 got 500';
    const run = () =>
      plugin['tool.execute.after'](
        { tool: 'bash', args: { command: 'pytest' } },
        { output: error }
      );

    await run();
    await run();
    assert.doesNotMatch(await transform(plugin), /retry-loop/);

    await plugin['tool.execute.before']({
      tool: 'edit',
      args: { filePath: path.join(tmpFiles, 'auth.ts') },
    });
    await plugin['tool.execute.after']({
      tool: 'edit',
      args: { filePath: path.join(tmpFiles, 'auth.ts') },
    });

    await run();
    const out = await transform(plugin);
    assert.match(out, /retry-loop/);
    assert.match(out, /2 attempts/);
    assert.match(out, /expected 200 got 500/);
  });

  it('checkpoints and auto-reverts a green→red edit at ultra', async () => {
    writeConfig({ autoRevert: true });
    const file = path.join(tmpFiles, 'auth.ts');
    fs.writeFileSync(file, 'before\n');

    const plugin = await makePlugin();
    await setMode(plugin, 'ultra');
    await passTest(plugin);

    await plugin['tool.execute.before']({
      tool: 'edit',
      args: { filePath: file },
    });
    fs.writeFileSync(file, 'agent edit\n');
    await plugin['tool.execute.after']({ tool: 'edit', args: { filePath: file } });

    assert.match(await transform(plugin), /checkpoint active/);

    await failTest(plugin);
    const out = await transform(plugin);
    assert.match(out, /auto-revert restored 1 file/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'before\n');
  });

  it('does not auto-revert on the first red, at full, or when opt-out', async () => {
    const file = path.join(tmpFiles, 'auth.ts');
    fs.writeFileSync(file, 'before\n');

    writeConfig({ autoRevert: true });
    const firstRed = await makePlugin();
    await setMode(firstRed, 'ultra');
    await firstRed['tool.execute.before']({
      tool: 'edit',
      args: { filePath: file },
    });
    fs.writeFileSync(file, 'agent edit\n');
    await firstRed['tool.execute.after']({
      tool: 'edit',
      args: { filePath: file },
    });
    await failTest(firstRed);
    assert.equal(fs.readFileSync(file, 'utf8'), 'agent edit\n');

    fs.writeFileSync(file, 'before\n');
    const full = await makePlugin();
    await setMode(full, 'full');
    await passTest(full);
    await full['tool.execute.before']({
      tool: 'edit',
      args: { filePath: file },
    });
    fs.writeFileSync(file, 'agent edit\n');
    await full['tool.execute.after']({
      tool: 'edit',
      args: { filePath: file },
    });
    await failTest(full);
    assert.equal(fs.readFileSync(file, 'utf8'), 'agent edit\n');

    fs.writeFileSync(file, 'before\n');
    writeConfig({ autoRevert: false });
    const optOut = await makePlugin();
    await setMode(optOut, 'ultra');
    await passTest(optOut);
    await optOut['tool.execute.before']({
      tool: 'edit',
      args: { filePath: file },
    });
    fs.writeFileSync(file, 'agent edit\n');
    await optOut['tool.execute.after']({
      tool: 'edit',
      args: { filePath: file },
    });
    await failTest(optOut);
    assert.equal(fs.readFileSync(file, 'utf8'), 'agent edit\n');
  });

  it('skips auto-revert when the file changed outside the agent', async () => {
    writeConfig({ autoRevert: true });
    const file = path.join(tmpFiles, 'auth.ts');
    fs.writeFileSync(file, 'before\n');

    const plugin = await makePlugin();
    await setMode(plugin, 'ultra');
    await passTest(plugin);
    await plugin['tool.execute.before']({
      tool: 'edit',
      args: { filePath: file },
    });
    fs.writeFileSync(file, 'agent edit\n');
    await plugin['tool.execute.after']({ tool: 'edit', args: { filePath: file } });
    fs.writeFileSync(file, 'manual edit\n');

    await failTest(plugin);
    const out = await transform(plugin);
    assert.match(out, /skipped 1 conflict/);
    assert.match(out, /auth\.ts/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'manual edit\n');
  });

  it('supports status, clear, and manual restore via /aftermath-checkpoint', async () => {
    writeConfig({ autoRevert: true });
    const file = path.join(tmpFiles, 'auth.ts');
    fs.writeFileSync(file, 'before\n');

    const plugin = await makePlugin();
    await setMode(plugin, 'ultra');
    await plugin['command.execute.before']({
      command: 'aftermath-checkpoint',
      arguments: 'status',
    });
    assert.match(await transform(plugin), /AFTERMATH REPORT: checkpoints/);

    await passTest(plugin);
    await plugin['tool.execute.before']({
      tool: 'edit',
      args: { filePath: file },
    });
    fs.writeFileSync(file, 'agent edit\n');
    await plugin['tool.execute.after']({ tool: 'edit', args: { filePath: file } });

    await plugin['command.execute.before']({
      command: 'aftermath-checkpoint',
      arguments: 'restore',
    });
    assert.match(await transform(plugin), /manual checkpoint restore/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'before\n');

    await plugin['command.execute.before']({
      command: 'aftermath-checkpoint',
      arguments: 'clear',
    });
    assert.match(await transform(plugin), /checkpoints cleared/);
  });

  it('resolves malformed hook inputs', async () => {
    const plugin = await makePlugin();
    await plugin['tool.execute.before']({});
    await plugin['tool.execute.before']({ tool: 'bash', args: {} });
    await plugin['tool.execute.before']({ tool: 'bash' });
    await plugin['tool.execute.after']({}, null);
    await plugin['tool.execute.after']({ tool: 'bash', args: {} }, null);
    await plugin['tool.execute.after']({ tool: 'read', args: {} }, null);
    await plugin.event(undefined);
    assert.equal(pending.retryLoop, false);
  });

  it('appends to an existing system prompt entry', async () => {
    const plugin = await makePlugin();
    await setMode(plugin, 'full');
    const out = { system: ['base'] };
    await plugin['experimental.chat.system.transform']({}, out);
    assert.equal(out.system.length, 1);
    assert.match(out.system[0], /^base/);
    assert.match(out.system[0], /AFTERMATH MODE ACTIVE/);
  });

  it('logs skipped checkpoints for binary files', async () => {
    writeConfig({ autoRevert: true });
    const file = path.join(tmpFiles, 'blob.bin');
    fs.writeFileSync(file, Buffer.from([0, 1, 2, 3]));
    const calls = [];
    const plugin = await makePlugin({
      app: { log: (entry) => calls.push(entry) },
    });
    await setMode(plugin, 'ultra');
    await plugin['tool.execute.before']({
      tool: 'edit',
      args: { filePath: file },
    });
    assert.ok(
      calls.some((c) => /checkpoint skipped \(binary\)/.test(c.body.message))
    );
  });

  it('survives throwing hook getters', async () => {
    const plugin = await makePlugin();
    await setMode(plugin, 'full');
    const hostile = {
      get tool() {
        throw new Error('boom');
      },
    };
    await plugin['tool.execute.before'](hostile);
    await plugin['tool.execute.after'](hostile, {});
  });

  it('escalates non-test repeat errors after an edit', async () => {
    const plugin = await makePlugin();
    await setMode(plugin, 'lite');
    const run = () =>
      plugin['tool.execute.after'](
        { tool: 'bash', args: { command: 'node build.js' } },
        { output: 'Error: cannot find module auth' }
      );

    await run();
    await run();
    assert.doesNotMatch(await transform(plugin), /retry-loop/);

    await plugin['tool.execute.before']({
      tool: 'edit',
      args: { filePath: path.join(tmpFiles, 'auth.ts') },
    });
    await plugin['tool.execute.after']({
      tool: 'edit',
      args: { filePath: path.join(tmpFiles, 'auth.ts') },
    });
    await run();
    const out = await transform(plugin);
    assert.match(out, /retry-loop/);
    assert.match(out, /2 attempts/);
    assert.match(out, /cannot find module auth/);
  });
});
