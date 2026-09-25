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

describe('correction signals', () => {
  it('hears you-broke-it', () => {
    assert.equal(config.containsCorrectionSignal('you broke the build'), true);
    assert.equal(config.containsCorrectionSignal('that is wrong, revert it'), true);
    assert.equal(config.containsCorrectionSignal('please add a date picker'), false);
  });
});
