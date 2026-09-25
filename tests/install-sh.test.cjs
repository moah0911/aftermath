'use strict';
// Smoke tests for the bash bootstrapper. Shells out to bash; asserts
// fail-fast ordering (no network before flag validation) and delegation.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const sh = path.join(__dirname, '..', 'scripts', 'install.sh');

function run(args, opts = {}) {
  try {
    const out = execFileSync('bash', [sh, ...args], {
      encoding: 'utf8',
      timeout: 30000,
      ...opts,
    });
    return { code: 0, out: String(out) };
  } catch (e) {
    return {
      code: e.status,
      out: String(e.stdout || '') + String(e.stderr || ''),
    };
  }
}

describe('install.sh bootstrapper', () => {
  it('--help exits 0 with usage and no network', () => {
    const r = run(['--help']);
    assert.equal(r.code, 0);
    assert.match(r.out, /Usage: install\.sh/);
    assert.doesNotMatch(r.out, /cloning https|updating cached clone/);
  });

  it('unknown flags fail before any clone', () => {
    const r = run(['--frobnicate']);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /unknown flag/);
    assert.doesNotMatch(r.out, /cloning https|updating cached clone/);
  });

  it('missing --ref value fails fast', () => {
    const r = run(['--ref']);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /needs a value/);
  });

  it('delegates --source dry-run to the node installer', () => {
    const root = path.join(__dirname, '..');
    const r = run(['--source', root, '--host', 'opencode', '--dry-run']);
    assert.equal(r.code, 0);
    assert.match(r.out, /using local source/);
    assert.match(r.out, /\[dry-run\] add plugin|plugin entry already present/);
  });
});
