'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const install = require('../scripts/install');

describe('parseArgs', () => {
  it('defaults to global all-hosts install from main', () => {
    const o = install.parseArgs([]);
    assert.equal(o.project, false);
    assert.equal(o.host, 'all');
    assert.equal(o.ref, 'main');
    assert.equal(o.source, null);
    assert.equal(o.dryRun, false);
    assert.equal(o.uninstall, false);
  });
  it('parses every flag', () => {
    const o = install.parseArgs([
      '--project',
      '--host',
      'opencode',
      '--ref',
      'v0.1.0',
      '--source',
      '/tmp/x',
      '--mode',
      'lite',
      '--dry-run',
    ]);
    assert.equal(o.project, true);
    assert.equal(o.host, 'opencode');
    assert.equal(o.ref, 'v0.1.0');
    assert.equal(o.source, '/tmp/x');
    assert.equal(o.mode, 'lite');
    assert.equal(o.dryRun, true);
  });
  it('rejects junk host, mode, and unknown flags', () => {
    assert.throws(() => install.parseArgs(['--host', 'vim']), /--host must be/);
    assert.throws(() => install.parseArgs(['--mode', 'turbo']), /--mode must be/);
    assert.throws(() => install.parseArgs(['--frobnicate']), /unknown flag/);
    assert.throws(() => install.parseArgs(['--host']), /needs a value/);
  });
});

describe('plugin entry helpers', () => {
  it('adds once, detects string and tuple forms', () => {
    const spec = '/x/.opencode/plugins/aftermath.mjs';
    let r = install.ensurePluginEntry({}, spec);
    assert.equal(r.changed, true);
    assert.deepEqual(r.next, [spec]);

    r = install.ensurePluginEntry({ plugin: [spec] }, spec);
    assert.equal(r.changed, false);

    r = install.ensurePluginEntry({ plugin: [[spec, { a: 1 }]] }, spec);
    assert.equal(r.changed, false);

    r = install.ensurePluginEntry({ plugin: ['other'] }, spec);
    assert.deepEqual(r.next, ['other', spec]);
  });
  it('removes only aftermath entries', () => {
    const spec = '/x/.opencode/plugins/aftermath.mjs';
    const cfg = { plugin: ['keep-me', spec, [spec, {}]] };
    const r = install.removePluginEntry(cfg);
    assert.equal(r.changed, true);
    assert.deepEqual(r.next, ['keep-me']);
    assert.equal(install.removePluginEntry({ plugin: ['keep-me'] }).changed, false);
  });
});

describe('pluginSpec', () => {
  it('uses relative spec for self-checkout, absolute otherwise', () => {
    assert.equal(
      install.pluginSpec('/repo', '/repo'),
      './.opencode/plugins/aftermath.mjs'
    );
    assert.equal(
      install.pluginSpec('/repo', '/other'),
      path.join('/repo', '.opencode', 'plugins', 'aftermath.mjs')
    );
    assert.equal(
      install.pluginSpec('/repo', null),
      path.join('/repo', '.opencode', 'plugins', 'aftermath.mjs')
    );
  });
});

describe('loadOpencodeJson', () => {
  it('returns {} when missing, parses when present', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-install-'));
    try {
      assert.deepEqual(
        install.loadOpencodeJson(path.join(tmp, 'opencode.json')),
        {}
      );
      const file = path.join(tmp, 'opencode.json');
      fs.writeFileSync(file, '{"plugin":[]}');
      assert.deepEqual(install.loadOpencodeJson(file), { plugin: [] });
      fs.writeFileSync(file, '[]');
      assert.throws(() => install.loadOpencodeJson(file), /not a JSON object/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
