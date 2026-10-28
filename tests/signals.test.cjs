'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isDestructiveCommand,
  isTestCommand,
  isBuildCommand,
  isDependencyCommand,
  indicatesTestFailure,
  indicatesBuildFailure,
  indicatesDependencyFailure,
  indicatesMergeConflict,
  fingerprintError,
  isRepeatError,
} = require('../hooks/aftermath-signals.cjs');

describe('destructive-command detector', () => {
  it('flags force push, drop, rm -rf', () => {
    assert.equal(isDestructiveCommand('git push --force origin main'), true);
    assert.equal(isDestructiveCommand('git push -f origin main'), true);
    assert.equal(isDestructiveCommand('DROP TABLE users;'), true);
    assert.equal(isDestructiveCommand('rm -rf /tmp/build'), true);
    assert.equal(isDestructiveCommand('rm -fr ./dist'), true);
    assert.equal(isDestructiveCommand('rm -r ./dist'), true);
    assert.equal(isDestructiveCommand('rm --recursive --force ./dist'), true);
    assert.equal(isDestructiveCommand('terraform destroy -auto-approve'), true);
  });
  it('flags broad git and infrastructure destruction', () => {
    for (const cmd of [
      'git reset --hard HEAD~1',
      'git clean -fd',
      'git clean --force',
      'git branch -D feature',
      'git stash clear',
      'git stash drop',
      'git checkout -- .',
      'git restore .',
      'docker system prune -a',
      'docker volume rm data',
      'kubectl delete pod api',
      'helm uninstall aftermath',
      'terraform apply -auto-approve',
      'prisma migrate reset',
      'dropdb prod',
      'shred secrets.txt',
      'dd if=/dev/zero of=/dev/sda',
      'mkfs.ext4 /dev/sdb1',
      'find . -name "*.log" -delete',
      'find . -print0 | xargs rm',
      'chmod -R 777 /srv',
    ]) {
      assert.equal(isDestructiveCommand(cmd), true, `expected destructive: ${cmd}`);
    }
  });
  it('does not flag safe reads or dry-runs', () => {
    for (const cmd of [
      'git status --short',
      'git diff --stat',
      'git clean -n',
      'git checkout -- src/auth.ts',
      'git restore src/auth.ts',
      'terraform plan',
      'npm test',
      'ls -la',
    ]) {
      assert.equal(isDestructiveCommand(cmd), false, `expected safe: ${cmd}`);
    }
  });
});

describe('test-command detector', () => {
  it('recognizes common runners', () => {
    for (const cmd of [
      'pytest tests/ -q',
      'npm test',
      'npx jest auth.spec',
      'go test ./...',
      'cargo test --all',
      'cargo nextest run',
      'node --test tests/',
      'deno test',
      'make test',
      'tox -e py312',
      'nox',
      'mix test',
      'swift test',
      './gradlew test',
      'mvn test',
      'ctest --output-on-failure',
      'php artisan test',
      'bin/rails test',
      'bundle exec rspec',
      'bundle exec rake test',
    ]) {
      assert.equal(isTestCommand(cmd), true, `expected test command: ${cmd}`);
    }
  });
  it('ignores non-test commands', () => {
    assert.equal(isTestCommand('npm run build'), false);
    assert.equal(isTestCommand('git push origin main'), false);
    assert.equal(isTestCommand('make install'), false);
    assert.equal(isTestCommand('cargo build'), false);
  });
});

describe('test-failure detector', () => {
  it('spots failure markers', () => {
    for (const output of [
      'FAILED tests/test_auth.py::test_login',
      'Traceback (most recent call last): ...',
      'Tests: 3 failed, 12 passed',
      'test result: FAILED. 2 passed; 1 failed',
      '--- FAIL: TestLogin (0.02s)',
      'thread main panicked at src/lib.rs:10',
      'error[E0308]: mismatched types',
      'error TS2322: Type string is not assignable',
      'BUILD FAILURE',
      'Tests run: 3, Failures: 1, Errors: 0',
      '1 failing',
      '\u001b[31mFAILED\u001b[0m tests/auth',
      'npm ERR! Test failed',
    ]) {
      assert.equal(
        indicatesTestFailure(output),
        true,
        `expected failure: ${output}`
      );
    }
  });
  it('passes clean output, including zero-failure summaries', () => {
    assert.equal(indicatesTestFailure('12 passed in 0.42s'), false);
    assert.equal(indicatesTestFailure('0 failed, 12 passed'), false);
    assert.equal(indicatesTestFailure('0 failing'), false);
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

  it('normalizes versions and hex addresses', () => {
    const a = fingerprintError('Failed at 1.2.3 address 0xdeadbeef');
    const b = fingerprintError('Failed at 4.5.6 address 0xcafebabe');
    assert.equal(a, b);
  });
});

describe('build and dependency detectors', () => {
  it('recognizes build commands', () => {
    for (const cmd of [
      'tsc --noEmit',
      'npm run build',
      'pnpm build',
      'vite build',
      'next build',
      'cargo build --release',
      'go build ./...',
      'dotnet build',
      'mvn package',
      './gradlew build',
      'make',
    ]) {
      assert.equal(isBuildCommand(cmd), true, `expected build: ${cmd}`);
    }
    assert.equal(isBuildCommand('npm test'), false);
    assert.equal(isBuildCommand('cargo test'), false);
  });

  it('recognizes dependency commands', () => {
    for (const cmd of [
      'npm install',
      'npm ci',
      'pnpm add react',
      'pip install -r requirements.txt',
      'poetry install',
      'cargo fetch',
      'go mod tidy',
      'bundle install',
      'composer install',
      'dotnet restore',
    ]) {
      assert.equal(isDependencyCommand(cmd), true, `expected dependency: ${cmd}`);
    }
    assert.equal(isDependencyCommand('npm test'), false);
    assert.equal(isDependencyCommand('cargo build'), false);
  });

  it('spots build failures', () => {
    for (const output of [
      'error TS2322: Type string is not assignable',
      'error[E0308]: mismatched types',
      'BUILD FAILED',
      'Module not found: Cannot resolve ./auth',
      'FAILED to compile',
    ]) {
      assert.equal(indicatesBuildFailure(output), true, output);
    }
    assert.equal(indicatesBuildFailure('built successfully in 2s'), false);
  });

  it('spots dependency failures', () => {
    for (const output of [
      'npm ERR! ERESOLVE unable to resolve dependency tree',
      'No matching distribution found for foo',
      'failed to select a version for the requirement',
      'Your lock file needs to be updated',
      'Bundler could not find compatible versions',
    ]) {
      assert.equal(indicatesDependencyFailure(output), true, output);
    }
    assert.equal(indicatesDependencyFailure('added 10 packages in 2s'), false);
  });

  it('spots merge conflicts', () => {
    for (const output of [
      'CONFLICT (content): Merge conflict in src/auth.ts',
      'Automatic merge failed; fix conflicts and then commit the result.',
      '<<<<<<< HEAD',
      'Unmerged paths:',
      'both modified: src/auth.ts',
    ]) {
      assert.equal(indicatesMergeConflict(output), true, output);
    }
    assert.equal(indicatesMergeConflict('Already up to date.'), false);
  });
});
