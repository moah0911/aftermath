'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isDestructiveCommand,
  isTestCommand,
  indicatesTestFailure,
  fingerprintError,
  isRepeatError,
} = require('../hooks/aftermath-signals.cjs');

describe('destructive-command detector', () => {
  it('flags force push, drop, rm -rf', () => {
    assert.equal(isDestructiveCommand('git push --force origin main'), true);
    assert.equal(isDestructiveCommand('git push -f origin main'), true);
    assert.equal(isDestructiveCommand('DROP TABLE users;'), true);
    assert.equal(isDestructiveCommand('rm -rf /tmp/build'), true);
    assert.equal(isDestructiveCommand('rm -r ./dist'), true);
    assert.equal(isDestructiveCommand('terraform destroy -auto-approve'), true);
  });
  it('does not flag safe reads', () => {
    assert.equal(isDestructiveCommand('git status --short'), false);
    assert.equal(isDestructiveCommand('git diff --stat'), false);
    assert.equal(isDestructiveCommand('npm test'), false);
    assert.equal(isDestructiveCommand('ls -la'), false);
  });
});

describe('test-command detector', () => {
  it('recognizes common runners', () => {
    assert.equal(isTestCommand('pytest tests/ -q'), true);
    assert.equal(isTestCommand('npm test'), true);
    assert.equal(isTestCommand('npx jest auth.spec'), true);
    assert.equal(isTestCommand('go test ./...'), true);
  });
  it('ignores non-test commands', () => {
    assert.equal(isTestCommand('npm run build'), false);
    assert.equal(isTestCommand('git push origin main'), false);
  });
});

describe('test-failure detector', () => {
  it('spots failure markers', () => {
    assert.equal(indicatesTestFailure('FAILED tests/test_auth.py::test_login'), true);
    assert.equal(indicatesTestFailure('Traceback (most recent call last): ...'), true);
    assert.equal(indicatesTestFailure('Tests: 3 failed, 12 passed'), true);
  });
  it('passes clean output', () => {
    assert.equal(indicatesTestFailure('12 passed in 0.42s'), false);
    assert.equal(indicatesTestFailure('ok'), false);
  });
});

describe('repeat-error fingerprint', () => {
  it('matches identical errors, rejects different ones', () => {
    const a = fingerprintError('AssertionError: expected 200 got 500\n  at auth.js:42');
    const b = fingerprintError('AssertionError: expected 200 got 500\n  at auth.js:42');
    const c = fingerprintError('TypeError: cannot read property of undefined');
    assert.equal(isRepeatError(a, b), true);
    assert.equal(isRepeatError(a, c), false);
    assert.equal(isRepeatError(null, b), false);
    assert.equal(isRepeatError('', ''), false);
  });
});
