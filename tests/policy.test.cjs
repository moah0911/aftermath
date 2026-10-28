'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  evaluateDestructiveCommand,
  tokenize,
  matchesProtected,
} = require('../hooks/aftermath-destructive-policy.cjs');

let tmp;
let root;
let policy;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-policy-'));
  root = path.join(tmp, 'project');
  fs.mkdirSync(path.join(root, 'node_modules', '.cache'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
  policy = {
    projectRoot: root,
    safePaths: ['node_modules', 'dist'],
    protectedPaths: ['.git', 'src', '.env*'],
    destructiveAllowlist: [],
  };
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function evaluate(cmd, overrides = {}) {
  return evaluateDestructiveCommand(cmd, { ...policy, ...overrides });
}

describe('destructive policy', () => {
  it('allows deleting configured artifacts', () => {
    for (const cmd of [
      'rm -rf node_modules',
      'rm -rf ./dist',
      'rm -rf "node_modules"',
      'rm -rf node_modules/.cache',
      'rm -rf node_modules dist',
      'find node_modules -name "*.js" -delete',
    ]) {
      const result = evaluate(cmd);
      assert.equal(result.decision, 'allow', `${cmd}: ${result.reason}`);
      assert.equal(result.reason, 'safe-artifact', cmd);
    }
  });

  it('blocks protected and unknown targets', () => {
    const cases = {
      'rm -rf src': 'protected-path',
      'rm -rf node_modules src': 'protected-path',
      'rm -rf .env': 'protected-path',
      'rm -rf .git': 'protected-path',
      'rm -rf unknown': 'unknown-target',
      'find src -delete': 'protected-path',
    };
    for (const [cmd, reason] of Object.entries(cases)) {
      const result = evaluate(cmd);
      assert.equal(result.decision, 'block', cmd);
      assert.equal(result.reason, reason, cmd);
    }
  });

  it('blocks traversal, absolute, dynamic, and complex targets', () => {
    const cases = {
      'rm -rf ../outside': 'outside-project',
      'rm -rf /tmp/outside': 'outside-project',
      'rm -rf $HOME': 'dynamic-target',
      'rm -rf node_modules/*': 'dynamic-target',
      'rm -rf `pwd`': 'complex-shell',
      'rm -rf node_modules && rm -rf src': 'complex-shell',
      'rm -rf node_modules | cat': 'complex-shell',
    };
    for (const [cmd, reason] of Object.entries(cases)) {
      const result = evaluate(cmd);
      assert.equal(result.decision, 'block', cmd);
      assert.equal(result.reason, reason, cmd);
    }
  });

  it('blocks non-path destructive commands', () => {
    for (const cmd of [
      'git reset --hard HEAD~1',
      'git clean -fd',
      'git push --force origin main',
      'DROP TABLE users',
      'terraform apply',
    ]) {
      const result = evaluate(cmd);
      assert.equal(result.decision, 'block', cmd);
      assert.equal(result.reason, 'non-path-destructive', cmd);
    }
  });

  it('honors the explicit allowlist', () => {
    const result = evaluate('git reset --hard HEAD~1', {
      destructiveAllowlist: ['git reset --hard'],
    });
    assert.equal(result.decision, 'allow');
    assert.equal(result.reason, 'explicit-allowlist');
  });

  it('allows non-destructive commands without a project', () => {
    assert.equal(evaluate('git status', { projectRoot: null }).decision, 'allow');
    assert.equal(
      evaluate('rm -rf node_modules', { projectRoot: null }).reason,
      'no-project'
    );
  });

  it('blocks symlinks that resolve outside the project', (t) => {
    if (process.platform === 'win32') return t.skip('symlink semantics');
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside);
    fs.rmSync(path.join(root, 'node_modules'), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(root, 'node_modules'));
    const result = evaluate('rm -rf node_modules');
    assert.equal(result.decision, 'block');
    assert.equal(result.reason, 'outside-project');
  });

  it('protected patterns win over overlapping safe paths', () => {
    const result = evaluate('rm -rf src', {
      safePaths: ['.'],
      protectedPaths: ['src'],
    });
    assert.equal(result.decision, 'block');
    assert.equal(result.reason, 'protected-path');
  });

  it('rejects empty and flag-only targets', () => {
    assert.equal(evaluate('rm -rf').reason, 'unknown-target');
    assert.equal(evaluate('rm -rf --').reason, 'unknown-target');
  });

  it('tokenizes quotes and reports unterminated input', () => {
    assert.deepEqual(tokenize('rm -rf "my dir"'), ['rm', '-rf', 'my dir']);
    assert.equal(tokenize('rm -rf "oops'), null);
  });

  it('matches protected patterns by path and basename', () => {
    assert.equal(matchesProtected('src/auth.ts', ['src']), true);
    assert.equal(matchesProtected('app/.env.local', ['.env*']), true);
    assert.equal(matchesProtected('certs/server.pem', ['*.pem']), true);
    assert.equal(matchesProtected('src/auth.ts', ['app']), false);
  });
});
