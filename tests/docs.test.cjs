'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const portability = fs.readFileSync(
  path.join(root, 'docs', 'agent-portability.md'),
  'utf8'
);

describe('installation documentation', () => {
  it('documents every supported harness and install command', () => {
    for (const harness of [
      'Any skills-compatible agent',
      'OpenCode',
      'Claude Code',
      'Codex',
      'Checkout / manual',
    ]) {
      assert.ok(readme.includes(harness), `README missing ${harness}`);
    }
    for (const command of [
      'npx skills add moah0911/aftermath',
      '@moah0911/aftermath',
      'plugin marketplace add moah0911/aftermath',
      'plugin install aftermath@aftermath',
      'codex plugin add aftermath@aftermath',
      'node aftermath/scripts/install.js',
      'npx @moah0911/aftermath init',
    ]) {
      assert.ok(readme.includes(command), `README missing: ${command}`);
    }
    assert.match(readme, /docs\/init\.md/);
    assert.match(readme, /docs\/agent-portability\.md/);
  });

  it('documents all hosts in the portability matrix', () => {
    for (const host of ['OpenCode', 'Claude Code', 'Codex']) {
      assert.ok(portability.includes(host), `portability missing ${host}`);
    }
    assert.match(portability, /CLAUDE_PLUGIN_ROOT/);
    assert.match(portability, /PostToolUse/);
    assert.match(portability, /UserPromptSubmit/);
  });
});
