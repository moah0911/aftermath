import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import createPlugin from '../.opencode/plugins/aftermath.mjs';

let prevEnv;
let tmpXdg;

beforeEach(() => {
  prevEnv = { ...process.env };
  tmpXdg = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-plugin-'));
  process.env.XDG_CONFIG_HOME = tmpXdg;
  delete process.env.AFTERMATH_DEFAULT_MODE;
});

afterEach(() => {
  process.env = prevEnv;
  fs.rmSync(tmpXdg, { recursive: true, force: true });
});

describe('opencode plugin', () => {
  it('registers commands + skills dir via config hook', async () => {
    const plugin = await createPlugin({});
    const cfg = {};
    await plugin.config(cfg);
    for (const name of ['aftermath', 'aftermath-status', 'aftermath-revert', 'aftermath-audit', 'aftermath-log']) {
      assert.ok(cfg.command[name], `command ${name} not registered`);
      assert.ok(cfg.command[name].template.length > 20);
    }
    assert.ok(cfg.skills.paths.some((p) => p.endsWith('skills')));
  });

  it('injects ladder at full, stays silent at off', async () => {
    const plugin = await createPlugin({});
    await plugin['command.execute.before']({ command: 'aftermath', arguments: 'full' });
    const out = { system: ['base'] };
    await plugin['experimental.chat.system.transform']({}, out);
    assert.match(out.system[0], /AFTERMATH MODE ACTIVE/);

    await plugin['command.execute.before']({ command: 'aftermath', arguments: 'off' });
    const out2 = { system: ['base'] };
    await plugin['experimental.chat.system.transform']({}, out2);
    assert.equal(out2.system[0], 'base');
    await plugin['command.execute.before']({ command: 'aftermath', arguments: 'full' });
  });

  it('mode switch persists to next turn, ignores other commands', async () => {
    const plugin = await createPlugin({});
    await plugin['command.execute.before']({ command: 'aftermath', arguments: 'ultra' });
    const out = { system: [] };
    await plugin['experimental.chat.system.transform']({}, out);
    assert.match(out.system.join('\n'), /level: ultra/);
    await plugin['command.execute.before']({ command: 'something-else', arguments: 'x' });
    const out2 = { system: [] };
    await plugin['experimental.chat.system.transform']({}, out2);
    assert.match(out2.system.join('\n'), /level: ultra/);
    await plugin['command.execute.before']({ command: 'aftermath', arguments: 'full' });
  });

  it('destructive tripwire surfaces on next transform', async () => {
    const plugin = await createPlugin({});
    await plugin['command.execute.before']({ command: 'aftermath', arguments: 'full' });
    await plugin['tool.execute.before']({ tool: 'bash', args: { command: 'git push --force origin main' } });
    const out = { system: [] };
    await plugin['experimental.chat.system.transform']({}, out);
    assert.match(out.system.join('\n'), /destructive-action/);
  });

  it('test failure + repeat error surface skill pointers', async () => {
    const plugin = await createPlugin({});
    await plugin['command.execute.before']({ command: 'aftermath', arguments: 'full' });
    await plugin['tool.execute.after'](
      { tool: 'bash', args: { command: 'pytest tests/ -q' } },
      { output: 'FAILED tests/test_auth.py::test_login' }
    );
    let out = { system: [] };
    await plugin['experimental.chat.system.transform']({}, out);
    assert.match(out.system.join('\n'), /test-regression/);

    const err = 'AssertionError: expected 200 got 500';
    await plugin['tool.execute.after']({ tool: 'bash', args: { command: 'pytest' } }, { output: err });
    await plugin['tool.execute.after']({ tool: 'bash', args: { command: 'pytest' } }, { output: err });
    out = { system: [] };
    await plugin['experimental.chat.system.transform']({}, out);
    assert.match(out.system.join('\n'), /retry-loop/);
  });
});
