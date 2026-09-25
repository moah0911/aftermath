'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const assets = path.join(__dirname, '..', 'assets');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(file, minBytes) {
  const p = path.join(assets, file);
  assert.ok(fs.existsSync(p), `missing assets/${file}`);
  const buf = fs.readFileSync(p);
  assert.ok(buf.length > minBytes, `assets/${file} too small (${buf.length}b)`);
  assert.ok(
    buf.subarray(0, 8).equals(PNG_MAGIC),
    `assets/${file} is not a PNG`
  );
}

describe('brand assets', () => {
  it('logo.png and icon.png are real PNGs', () => {
    isPng('logo.png', 10000);
    isPng('icon.png', 3000);
  });

  it('aftermath.txt banner names the project', () => {
    const p = path.join(assets, 'aftermath.txt');
    assert.ok(fs.existsSync(p), 'missing assets/aftermath.txt');
    const text = fs.readFileSync(p, 'utf8');
    assert.ok(text.includes('█'), 'banner lost its block glyphs');
    assert.match(text, /revert/i);
    assert.ok(
      text.split('\n').length >= 6,
      'banner too short to be the wordmark'
    );
  });
});
