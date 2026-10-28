'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createCheckpointStore } = require('../hooks/aftermath-checkpoints.cjs');

let tmp;
let file;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-checkpoints-'));
  file = path.join(tmp, 'auth.ts');
  fs.writeFileSync(file, 'before\n');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function edit(store, next) {
  fs.writeFileSync(file, next);
  store.confirmEdit(file);
}

describe('checkpoint store', () => {
  it('restores an edited file to its pre-edit content', () => {
    const store = createCheckpointStore();
    assert.equal(store.snapshot(file).stored, true);
    edit(store, 'after\n');

    const result = store.restoreAll();
    assert.deepEqual(
      { restored: result.restored, deleted: result.deleted, skipped: result.skipped },
      { restored: 1, deleted: 0, skipped: 0 }
    );
    assert.equal(fs.readFileSync(file, 'utf8'), 'before\n');
  });

  it('deletes a file that did not exist before the edit', () => {
    const store = createCheckpointStore();
    const created = path.join(tmp, 'new.ts');
    assert.equal(store.snapshot(created).existed, false);
    fs.writeFileSync(created, 'created\n');
    store.confirmEdit(created);

    const result = store.restoreAll();
    assert.equal(result.deleted, 1);
    assert.equal(fs.existsSync(created), false);
  });

  it('skips files edited outside the agent instead of clobbering them', () => {
    const store = createCheckpointStore();
    store.snapshot(file);
    edit(store, 'agent edit\n');
    fs.writeFileSync(file, 'manual edit\n');

    const result = store.restoreAll();
    assert.equal(result.restored, 0);
    assert.equal(result.skipped, 1);
    assert.deepEqual(result.conflicts, [file]);
    assert.equal(fs.readFileSync(file, 'utf8'), 'manual edit\n');
  });

  it('does not restore before a green test has been seen', () => {
    const store = createCheckpointStore();
    store.snapshot(file);
    edit(store, 'after\n');
    assert.equal(store.shouldRestore(), false);
  });

  it('becomes eligible after a green, then new snapshots', () => {
    const store = createCheckpointStore();
    store.markGreen();
    assert.equal(store.shouldRestore(), false);
    store.snapshot(file);
    edit(store, 'after\n');
    assert.equal(store.shouldRestore(), true);
  });

  it('markGreen clears snapshots', () => {
    const store = createCheckpointStore();
    store.snapshot(file);
    store.markGreen();
    assert.equal(store.describe().count, 0);
  });

  it('first snapshot wins and duplicates are ignored', () => {
    const store = createCheckpointStore();
    store.snapshot(file);
    edit(store, 'agent edit\n');
    assert.equal(store.snapshot(file).reason, 'already-tracked');
    store.restoreAll();
    assert.equal(fs.readFileSync(file, 'utf8'), 'before\n');
  });

  it('skips binary and oversized files', () => {
    const binary = path.join(tmp, 'blob.bin');
    fs.writeFileSync(binary, Buffer.from([0, 1, 2, 3]));
    assert.equal(storeReason(binary, {}), 'binary');

    const big = path.join(tmp, 'big.txt');
    fs.writeFileSync(big, 'x'.repeat(64));
    assert.equal(storeReason(big, { maxBytes: 16 }), 'oversize');
  });

  it('enforces the file cap', () => {
    const store = createCheckpointStore({ maxFiles: 1 });
    const second = path.join(tmp, 'second.ts');
    fs.writeFileSync(second, 'second\n');
    assert.equal(store.snapshot(file).stored, true);
    assert.equal(store.snapshot(second).reason, 'max-files');
    assert.equal(store.describe().count, 1);
  });

  it('confirmEdit ignores untracked files', () => {
    const store = createCheckpointStore();
    assert.equal(store.confirmEdit(file).confirmed, false);
  });

  it('describe reports tracked paths and green state', () => {
    const store = createCheckpointStore();
    store.markGreen();
    store.snapshot(file);
    const info = store.describe();
    assert.equal(info.count, 1);
    assert.deepEqual(info.paths, [file]);
    assert.equal(info.greenSeen, true);
    assert.equal(info.autoRevertEligible, false);
  });

  it('clear drops snapshots without changing green state', () => {
    const store = createCheckpointStore();
    store.markGreen();
    store.snapshot(file);
    store.clear();
    assert.equal(store.describe().count, 0);
    assert.equal(store.describe().greenSeen, true);
  });

  it('reports unreadable files', (t) => {
    if (process.platform === 'win32') return t.skip('POSIX permissions');
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      return t.skip('root ignores file modes');
    }
    fs.chmodSync(file, 0o000);
    try {
      assert.equal(storeReason(file, {}), 'unreadable');
    } finally {
      fs.chmodSync(file, 0o644);
    }
  });

  it('restores a file the edit deleted', () => {
    const store = createCheckpointStore();
    store.snapshot(file);
    fs.unlinkSync(file);
    assert.equal(store.confirmEdit(file).deleted, true);

    const result = store.restoreAll();
    assert.equal(result.restored, 1);
    assert.equal(fs.readFileSync(file, 'utf8'), 'before\n');
  });

  it('reports restore write failures as conflicts', (t) => {
    if (process.platform === 'win32') return t.skip('POSIX permissions');
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      return t.skip('root ignores file modes');
    }
    const store = createCheckpointStore();
    store.snapshot(file);
    edit(store, 'agent edit\n');
    fs.chmodSync(file, 0o444);
    try {
      const result = store.restoreAll();
      assert.equal(result.restored, 0);
      assert.equal(result.skipped, 1);
      assert.deepEqual(result.conflicts, [file]);
    } finally {
      fs.chmodSync(file, 0o644);
    }
  });
});

function storeReason(filePath, options) {
  const store = createCheckpointStore(options);
  return store.snapshot(filePath).reason;
}
