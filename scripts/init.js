#!/usr/bin/env node
// aftermath init — initialize a project for destructive-safe recovery.
//
// Detects stacks, test/build commands, disposable artifacts, and protected paths,
// writes .aftermath/config.json, wires the host, and optionally records a baseline.
// Writes only config/wiring/baseline; never runs destructive commands.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const CONFIG_VERSION = 1;

const ARTIFACT_NAMES = [
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  'target',
  '.turbo',
  '.cache',
  '__pycache__',
  '.pytest_cache',
  '.venv',
  'venv',
];

const SOURCE_DIRS = ['src', 'app', 'lib', 'packages', 'services', 'tests', 'test', 'spec'];

const MANIFESTS = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'Gemfile',
  'Gemfile.lock',
  'composer.json',
  'composer.lock',
  'pom.xml',
  'build.gradle',
  'settings.gradle',
  'Makefile',
];

const ALWAYS_PROTECTED = ['.git', '.env*', 'secrets*', '*.pem', '*.key'];

function usage() {
  return [
    'Usage: aftermath init [options]',
    '',
    '  --dir <path>      project directory (default: cwd)',
    '  --dry-run         print actions, write nothing',
    '  --no-wire         write config without installing host wiring',
    '  --host <h>        opencode|claude|codex|all (default: all)',
    '  --run-tests       run the detected test command once and record a baseline',
    '  --force           replace generated arrays instead of preserving existing ones',
    '  --json            machine-readable output',
    '  -h, --help        this text',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = {
    dir: null,
    dryRun: false,
    noWire: false,
    host: 'all',
    runTests: false,
    force: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir' || arg === '--host') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} needs a value`);
      }
      opts[arg.slice(2)] = value;
    } else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-wire') opts.noWire = true;
    else if (arg === '--run-tests') opts.runTests = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg.startsWith('--')) throw new Error(`unknown flag: ${arg}`);
    else throw new Error(`unexpected argument: ${arg}`);
  }
  const hosts = ['opencode', 'claude', 'codex', 'all'];
  if (!hosts.includes(opts.host)) {
    throw new Error(`--host must be one of: ${hosts.join('|')}`);
  }
  return opts;
}

function exists(dir, name) {
  try {
    return fs.existsSync(path.join(dir, name));
  } catch (_) {
    return false;
  }
}

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_) {
    return {};
  }
}

