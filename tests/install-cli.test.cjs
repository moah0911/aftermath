'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const install = require('../scripts/install');

let prevEnv;
let prevCwd;
let tmp;
let fixture;

beforeEach(() => {
  prevEnv = { ...process.env };
  prevCwd = process.cwd();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-install-cli-'));
  process.env.XDG_CONFIG_HOME = path.join(tmp, 'xdg');
  delete process.env.AFTERMATH_DEFAULT_MODE;
  fixture = makeCheckout(path.join(tmp, 'checkout'));
});

afterEach(() => {
  process.chdir(prevCwd);
  process.env = prevEnv;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function makeCheckout(dir) {
  fs.mkdirSync(path.join(dir, '.opencode', 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.opencode', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'AFTERMATH.md'), 'ladder\n');
  fs.writeFileSync(
    path.join(dir, '.opencode', 'plugins', 'aftermath.mjs'),
    '// plugin\n'
  );
  fs.writeFileSync(path.join(dir, '.opencode', 'commands', 'one.md'), 'ONE\n');
  fs.writeFileSync(path.join(dir, '.opencode', 'commands', 'two.md'), 'TWO\n');
  return dir;
}

function capture(fn) {
  const logs = [];
  const errors = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (m) => logs.push(String(m));
  console.error = (m) => errors.push(String(m));
  try {
    return { result: fn(), logs, errors };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}

describe('installer preflight and repo handling', () => {
  it('prints usage and writes nothing on --help', () => {
    const { result, logs } = capture(() => install.main(['--help']));
    assert.equal(result, 0);
    assert.match(logs.join('\n'), /Usage: node scripts\/install\.js/);
    assert.equal(
      fs.existsSync(path.join(process.env.XDG_CONFIG_HOME, 'opencode')),
      false
    );
  });

  it('validates a checkout and rejects non-checkouts', () => {
    assert.doesNotThrow(() => install.validateRepo(fixture));
    assert.throws(() => install.validateRepo(tmp), /not an aftermath checkout/);
  });

  it('uses a local source without cloning', () => {
    const logs = [];
    const dir = install.ensureRepo(
      { source: fixture, ref: 'main', dryRun: true },
      (m) => logs.push(m)
    );
    assert.equal(dir, fixture);
    assert.match(logs.join('\n'), /using local source/);
  });

  it('reports clone and cached-update dry-runs without writing', () => {
    const logs = [];
    const opts = { source: null, ref: 'main', dryRun: true };
    install.ensureRepo(opts, (m) => logs.push(m));
    assert.match(logs.join('\n'), /cloning/);
    assert.equal(fs.existsSync(install.repoCacheDir()), false);

    fs.mkdirSync(path.join(install.repoCacheDir(), '.git'), { recursive: true });
    logs.length = 0;
    install.ensureRepo(opts, (m) => logs.push(m));
    assert.match(logs.join('\n'), /updating cached clone/);
  });

  it('rejects invalid source paths through cli', () => {
    const { result, errors } = capture(() =>
      install.cli(['--source', path.join(tmp, 'missing'), '--dry-run'])
    );
    assert.equal(result, 1);
    assert.match(errors.join('\n'), /not an aftermath checkout/);
  });

  it('rejects unknown flags through cli', () => {
    const { result, errors } = capture(() => install.cli(['--frobnicate']));
    assert.equal(result, 1);
    assert.match(errors.join('\n'), /unknown flag/);
  });

  it('reports a missing git binary', (t) => {
    if (process.platform === 'win32') return t.skip('POSIX PATH semantics');
    const emptyBin = path.join(tmp, 'empty-bin');
    fs.mkdirSync(emptyBin);
    process.env.PATH = emptyBin;
    const { result, errors } = capture(() => install.cli(['--source', fixture]));
    assert.equal(result, 1);
    assert.match(errors.join('\n'), /git is required/);
  });
});

describe('command linking', () => {
  it('links missing commands and leaves real files alone', () => {
    const dest = path.join(tmp, 'dest');
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'one.md'), 'ONE\n');
    fs.writeFileSync(path.join(dest, 'two.md'), 'different\n');

    const logs = [];
    const result = install.linkCommands(fixture, dest, { dryRun: false }, (m) =>
      logs.push(m)
    );
    assert.deepEqual(result, { linked: 0, skipped: 2 });
    assert.match(logs.join('\n'), /already in place|skip \(real file differs/);
    assert.equal(fs.lstatSync(path.join(dest, 'one.md')).isFile(), true);
  });

  it('links symlinks, reruns idempotently, and replaces wrong symlinks', () => {
    const dest = path.join(tmp, 'dest');
    const first = install.linkCommands(fixture, dest, { dryRun: false }, () => {});
    assert.deepEqual(first, { linked: 2, skipped: 0 });
    assert.equal(
      fs.readlinkSync(path.join(dest, 'one.md')),
      path.join(fixture, '.opencode', 'commands', 'one.md')
    );

    const second = install.linkCommands(fixture, dest, { dryRun: false }, () => {});
    assert.deepEqual(second, { linked: 0, skipped: 2 });

    fs.unlinkSync(path.join(dest, 'two.md'));
    fs.symlinkSync('/tmp/elsewhere.md', path.join(dest, 'two.md'));
    const third = install.linkCommands(fixture, dest, { dryRun: false }, () => {});
    assert.deepEqual(third, { linked: 1, skipped: 1 });
  });

  it('dry-run reports links without creating them', () => {
    const dest = path.join(tmp, 'dest-dry');
    const logs = [];
    const result = install.linkCommands(fixture, dest, { dryRun: true }, (m) =>
      logs.push(m)
    );
    assert.equal(result.linked, 2);
    assert.equal(fs.existsSync(dest), false);
    assert.match(logs.join('\n'), /link:/);
  });

  it('unlinks only aftermath symlinks', () => {
    const dest = path.join(tmp, 'dest-unlink');
    install.linkCommands(fixture, dest, { dryRun: false }, () => {});
    fs.writeFileSync(path.join(dest, 'real.md'), 'real\n');
    fs.symlinkSync('/etc/hosts', path.join(dest, 'foreign.md'));

    const logs = [];
    const result = install.unlinkCommands(fixture, dest, { dryRun: false }, (m) =>
      logs.push(m)
    );
    assert.equal(result.removed, 2);
    assert.equal(fs.existsSync(path.join(dest, 'one.md')), false);
    assert.equal(fs.existsSync(path.join(dest, 'two.md')), false);
    assert.equal(fs.readFileSync(path.join(dest, 'real.md'), 'utf8'), 'real\n');
    assert.equal(fs.readlinkSync(path.join(dest, 'foreign.md')), '/etc/hosts');
    assert.match(logs.join('\n'), /unlink:/);
  });

  it('unlink is a no-op when the command dir is absent', () => {
    const result = install.unlinkCommands(
      fixture,
      path.join(tmp, 'missing'),
      { dryRun: false },
      () => {}
    );
    assert.equal(result.removed, 0);
  });
});

describe('opencode wiring', () => {
  it('wires globally, is idempotent, and persists mode', () => {
    const logs = [];
    const opts = { project: false, dryRun: false, uninstall: false };
    install.wireOpencode(opts, fixture, (m) => logs.push(m));
    install.persistMode(
      { mode: 'ultra', uninstall: false, dryRun: false },
      (m) => logs.push(m)
    );

    const scope = path.join(process.env.XDG_CONFIG_HOME, 'opencode');
    const cfg = JSON.parse(
      fs.readFileSync(path.join(scope, 'opencode.json'), 'utf8')
    );
    assert.equal(cfg.$schema, 'https://opencode.ai/config.json');
    assert.deepEqual(cfg.plugin, [
      path.join(fixture, '.opencode', 'plugins', 'aftermath.mjs'),
    ]);
    assert.equal(
      fs.readFileSync(path.join(scope, '.aftermath-active'), 'utf8'),
      'ultra'
    );
    assert.equal(
      fs.readlinkSync(path.join(scope, 'commands', 'one.md')),
      path.join(fixture, '.opencode', 'commands', 'one.md')
    );

    logs.length = 0;
    install.wireOpencode(opts, fixture, (m) => logs.push(m));
    assert.match(logs.join('\n'), /plugin entry already present/);
    assert.match(logs.join('\n'), /0 linked, 2 already in place/);
  });

  it('wires a project with its own command directory', () => {
    const project = path.join(tmp, 'project');
    fs.mkdirSync(project);
    process.chdir(project);
    install.wireOpencode(
      { project: true, dryRun: false, uninstall: false },
      fixture,
      () => {}
    );

    const cfg = JSON.parse(
      fs.readFileSync(path.join(project, 'opencode.json'), 'utf8')
    );
    assert.deepEqual(cfg.plugin, [
      path.join(fixture, '.opencode', 'plugins', 'aftermath.mjs'),
    ]);
    assert.ok(
      fs.lstatSync(path.join(project, '.opencode', 'commands', 'one.md')).isSymbolicLink()
    );
  });

  it('uninstalls only its own wiring and reports a second no-op', () => {
    const project = path.join(tmp, 'project-uninstall');
    fs.mkdirSync(project);
    process.chdir(project);
    const opts = { project: true, dryRun: false, uninstall: false };
    install.wireOpencode(opts, fixture, () => {});

    const logs = [];
    install.wireOpencode(
      { project: true, dryRun: false, uninstall: true },
      fixture,
      (m) => logs.push(m)
    );
    const cfg = JSON.parse(
      fs.readFileSync(path.join(project, 'opencode.json'), 'utf8')
    );
    assert.equal(cfg.plugin, undefined);
    assert.equal(
      fs.existsSync(path.join(project, '.opencode', 'commands', 'one.md')),
      false
    );

    logs.length = 0;
    install.wireOpencode(
      { project: true, dryRun: false, uninstall: true },
      fixture,
      (m) => logs.push(m)
    );
    assert.match(logs.join('\n'), /plugin entry already absent/);
    assert.match(logs.join('\n'), /removed 0 command link/);
  });

  it('uninstall with no config is a no-op', () => {
    const project = path.join(tmp, 'project-empty');
    fs.mkdirSync(project);
    process.chdir(project);
    const logs = [];
    install.wireOpencode(
      { project: true, dryRun: false, uninstall: true },
      fixture,
      (m) => logs.push(m)
    );
    assert.match(logs.join('\n'), /nothing to remove/);
  });

  it('dry-run reports wiring without writing config or links', () => {
    const logs = [];
    install.wireOpencode(
      { project: false, dryRun: true, uninstall: false },
      fixture,
      (m) => logs.push(m)
    );
    assert.match(logs.join('\n'), /add plugin/);
    assert.equal(
      fs.existsSync(
        path.join(process.env.XDG_CONFIG_HOME, 'opencode', 'opencode.json')
      ),
      false
    );
  });

  it('prints Claude/Codex steps and skips opencode when filtered', () => {
    const logs = [];
    const result = capture(() =>
      install.main(['--source', fixture, '--host', 'all', '--dry-run'])
    );
    assert.equal(result.result, 0);
    assert.match(result.logs.join('\n'), /marketplace add/);
    assert.match(result.logs.join('\n'), /codex plugin add/);

    const claudeOnly = capture(() =>
      install.main(['--source', fixture, '--host', 'claude', '--dry-run'])
    );
    assert.equal(claudeOnly.result, 0);
    assert.match(claudeOnly.logs.join('\n'), /opencode wiring skipped/);

    logs.length = 0;
    install.printHostSteps({ host: 'claude' }, (m) => logs.push(m));
    assert.match(logs.join('\n'), /marketplace/);
    assert.doesNotMatch(logs.join('\n'), /codex plugin add/);

    logs.length = 0;
    install.printHostSteps({ host: 'codex', uninstall: true }, (m) => logs.push(m));
    assert.equal(logs.length, 0);
  });

  it('runs the full project CLI path and uninstalls it', () => {
    const project = path.join(tmp, 'project-main');
    fs.mkdirSync(project);
    process.chdir(project);

    const first = capture(() =>
      install.main([
        '--source',
        fixture,
        '--host',
        'opencode',
        '--project',
        '--mode',
        'lite',
      ])
    );
    assert.equal(first.result, 0);
    assert.match(first.logs.join('\n'), /done — quit and restart opencode/);
    assert.equal(
      fs.readFileSync(
        path.join(process.env.XDG_CONFIG_HOME, 'opencode', '.aftermath-active'),
        'utf8'
      ),
      'lite'
    );

    const second = capture(() =>
      install.main([
        '--source',
        fixture,
        '--host',
        'opencode',
        '--project',
        '--uninstall',
      ])
    );
    assert.equal(second.result, 0);
    assert.equal(
      fs.existsSync(path.join(project, '.opencode', 'commands', 'one.md')),
      false
    );
  });

  it('rejects malformed config and positional arguments', () => {
    assert.throws(() => install.parseArgs(['extra']), /unexpected argument/);
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, '[]');
    assert.throws(() => install.loadOpencodeJson(bad), /not a JSON object/);
  });

  it('exposes the config base and cache dir under XDG', () => {
    assert.equal(install.configBase(), process.env.XDG_CONFIG_HOME);
    assert.equal(
      install.repoCacheDir(),
      path.join(process.env.XDG_CONFIG_HOME, 'aftermath', 'repo')
    );
  });
});
