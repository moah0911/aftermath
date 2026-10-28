'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const config = require('../hooks/aftermath-config');

let prevEnv;
let tmpXdg;

beforeEach(() => {
  prevEnv = { ...process.env };
  tmpXdg = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-test-'));
  process.env.XDG_CONFIG_HOME = tmpXdg;
  delete process.env.AFTERMATH_DEFAULT_MODE;
});

afterEach(() => {
  process.env = prevEnv;
  fs.rmSync(tmpXdg, { recursive: true, force: true });
});

describe('mode normalization', () => {
  it('accepts lite/full/ultra/off, rejects junk', () => {
    assert.equal(config.normalizeMode('full'), 'full');
    assert.equal(config.normalizeMode(' LITE '), 'lite');
    assert.equal(config.normalizeMode('Ultra'), 'ultra');
    assert.equal(config.normalizeMode('off'), 'off');
    assert.equal(config.normalizeMode('review'), null);
    assert.equal(config.normalizeMode('banana'), null);
    assert.equal(config.normalizeMode(null), null);
  });
});

describe('default mode resolution', () => {
  it('defaults to full', () => {
    assert.equal(config.getDefaultMode(), 'full');
  });
  it('env beats everything', () => {
    process.env.AFTERMATH_DEFAULT_MODE = 'lite';
    assert.equal(config.getDefaultMode(), 'lite');
  });
  it('reads a valid defaultMode from config, case-insensitively', () => {
    writeConfig({ defaultMode: ' Ultra ' });
    assert.equal(config.getDefaultMode(), 'ultra');
  });
  it('tolerates a BOM and invalid JSON', () => {
    writeRawConfig('\uFEFF{"defaultMode":"lite"}');
    assert.equal(config.getDefaultMode(), 'lite');
    writeRawConfig('{not json');
    assert.equal(config.getDefaultMode(), 'full');
  });
  it('falls back when defaultMode is invalid or not a string', () => {
    writeConfig({ defaultMode: 'turbo' });
    assert.equal(config.getDefaultMode(), 'full');
    writeConfig({ defaultMode: 42 });
    assert.equal(config.getDefaultMode(), 'full');
  });
  it('ignores non-object config and invalid env values', () => {
    writeRawConfig('[]');
    assert.equal(config.getDefaultMode(), 'full');
    process.env.AFTERMATH_DEFAULT_MODE = 'turbo';
    assert.equal(config.getDefaultMode(), 'full');
  });
  it('falls back to ~/.config when XDG is unset', () => {
    const prevXdg = process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_CONFIG_HOME;
    try {
      assert.equal(
        config.getConfigDir(),
        path.join(os.homedir(), '.config', 'aftermath')
      );
    } finally {
      process.env.XDG_CONFIG_HOME = prevXdg;
    }
  });
});

describe('autoRevert and destructive allowlist', () => {
  it('autoRevert defaults to false and requires boolean true', () => {
    assert.equal(config.getAutoRevert(), false);
    writeConfig({ autoRevert: 'true' });
    assert.equal(config.getAutoRevert(), false);
    writeConfig({ autoRevert: true });
    assert.equal(config.getAutoRevert(), true);
  });

  it('parses the destructive allowlist and ignores junk', () => {
    assert.deepEqual(config.getDestructiveAllowlist(), []);
    writeConfig({
      destructiveAllowlist: ['  rm -rf ./dist ', 42, '', null, 'git clean -fd'],
    });
    assert.deepEqual(config.getDestructiveAllowlist(), [
      'rm -rf ./dist',
      'git clean -fd',
    ]);
    writeConfig({ destructiveAllowlist: 'rm -rf' });
    assert.deepEqual(config.getDestructiveAllowlist(), []);
  });

  it('matches allowlisted commands case-insensitively', () => {
    writeConfig({ destructiveAllowlist: ['rm -rf ./dist'] });
    assert.equal(config.isDestructiveAllowed('RM -RF ./dist'), true);
    assert.equal(config.isDestructiveAllowed('rm -rf /'), false);
    assert.equal(config.isDestructiveAllowed(''), false);
  });
});

describe('persisted mode', () => {
  it('write then read round-trips', () => {
    assert.equal(config.writeMode('ultra'), 'ultra');
    assert.equal(config.readMode(), 'ultra');
  });
  it('falls back to default when no state file', () => {
    assert.equal(config.readMode(), 'full');
  });
  it('rejects invalid writes', () => {
    assert.equal(config.writeMode('banana'), null);
  });
});

describe('pending state fallback', () => {
  it('ignores an invalid persisted mode', () => {
    fs.mkdirSync(path.dirname(config.getStatePath()), { recursive: true });
    fs.writeFileSync(config.getStatePath(), 'turbo', 'utf8');
    assert.equal(config.readMode(), 'full');
  });
});

describe('correction signals', () => {
  it('hears you-broke-it', () => {
    assert.equal(config.containsCorrectionSignal('you broke the build'), true);
    assert.equal(config.containsCorrectionSignal('that is wrong, revert it'), true);
    assert.equal(config.containsCorrectionSignal('please add a date picker'), false);
  });
  it('ignores bare words that are usually questions', () => {
    assert.equal(config.containsCorrectionSignal("what's wrong with the build?"), false);
    assert.equal(config.containsCorrectionSignal('can you revert later?'), false);
    assert.equal(config.containsCorrectionSignal('stop and think about it'), false);
  });
});

