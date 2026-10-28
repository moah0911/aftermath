'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseCommandFile } = require('../.opencode/plugins/aftermath-frontmatter.cjs');

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-frontmatter-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(name, content) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, content);
  return file;
}

describe('command frontmatter parser', () => {
  it('parses LF frontmatter and trims the template', () => {
    const file = write(
      'lf.md',
      '---\ndescription: Do a thing\n---\n\n  Body here  \n'
    );
    assert.deepEqual(parseCommandFile(file), {
      description: 'Do a thing',
      template: 'Body here',
    });
  });

  it('parses CRLF frontmatter', () => {
    const file = write(
      'crlf.md',
      '---\r\ndescription: Windows\r\n---\r\nBody\r\n'
    );
    assert.deepEqual(parseCommandFile(file), {
      description: 'Windows',
      template: 'Body',
    });
  });

  it('returns null without frontmatter', () => {
    const file = write('plain.md', 'Body only\n');
    assert.equal(parseCommandFile(file), null);
  });

  it('returns undefined description when omitted', () => {
    const file = write('nodesc.md', '---\nother: x\n---\nBody\n');
    const parsed = parseCommandFile(file);
    assert.equal(parsed.description, undefined);
    assert.equal(parsed.template, 'Body');
  });

  it('trims the description', () => {
    const file = write('spaces.md', '---\ndescription:   padded   \n---\nBody\n');
    assert.equal(parseCommandFile(file).description, 'padded');
  });
});