function findProjectRoot(start) {
  const startDir = path.resolve(start || process.cwd());
  let dir = startDir;
  while (true) {
    if (
      fs.existsSync(path.join(dir, '.git')) ||
      fs.existsSync(path.join(dir, '.aftermath'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

function dedupe(items) {
  const out = [];
  for (const item of items) {
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

function detectPackageManager(dir) {
  if (exists(dir, 'pnpm-lock.yaml')) return 'pnpm';
  if (exists(dir, 'yarn.lock')) return 'yarn';
  if (exists(dir, 'bun.lockb') || exists(dir, 'bun.lock')) return 'bun';
  return 'npm';
}

function testCommandFor(pm) {
  if (pm === 'yarn') return 'yarn test';
  if (pm === 'pnpm') return 'pnpm test';
  if (pm === 'bun') return 'bun test';
  return 'npm test';
}

function buildCommandFor(pm) {
  if (pm === 'yarn') return 'yarn build';
  if (pm === 'pnpm') return 'pnpm build';
  if (pm === 'bun') return 'bun run build';
  return 'npm run build';
}

function detectProject(dir) {
  const stacks = [];
  const testCommands = [];
  const buildCommands = [];
  let packageManager = null;

  if (exists(dir, 'package.json')) {
    stacks.push('node');
    packageManager = detectPackageManager(dir);
    const pkg = readJson(path.join(dir, 'package.json'));
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    if (typeof scripts.test === 'string' && scripts.test.trim()) {
      testCommands.push(testCommandFor(packageManager));
    }
    if (typeof scripts.build === 'string' && scripts.build.trim()) {
      buildCommands.push(buildCommandFor(packageManager));
    }
  }

  const python =
    exists(dir, 'pyproject.toml') ||
    exists(dir, 'requirements.txt') ||
    exists(dir, 'pytest.ini') ||
    exists(dir, 'tox.ini') ||
    exists(dir, 'setup.py');
  if (python) {
    stacks.push('python');
    if (exists(dir, 'noxfile.py')) testCommands.push('nox');
    else if (exists(dir, 'tox.ini')) testCommands.push('tox');
    else testCommands.push('python -m pytest');
    if (exists(dir, 'pyproject.toml')) buildCommands.push('python -m build');
  }

  if (exists(dir, 'Cargo.toml')) {
    stacks.push('rust');
    testCommands.push('cargo test');
    buildCommands.push('cargo build');
  }

  if (exists(dir, 'go.mod')) {
    stacks.push('go');
    testCommands.push('go test ./...');
    buildCommands.push('go build ./...');
  }

  if (exists(dir, 'Gemfile')) {
    stacks.push('ruby');
    if (exists(dir, 'bin/rails')) testCommands.push('bin/rails test');
    else if (exists(dir, 'spec')) testCommands.push('bundle exec rspec');
    else testCommands.push('bundle exec rake test');
  }

  if (exists(dir, 'composer.json')) {
    stacks.push('php');
    testCommands.push(
      exists(dir, 'artisan') ? 'php artisan test' : 'vendor/bin/phpunit'
    );
  }

  if (exists(dir, 'pom.xml')) {
    stacks.push('java');
    testCommands.push('mvn test');
    buildCommands.push('mvn package');
  }
  if (exists(dir, 'gradlew') || exists(dir, 'build.gradle')) {
    stacks.push('java');
    const wrapper = exists(dir, 'gradlew');
    testCommands.push(wrapper ? './gradlew test' : 'gradle test');
    buildCommands.push(wrapper ? './gradlew build' : 'gradle build');
  }

  if (exists(dir, 'Makefile')) {
    try {
      const makefile = fs.readFileSync(path.join(dir, 'Makefile'), 'utf8');
      if (/^test\s*:/m.test(makefile)) {
        stacks.push('make');
        testCommands.push('make test');
      }
    } catch (_) {
      // unreadable Makefile — skip
    }
  }

  return {
    root: dir,
    stacks: dedupe(stacks),
    packageManager,
    testCommands: dedupe(testCommands),
    buildCommands: dedupe(buildCommands),
  };
}

function readGitignore(dir) {
  const ignored = new Set();
  const negated = new Set();
  try {
    const lines = fs
      .readFileSync(path.join(dir, '.gitignore'), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    for (const line of lines) {
      const target = line.startsWith('!') ? negated : ignored;
      const normalized = line
        .replace(/^!/, '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
        .replace(/\/\*\*?$/, '');
      if (normalized) target.add(normalized);
    }
  } catch (_) {
    // no .gitignore — no artifacts are considered safe
  }
  return { ignored, negated };
}

function detectArtifacts(dir) {
  const { ignored, negated } = readGitignore(dir);
  const artifacts = [];
  for (const name of ARTIFACT_NAMES) {
    if (!ignored.has(name)) continue;
    // A negated child means the directory contains tracked files.
    if (
      negated.has(name) ||
      [...negated].some((entry) => entry.startsWith(name + '/'))
    ) {
      continue;
    }
    try {
      if (!fs.statSync(path.join(dir, name)).isDirectory()) continue;
    } catch (_) {
      continue;
    }
    artifacts.push(name);
  }
  return artifacts;
}

function detectProtected(dir) {
  const protectedPaths = [...ALWAYS_PROTECTED];
  for (const name of [...SOURCE_DIRS, ...MANIFESTS]) {
    if (exists(dir, name)) protectedPaths.push(name);
  }
  return dedupe(protectedPaths);
}

function buildConfig(project, artifacts) {
  return {
    version: CONFIG_VERSION,
    defaultMode: 'full',
    autoRevert: false,
    stacks: project.stacks,
    packageManager: project.packageManager,
    testCommands: project.testCommands,
    buildCommands: project.buildCommands,
    safePaths: artifacts,
    protectedPaths: detectProtected(project.root),
    destructiveAllowlist: [],
  };
}

function mergeConfig(existing, generated, options = {}) {
  const force = options.force === true;
  const merged = { ...existing };
  if (typeof merged.version !== 'number') merged.version = generated.version;
  if (typeof merged.defaultMode !== 'string') {
    merged.defaultMode = generated.defaultMode;
  }
  if (typeof merged.autoRevert !== 'boolean') {
    merged.autoRevert = generated.autoRevert;
  }
  if (typeof merged.packageManager !== 'string') {
    merged.packageManager = generated.packageManager;
  }
  for (const key of ['stacks', 'testCommands', 'buildCommands', 'safePaths']) {
    if (force || !Array.isArray(merged[key])) merged[key] = generated[key];
  }
  if (force || !Array.isArray(merged.protectedPaths)) {
    merged.protectedPaths = generated.protectedPaths;
  } else {
    merged.protectedPaths = dedupe([
      ...merged.protectedPaths,
      ...generated.protectedPaths,
    ]);
  }
  if (!Array.isArray(merged.destructiveAllowlist)) {
    merged.destructiveAllowlist = [];
  }
  return merged;
}

function readConfigFile(dir) {
  return readJson(path.join(dir, '.aftermath', 'config.json'));
}

function writeConfig(dir, config) {
  const configDir = path.join(dir, '.aftermath');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify(config, null, 2) + '\n'
  );
}

function getGitHead(dir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  } catch (_) {
    return null;
  }
}

function runBaseline(dir, command, options = {}) {
  const childEnv = { ...process.env };
  delete childEnv.NODE_V8_COVERAGE;
  const result = spawnSync(command, {
    cwd: dir,
    shell: true,
    encoding: 'utf8',
    timeout: options.timeout || 300000,
    env: childEnv,
  });
  const baseline = {
    command,
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: typeof result.status === 'number' ? result.status : null,
    commit: getGitHead(dir),
    ranAt: new Date().toISOString(),
  };
  const baselineDir = path.join(dir, '.aftermath');
  fs.mkdirSync(baselineDir, { recursive: true });
  fs.writeFileSync(
    path.join(baselineDir, 'baseline.json'),
    JSON.stringify(baseline, null, 2) + '\n'
  );
  return baseline;
}

function wireProject(root, host, log) {
  const install = require('./install');
  const prevCwd = process.cwd();
  process.chdir(root);
  try {
    if (host === 'all' || host === 'opencode') {
      install.wireOpencode(
        { project: true, dryRun: false, uninstall: false },
        REPO_ROOT,
        log
      );
    }
    install.printHostSteps({ host }, log);
  } finally {
    process.chdir(prevCwd);
  }
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(usage());
    return 0;
  }

  const start = opts.dir ? path.resolve(opts.dir) : process.cwd();
  let startStat;
  try {
    startStat = fs.statSync(start);
  } catch (_) {
    throw new Error(`--dir does not exist: ${start}`);
  }
  if (!startStat.isDirectory()) {
    throw new Error(`--dir is not a directory: ${start}`);
  }

  const root = findProjectRoot(start);
  const project = detectProject(root);
  const artifacts = detectArtifacts(root);
  const generated = buildConfig(project, artifacts);
  const existing = readConfigFile(root);
  const config = mergeConfig(existing, generated, { force: opts.force });
  const actions = [];

  if (opts.dryRun) {
    actions.push('would write .aftermath/config.json');
  } else {
    writeConfig(root, config);
    actions.push('wrote .aftermath/config.json');
  }

  if (opts.noWire) {
    actions.push('host wiring skipped');
  } else if (opts.dryRun) {
    actions.push('would wire hosts: ' + opts.host);
  } else {
    const installLogs = [];
    wireProject(root, opts.host, (message) => installLogs.push(message));
    actions.push(...installLogs);
  }

  let baseline = null;
  if (opts.runTests) {
    if (!project.testCommands.length) {
      actions.push('no test command detected; baseline skipped');
    } else if (opts.dryRun) {
      actions.push('would run baseline: ' + project.testCommands[0]);
    } else {
      baseline = runBaseline(root, project.testCommands[0]);
      actions.push('baseline: ' + baseline.status);
    }
  }

  const result = { root, config, actions, baseline };
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  console.log('aftermath init — ' + root);
  console.log('stacks: ' + (project.stacks.join(', ') || 'none detected'));
  console.log('test: ' + (config.testCommands.join(' · ') || 'none detected'));
  console.log('build: ' + (config.buildCommands.join(' · ') || 'none detected'));
  console.log('safe paths: ' + (config.safePaths.join(', ') || 'none'));
  console.log('protected: ' + (config.protectedPaths.join(', ') || 'none'));
  for (const action of actions) console.log('· ' + action);
  console.log('next: run the detected test command once, then /aftermath-status');
  return 0;
}

function cli(argv) {
  try {
    return main(argv);
  } catch (error) {
    console.error(
      'aftermath init failed: ' +
        (error && error.message ? error.message : error)
    );
    return 1;
  }
}

if (require.main === module) {
  process.exit(cli(process.argv.slice(2)));
}

module.exports = {
  CONFIG_VERSION,
  ARTIFACT_NAMES,
  parseArgs,
  findProjectRoot,
  detectPackageManager,
  detectProject,
  detectArtifacts,
  detectProtected,
  buildConfig,
  mergeConfig,
  readConfigFile,
  writeConfig,
  runBaseline,
  main,
  cli,
  usage,
};
