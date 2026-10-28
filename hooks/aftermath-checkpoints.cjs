'use strict';

// aftermath — checkpoint store for the ultra auto-revert path.
//
// A snapshot captures the pre-edit content of a file (first snapshot wins).
// confirmEdit records the post-edit hash. restoreAll only reverts files whose
// current content still matches that hash, so manual edits made outside the
// agent are never clobbered — they are reported as conflicts instead.

const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_MAX_FILES = 50;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function isBinary(buf) {
  return buf.includes(0);
}

function createCheckpointStore(options = {}) {
  const maxFiles =
    Number.isInteger(options.maxFiles) && options.maxFiles > 0
      ? options.maxFiles
      : DEFAULT_MAX_FILES;
  const maxBytes =
    Number.isInteger(options.maxBytes) && options.maxBytes > 0
      ? options.maxBytes
      : DEFAULT_MAX_BYTES;

  // path -> { before, existed, mode, expectedAfter, expectedDeleted, editedAt }
  const files = new Map();
  let greenSeen = false;
  let lastGreenAt = null;

  function snapshot(filePath) {
    const p = String(filePath || '');
    if (!p) return { stored: false, reason: 'no-path' };
    if (files.has(p)) return { stored: false, reason: 'already-tracked' };
    if (files.size >= maxFiles) return { stored: false, reason: 'max-files' };

    let stat = null;
    try {
      stat = fs.statSync(p);
    } catch (_) {
      stat = null;
    }
    if (stat && !stat.isFile()) return { stored: false, reason: 'not-file' };

    let before = null;
    if (stat) {
      try {
        before = fs.readFileSync(p);
      } catch (_) {
        return { stored: false, reason: 'unreadable' };
      }
      if (before.length > maxBytes) return { stored: false, reason: 'oversize' };
      if (isBinary(before)) return { stored: false, reason: 'binary' };
    }

    files.set(p, {
      before,
      existed: Boolean(stat),
      mode: stat ? stat.mode : null,
      expectedAfter: null,
      expectedDeleted: false,
      editedAt: Date.now(),
    });
    return { stored: true, existed: Boolean(stat), path: p };
  }

  function confirmEdit(filePath) {
    const p = String(filePath || '');
    const entry = files.get(p);
    if (!entry) return { confirmed: false, reason: 'not-tracked' };
    try {
      const after = fs.readFileSync(p);
      entry.expectedAfter = hashBuffer(after);
      entry.expectedDeleted = false;
      entry.editedAt = Date.now();
      return { confirmed: true, path: p };
    } catch (_) {
      // The edit removed the file; restore should expect it to stay absent.
      entry.expectedAfter = null;
      entry.expectedDeleted = true;
      entry.editedAt = Date.now();
      return { confirmed: true, path: p, deleted: true };
    }
  }

  function markGreen() {
    files.clear();
    greenSeen = true;
    lastGreenAt = Date.now();
  }

  function shouldRestore() {
    if (!greenSeen) return false;
    for (const entry of files.values()) {
      if (entry.expectedDeleted || entry.expectedAfter !== null) return true;
    }
    return false;
  }

  function restoreAll() {
    const result = { restored: 0, deleted: 0, skipped: 0, conflicts: [] };
    for (const [p, entry] of files) {
      let current = null;
      let currentExists = false;
      try {
        current = fs.readFileSync(p);
        currentExists = true;
      } catch (_) {
        currentExists = false;
      }

      const expectedDeleted = entry.expectedDeleted === true;
      const matches = expectedDeleted
        ? !currentExists
        : entry.expectedAfter !== null &&
          currentExists &&
          hashBuffer(current) === entry.expectedAfter;

      if (!matches) {
        result.skipped += 1;
        result.conflicts.push(p);
        continue;
      }

      try {
        if (entry.existed) {
          fs.writeFileSync(p, entry.before);
          result.restored += 1;
        } else {
          if (currentExists) fs.unlinkSync(p);
          result.deleted += 1;
        }
      } catch (_) {
        result.skipped += 1;
        result.conflicts.push(p);
      }
    }
    files.clear();
    return result;
  }

  function clear() {
    files.clear();
  }

  function reset() {
    files.clear();
    greenSeen = false;
    lastGreenAt = null;
  }

  function describe() {
    return {
      count: files.size,
      paths: [...files.keys()],
      greenSeen,
      lastGreenAt,
      autoRevertEligible: shouldRestore(),
    };
  }

  return {
    snapshot,
    confirmEdit,
    markGreen,
    shouldRestore,
    restoreAll,
    clear,
    reset,
    describe,
  };
}

module.exports = {
  createCheckpointStore,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_BYTES,
};
