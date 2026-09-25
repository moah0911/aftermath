'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('claude marketplace', () => {
  it('marketplace.json declares the aftermath plugin consistently', () => {
    const market = JSON.parse(
      fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8')
    );
    const plugin = JSON.parse(
      fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')
    );
    assert.equal(market.name, 'aftermath');
    assert.ok(market.owner && market.owner.name, 'owner required');
    assert.ok(Array.isArray(market.plugins) && market.plugins.length >= 1);
    const entry = market.plugins[0];
    assert.equal(entry.name, plugin.name);
    assert.equal(entry.version, plugin.version);
    assert.ok(entry.source, 'plugin source required');
    assert.ok(
      fs.existsSync(path.join(root, '.claude-plugin', entry.source)),
      `plugin source missing: ${entry.source}`
    );
  });

  it('all three manifests share one version', () => {
    const versions = [
      JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
      JSON.parse(
        fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')
      ).version,
      JSON.parse(
        fs.readFileSync(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8')
      ).version,
    ];
    assert.deepEqual([...new Set(versions)], [versions[0]]);
  });
});