describe('windows config path', () => {
  it('uses APPDATA, then AppData/Roaming, on win32', () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    const prevAppData = process.env.APPDATA;
    const prevXdg = process.env.XDG_CONFIG_HOME;
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      delete process.env.XDG_CONFIG_HOME;
      process.env.APPDATA = path.join('C:', 'Users', 'test', 'AppData', 'Roaming');
      assert.equal(
        config.getConfigDir(),
        path.join(process.env.APPDATA, 'aftermath')
      );
      delete process.env.APPDATA;
      assert.equal(
        config.getConfigDir(),
        path.join(os.homedir(), 'AppData', 'Roaming', 'aftermath')
      );
    } finally {
      Object.defineProperty(process, 'platform', descriptor);
      if (prevAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = prevAppData;
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevXdg;
    }
  });
});

describe('project config', () => {
  it('merges project values over global with the documented union rules', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-project-'));
    try {
      fs.mkdirSync(path.join(dir, '.aftermath'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.aftermath', 'config.json'),
        JSON.stringify({
          defaultMode: 'ultra',
          autoRevert: true,
          testCommands: ['project test', 'shared test'],
          buildCommands: ['project build'],
          safePaths: ['project-artifacts'],
          protectedPaths: ['src'],
          destructiveAllowlist: ['project-allow'],
        })
      );
      writeConfig({
        defaultMode: 'lite',
        autoRevert: false,
        testCommands: ['global test', 'shared test'],
        buildCommands: ['global build'],
        safePaths: ['global-artifacts'],
        protectedPaths: ['.git'],
        destructiveAllowlist: ['global-allow'],
      });
      process.env.AFTERMATH_PROJECT_DIR = dir;

      assert.equal(config.getProjectRoot(), dir);
      assert.equal(
        config.getProjectConfigPath(),
        path.join(dir, '.aftermath', 'config.json')
      );
      assert.equal(config.getDefaultMode(), 'ultra');
      assert.equal(config.getAutoRevert(), true);
      assert.deepEqual(config.getTestCommands(), [
        'global test',
        'shared test',
        'project test',
      ]);
      assert.deepEqual(config.getBuildCommands(), [
        'global build',
        'project build',
      ]);
      assert.deepEqual(config.getSafePaths(), ['project-artifacts']);
      assert.deepEqual(config.getProtectedPaths(), ['.git', 'src']);
      assert.deepEqual(config.getDestructiveAllowlist(), [
        'global-allow',
        'project-allow',
      ]);
      const policy = config.getPolicy();
      assert.equal(policy.projectRoot, dir);
      assert.deepEqual(policy.safePaths, ['project-artifacts']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      delete process.env.AFTERMATH_PROJECT_DIR;
    }
  });

  it('keeps project safePaths even when empty', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-project-'));
    try {
      fs.mkdirSync(path.join(dir, '.aftermath'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.aftermath', 'config.json'),
        JSON.stringify({ safePaths: [] })
      );
      writeConfig({ safePaths: ['global-artifacts'] });
      process.env.AFTERMATH_PROJECT_DIR = dir;
      assert.deepEqual(config.getSafePaths(), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      delete process.env.AFTERMATH_PROJECT_DIR;
    }
  });

  it('walks up to a project containing .aftermath', () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-walk-'));
    const inner = path.join(outer, 'a', 'b');
    const prevCwd = process.cwd();
    try {
      fs.mkdirSync(path.join(outer, '.aftermath'), { recursive: true });
      fs.writeFileSync(path.join(outer, '.aftermath', 'config.json'), '{}');
      fs.mkdirSync(inner, { recursive: true });
      delete process.env.AFTERMATH_PROJECT_DIR;
      process.chdir(inner);
      assert.equal(config.getProjectRoot(), outer);
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(outer, { recursive: true, force: true });
      delete process.env.AFTERMATH_PROJECT_DIR;
    }
  });

  it('returns null for an invalid project override', () => {
    process.env.AFTERMATH_PROJECT_DIR = path.join(
      os.tmpdir(),
      'aftermath-missing-project-dir'
    );
    assert.equal(config.getProjectRoot(), null);
    assert.equal(config.getProjectConfigPath(), null);
  });

  it('env mode still beats a project defaultMode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-project-'));
    try {
      fs.mkdirSync(path.join(dir, '.aftermath'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.aftermath', 'config.json'),
        JSON.stringify({ defaultMode: 'ultra' })
      );
      process.env.AFTERMATH_PROJECT_DIR = dir;
      process.env.AFTERMATH_DEFAULT_MODE = 'full';
      assert.equal(config.getDefaultMode(), 'full');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      delete process.env.AFTERMATH_PROJECT_DIR;
    }
  });
});

function writeConfig(value) {
  writeRawConfig(JSON.stringify(value));
}

function writeRawConfig(text) {
  const dir = path.dirname(config.getConfigPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(config.getConfigPath(), text, 'utf8');
}
