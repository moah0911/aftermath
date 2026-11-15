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
      '@after.math/aftermath',
      'plugin marketplace add moah0911/aftermath',
      'plugin install aftermath@aftermath',
      'codex plugin marketplace add moah0911/aftermath',
      'codex plugin add aftermath@aftermath',
      'node aftermath/scripts/install.js',
      'npx @after.math/aftermath init',
    ]) {
      assert.ok(readme.includes(command), `README missing: ${command}`);
    }
    assert.match(readme, /--host codex/);
    assert.match(readme, /docs\/init\.md/);
    assert.match(readme, /docs\/agent-portability\.md/);
  });

  it('documents the npm install behavior and the scope split', () => {
    // `npm i` must be documented as wiring the detected agents...
    assert.match(readme, /npm i @after\.math\/aftermath/);
    assert.match(readme, /npm i -g @after\.math\/aftermath/);
    for (const host of ['OpenCode', 'Claude Code', 'Codex']) {
      assert.ok(readme.includes(host), `README missing ${host}`);
    }
    // ...and the two-namespace split must be explicit.
    assert.match(readme, /moah0911\/aftermath/);
    assert.match(readme, /Two names, one project/);
    // Opt-outs and uninstall must be documented.
    assert.match(readme, /AFM_SKIP_INSTALL=1/);
    assert.match(readme, /--ignore-scripts/);
    assert.match(readme, /npm uninstall @after\.math\/aftermath/);
    assert.match(readme, /aftermath-install --uninstall/);
    // Troubleshooting + dev flow.
    assert.match(readme, /Troubleshooting/);
    assert.match(readme, /npm run test:py/);
    assert.match(readme, /Scope not found/);
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
