'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const init = require('../scripts/init');

let tmp;
let prevEnv;
let prevCwd;

beforeEach(() => {
  prevEnv = { ...process.env };
  prevCwd = process.cwd();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-init-'));
  process.env.XDG_CONFIG_HOME = path.join(tmp, 'xdg');
  delete process.env.AFTERMATH_PROJECT_DIR;
  delete process.env.AFTERMATH_DEFAULT_MODE;
});

afterEach(() => {
  process.chdir(prevCwd);
  process.env = prevEnv;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function project(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function write(dir, name, content) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
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

function nodeProject() {
  const dir = project('node-app');
  write(
    dir,
    'package.json',
    JSON.stringify({ scripts: { test: 'vitest run', build: 'tsc' } })
  );
  write(dir, 'package-lock.json', '{}');
  write(dir, '.gitignore', 'node_modules/\ndist/\ncoverage/\n');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.mkdirSync(path.join(dir, 'coverage'));
  fs.mkdirSync(path.join(dir, 'src'));
  return dir;
}

describe('project detection', () => {
  it('detects node, commands, artifacts, and protected paths', () => {
    const dir = nodeProject();
    const projectInfo = init.detectProject(dir);
    assert.deepEqual(projectInfo.stacks, ['node']);
    assert.equal(projectInfo.packageManager, 'npm');
    assert.deepEqual(projectInfo.testCommands, ['npm test']);
    assert.deepEqual(projectInfo.buildCommands, ['npm run build']);
    assert.deepEqual(init.detectArtifacts(dir), [
      'node_modules',
      'dist',
      'coverage',
    ]);

    const config = init.buildConfig(projectInfo, init.detectArtifacts(dir));
    assert.deepEqual(config.safePaths, ['node_modules', 'dist', 'coverage']);
    for (const entry of ['.git', '.env*', 'src', 'package.json']) {
      assert.ok(config.protectedPaths.includes(entry), `missing ${entry}`);
    }
    assert.equal(config.autoRevert, false);
    assert.equal(config.defaultMode, 'full');
  });

  it('detects package managers', () => {
    const pnpm = project('pnpm-app');
    write(pnpm, 'package.json', JSON.stringify({ scripts: { test: 'x' } }));
    write(pnpm, 'pnpm-lock.yaml', '');
    assert.equal(init.detectPackageManager(pnpm), 'pnpm');
    assert.deepEqual(init.detectProject(pnpm).testCommands, ['pnpm test']);

    const yarn = project('yarn-app');
    write(yarn, 'package.json', JSON.stringify({ scripts: { build: 'x' } }));
    write(yarn, 'yarn.lock', '');
    assert.equal(init.detectPackageManager(yarn), 'yarn');
    assert.deepEqual(init.detectProject(yarn).buildCommands, ['yarn build']);
  });

  it('detects python projects', () => {
    const dir = project('python-app');
    write(dir, 'pyproject.toml', '[project]\nname = "x"\n');
    write(dir, 'pytest.ini', '[pytest]\n');
    write(dir, '.gitignore', '__pycache__/\n');
    fs.mkdirSync(path.join(dir, '__pycache__'));
    fs.mkdirSync(path.join(dir, 'tests'));
    const info = init.detectProject(dir);
    assert.deepEqual(info.stacks, ['python']);
    assert.deepEqual(info.testCommands, ['python -m pytest']);
    assert.deepEqual(info.buildCommands, ['python -m build']);
    assert.deepEqual(init.detectArtifacts(dir), ['__pycache__']);
  });

  it('prefers nox/tox when configured', () => {
    const dir = project('py-nox');
    write(dir, 'pyproject.toml', '');
    write(dir, 'noxfile.py', '');
    assert.deepEqual(init.detectProject(dir).testCommands, ['nox']);

    const tox = project('py-tox');
    write(tox, 'pyproject.toml', '');
    write(tox, 'tox.ini', '');
    assert.deepEqual(init.detectProject(tox).testCommands, ['tox']);
  });

  it('detects rust and go projects', () => {
    const rust = project('rust-app');
    write(rust, 'Cargo.toml', '[package]\nname = "x"\n');
    assert.deepEqual(init.detectProject(rust), {
      root: rust,
      stacks: ['rust'],
      packageManager: null,
      testCommands: ['cargo test'],
      buildCommands: ['cargo build'],
    });

    const go = project('go-app');
    write(go, 'go.mod', 'module x\n');
    assert.deepEqual(init.detectProject(go).testCommands, ['go test ./...']);
  });

  it('detects ruby, php, java, and make projects', () => {
    const ruby = project('ruby-app');
    write(ruby, 'Gemfile', '');
    write(ruby, 'bin/rails', '');
    assert.deepEqual(init.detectProject(ruby).testCommands, ['bin/rails test']);

    const rspec = project('rspec-app');
    write(rspec, 'Gemfile', '');
    fs.mkdirSync(path.join(rspec, 'spec'));
    assert.deepEqual(init.detectProject(rspec).testCommands, [
      'bundle exec rspec',
    ]);

    const php = project('php-app');
    write(php, 'composer.json', '{}');
    write(php, 'artisan', '');
    assert.deepEqual(init.detectProject(php).testCommands, ['php artisan test']);

    const java = project('java-app');
    write(java, 'pom.xml', '<project/>');
    assert.deepEqual(init.detectProject(java).testCommands, ['mvn test']);
    assert.deepEqual(init.detectProject(java).buildCommands, ['mvn package']);

    const gradle = project('gradle-app');
    write(gradle, 'build.gradle', '');
    assert.deepEqual(init.detectProject(gradle).testCommands, ['gradle test']);

    const make = project('make-app');
    write(make, 'Makefile', 'test:\n\tnode --test\n');
    const info = init.detectProject(make);
    assert.ok(info.stacks.includes('make'));
    assert.ok(info.testCommands.includes('make test'));
  });

  it('returns empty detection for an unknown project', () => {
    const dir = project('empty-app');
    const info = init.detectProject(dir);
    assert.deepEqual(info.stacks, []);
    assert.deepEqual(info.testCommands, []);
    assert.deepEqual(info.buildCommands, []);
  });

  it('never treats arbitrary ignored paths as artifacts', () => {
    const dir = project('secret-app');
    write(dir, '.gitignore', 'secrets/\nnode_modules/\n');
    fs.mkdirSync(path.join(dir, 'secrets'));
    fs.mkdirSync(path.join(dir, 'node_modules'));
    assert.deepEqual(init.detectArtifacts(dir), ['node_modules']);
    assert.ok(init.detectProtected(dir).includes('secrets*'));
  });

  it('ignores artifact dirs that are present but not ignored', () => {
    const dir = project('untracked-app');
    fs.mkdirSync(path.join(dir, 'dist'));
    write(dir, '.gitignore', 'node_modules/\n');
    assert.deepEqual(init.detectArtifacts(dir), []);
  });

  it('does not mark artifacts with negated tracked children as safe', () => {
    const dir = project('negated-app');
    fs.mkdirSync(path.join(dir, 'dist'));
    write(dir, '.gitignore', 'dist/\n!dist/keep.txt\n');
    assert.deepEqual(init.detectArtifacts(dir), []);
  });
});

describe('project root and config merge', () => {
  it('walks up to a .git root and falls back to the start dir', () => {
    const root = project('walk-app');
    fs.mkdirSync(path.join(root, '.git'));
    fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
    assert.equal(init.findProjectRoot(path.join(root, 'a', 'b')), root);
    assert.equal(init.findProjectRoot(path.join(tmp, 'no-marker')), path.join(tmp, 'no-marker'));
  });

  it('preserves user values and unions protected paths', () => {
    const existing = {
      testCommands: ['custom test'],
      safePaths: ['custom-safe'],
      protectedPaths: ['custom-protected'],
      destructiveAllowlist: ['allow-me'],
      autoRevert: true,
      unknown: 'keep',
    };
    const generated = {
      version: 1,
      defaultMode: 'full',
      autoRevert: false,
      packageManager: 'npm',
      stacks: ['node'],
      testCommands: ['npm test'],
      buildCommands: ['npm run build'],
      safePaths: ['dist'],
      protectedPaths: ['.git', 'src'],
      destructiveAllowlist: [],
    };
    const merged = init.mergeConfig(existing, generated);
    assert.deepEqual(merged.testCommands, ['custom test']);
    assert.deepEqual(merged.safePaths, ['custom-safe']);
    assert.deepEqual(merged.protectedPaths, [
      'custom-protected',
      '.git',
      'src',
    ]);
    assert.deepEqual(merged.destructiveAllowlist, ['allow-me']);
    assert.equal(merged.autoRevert, true);
    assert.equal(merged.unknown, 'keep');

    const forced = init.mergeConfig(existing, generated, { force: true });
    assert.deepEqual(forced.testCommands, ['npm test']);
    assert.deepEqual(forced.safePaths, ['dist']);
    assert.deepEqual(forced.protectedPaths, ['.git', 'src']);
    assert.deepEqual(forced.destructiveAllowlist, ['allow-me']);
    assert.equal(forced.autoRevert, true);
  });
});

describe('init CLI', () => {
  it('dry-run writes nothing and emits JSON', () => {
    const dir = nodeProject();
    const { result, logs } = capture(() =>
      init.main(['--dir', dir, '--dry-run', '--no-wire', '--json'])
    );
    assert.equal(result, 0);
    const payload = JSON.parse(logs.join('\n'));
    assert.equal(payload.root, dir);
    assert.deepEqual(payload.config.testCommands, ['npm test']);
    assert.ok(payload.actions.includes('would write .aftermath/config.json'));
    assert.equal(fs.existsSync(path.join(dir, '.aftermath')), false);
  });

  it('writes config and skips wiring with --no-wire', () => {
    const dir = nodeProject();
    const { result } = capture(() =>
      init.main(['--dir', dir, '--no-wire'])
    );
    assert.equal(result, 0);
    const config = JSON.parse(
      fs.readFileSync(path.join(dir, '.aftermath', 'config.json'), 'utf8')
    );
    assert.deepEqual(config.testCommands, ['npm test']);
    assert.equal(fs.existsSync(path.join(dir, 'opencode.json')), false);
  });

  it('wires OpenCode in the project', () => {
    const dir = nodeProject();
    const { result, logs } = capture(() =>
      init.main(['--dir', dir, '--host', 'opencode'])
    );
    assert.equal(result, 0);
    const opencode = JSON.parse(
      fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8')
    );
    assert.ok(opencode.plugin[0].endsWith('aftermath.mjs'));
    assert.ok(
      fs.lstatSync(path.join(dir, '.opencode', 'commands', 'aftermath.md')).isSymbolicLink()
    );
    assert.match(logs.join('\n'), /wrote .*config/);
  });

  it('is idempotent, preserves commands, and honors --force', () => {
    const dir = nodeProject();
    fs.mkdirSync(path.join(dir, '.aftermath'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.aftermath', 'config.json'),
      JSON.stringify({ testCommands: ['custom'], safePaths: ['custom-safe'] })
    );
    capture(() => init.main(['--dir', dir, '--no-wire']));
    let config = JSON.parse(
      fs.readFileSync(path.join(dir, '.aftermath', 'config.json'), 'utf8')
    );
    assert.deepEqual(config.testCommands, ['custom']);
    assert.deepEqual(config.safePaths, ['custom-safe']);

    capture(() => init.main(['--dir', dir, '--no-wire', '--force']));
    config = JSON.parse(
      fs.readFileSync(path.join(dir, '.aftermath', 'config.json'), 'utf8')
    );
    assert.deepEqual(config.testCommands, ['npm test']);
    assert.deepEqual(config.safePaths, ['node_modules', 'dist', 'coverage']);
  });

  it('records a passing baseline with --run-tests', () => {
    const dir = project('baseline-app');
    write(
      dir,
      'package.json',
      JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } })
    );
    const { result } = capture(() =>
      init.main(['--dir', dir, '--no-wire', '--run-tests', '--json'])
    );
    assert.equal(result, 0);
    const baseline = JSON.parse(
      fs.readFileSync(path.join(dir, '.aftermath', 'baseline.json'), 'utf8')
    );
    assert.equal(baseline.status, 'passed');
    assert.equal(baseline.command, 'npm test');
  });

  it('records a failing baseline without failing init', () => {
    const dir = project('baseline-fail');
    const baseline = init.runBaseline(dir, 'node -e "process.exit(1)"');
    assert.equal(baseline.status, 'failed');
    assert.equal(baseline.exitCode, 1);
    assert.ok(
      fs.existsSync(path.join(dir, '.aftermath', 'baseline.json'))
    );
  });

  it('does not run tests during a dry-run', () => {
    const dir = project('baseline-dry');
    write(
      dir,
      'package.json',
      JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } })
    );
    const { logs } = capture(() =>
      init.main(['--dir', dir, '--dry-run', '--no-wire', '--run-tests', '--json'])
    );
    const payload = JSON.parse(logs.join('\n'));
    assert.equal(payload.baseline, null);
    assert.ok(
      payload.actions.includes('would run baseline: npm test')
    );
    assert.equal(fs.existsSync(path.join(dir, '.aftermath')), false);
  });

  it('reports no test command when none is detected', () => {
    const dir = project('no-tests');
    const { result, logs } = capture(() =>
      init.main(['--dir', dir, '--no-wire', '--run-tests', '--json'])
    );
    assert.equal(result, 0);
    const payload = JSON.parse(logs.join('\n'));
    assert.equal(payload.baseline, null);
    assert.ok(
      payload.actions.includes(
        'no test command detected; baseline skipped'
      )
    );
  });

  it('prints a human summary', () => {
    const dir = nodeProject();
    const { logs } = capture(() => init.main(['--dir', dir, '--no-wire']));
    assert.match(logs.join('\n'), /aftermath init/);
    assert.match(logs.join('\n'), /stacks: node/);
    assert.match(logs.join('\n'), /safe paths: node_modules/);
  });

  it('rejects bad flags and routes cli errors', () => {
    assert.throws(() => init.parseArgs(['--dir']), /needs a value/);
    assert.throws(() => init.parseArgs(['--host', 'vim']), /--host must be/);
    assert.throws(() => init.parseArgs(['--nope']), /unknown flag/);
    assert.throws(() => init.parseArgs(['extra']), /unexpected argument/);
    const { result, errors } = capture(() => init.cli(['--nope']));
    assert.equal(result, 1);
    assert.match(errors.join('\n'), /unknown flag/);

    const missing = capture(() =>
      init.cli(['--dir', path.join(tmp, 'missing-dir'), '--no-wire'])
    );
    assert.equal(missing.result, 1);
    assert.match(missing.errors.join('\n'), /does not exist/);

    const file = path.join(tmp, 'file.txt');
    fs.writeFileSync(file, 'x');
    const notDir = capture(() => init.cli(['--dir', file, '--no-wire']));
    assert.equal(notDir.result, 1);
    assert.match(notDir.errors.join('\n'), /not a directory/);
  });

  it('prints help', () => {
    const { result, logs } = capture(() => init.main(['--help']));
    assert.equal(result, 0);
    assert.match(logs.join('\n'), /Usage: aftermath init/);
  });
});
