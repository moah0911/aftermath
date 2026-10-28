'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const skillsDir = path.join(root, 'skills');
const rootSkill = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

const expected = [
  'aftermath',
  'test-regression',
  'retry-loop',
  'destructive-action',
  'build-failure',
  'flaky-test',
  'dependency-failure',
  'merge-conflict',
];

describe('skills coverage', () => {
  it('ships every expected skill directory', () => {
    const dirs = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(dirs, [...expected].sort());
  });

  for (const name of expected) {
    it(`${name} has valid frontmatter and body`, () => {
      const file = path.join(skillsDir, name, 'SKILL.md');
      assert.ok(fs.existsSync(file), `missing ${file}`);
      const content = fs.readFileSync(file, 'utf8');
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      assert.ok(match, `${name} needs frontmatter + body`);
      assert.match(match[1], new RegExp(`name:\\s*${name}\\b`));
      assert.match(match[1], /description:\s*\S/);
      assert.match(match[1], /license:\s*MIT/);
      assert.ok(
        match[2].trim().length > 100,
        `${name} body is too thin (${match[2].trim().length} chars)`
      );
      assert.ok(
        rootSkill.includes(`skills/${name}/SKILL.md`),
        `root SKILL.md does not reference ${name}`
      );
      assert.ok(
        agents.includes(`\`${name}\``),
        `AGENTS.md does not list ${name}`
      );
    });
  }

  it('keeps the root skill a thin pointer', () => {
    const nonEmpty = rootSkill
      .split('\n')
      .filter((line) => line.trim().length > 0);
    assert.ok(nonEmpty.length <= 45, `root SKILL.md has ${nonEmpty.length} lines`);
  });
});
