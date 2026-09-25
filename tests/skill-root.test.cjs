'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const skill = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  assert.ok(m, 'SKILL.md needs frontmatter + body');
  return { head: m[1], body: m[2] };
}

describe('root SKILL.md', () => {
  it('carries the aftermath identity with trigger signals', () => {
    const { head } = frontmatter(skill);
    assert.match(head, /name:\s*aftermath/);
    for (const sig of ['green to', 'same error', 'destructive', 'you broke']) {
      assert.match(head, new RegExp(sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
  });

  it('keeps the ladder wording and points at the canonical skill', () => {
    const { body } = frontmatter(skill);
    for (const rung of [
      'Revert now',
      'last-known-good',
      'exact error',
      'Confirm',
      'Say so out loud',
      'Do not defend',
    ]) {
      assert.ok(body.includes(rung), `missing rung: ${rung}`);
    }
    for (const target of [
      'skills/aftermath/SKILL.md',
      'skills/test-regression/SKILL.md',
      'skills/retry-loop/SKILL.md',
      'skills/destructive-action/SKILL.md',
    ]) {
      assert.ok(body.includes(target), `missing pointer: ${target}`);
      assert.ok(
        fs.existsSync(path.join(root, target)),
        `pointer target missing: ${target}`
      );
    }
  });

  it('stays thin — entry point, not a second copy', () => {
    const { body } = frontmatter(skill);
    const lines = body.split('\n').filter((l) => l.trim().length > 0);
    assert.ok(lines.length <= 45, `root SKILL.md has ${lines.length} non-empty lines (cap 45)`);
  });
});
