'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const portable = path.join(root, 'commands');
const discovered = path.join(root, '.opencode', 'commands');
const expected = [
  'aftermath.md',
  'aftermath-status.md',
  'aftermath-revert.md',
  'aftermath-audit.md',
  'aftermath-log.md',
];

describe('slash commands', () => {
  for (const file of expected) {
    it(`${file} exists in both dirs with description + template`, () => {
      for (const dir of [portable, discovered]) {
        const p = path.join(dir, file);
        assert.ok(fs.existsSync(p), `missing ${p}`);
        const content = fs.readFileSync(p, 'utf8');
        const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        assert.ok(m, `${p} needs frontmatter + body`);
        assert.match(m[1], /description:\s*.+/, `${p} needs a description`);
        assert.ok(m[2].trim().length > 20, `${p} template is too thin`);
      }
    });
  }

  it('portable and discovered copies stay in sync', () => {
    for (const file of expected) {
      const a = fs.readFileSync(path.join(portable, file), 'utf8');
      const b = fs.readFileSync(path.join(discovered, file), 'utf8');
      assert.equal(b, a, `${file} diverged — copy commands/ over .opencode/commands/`);
    }
  });

  it('ladder file stays tiny', () => {
    const ladder = fs.readFileSync(path.join(root, 'AFTERMATH.md'), 'utf8');
    const lines = ladder.split('\n').filter((l) => l.trim().length > 0);
    assert.ok(lines.length <= 20, `AFTERMATH.md has ${lines.length} non-empty lines, target ~dozen`);
    for (const rung of ['Revert now', 'last-known-good', 'State exact error', 'Confirm state', 'Say so out loud', 'Do not defend']) {
      assert.match(ladder, new RegExp(rung.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
  });
});
