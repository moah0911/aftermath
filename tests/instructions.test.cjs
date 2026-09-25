'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  filterSkillBodyForMode,
  getFallbackInstructions,
  getAftermathInstructions,
} = require('../hooks/aftermath-instructions');

describe('mode filtering', () => {
  const body = [
    '---',
    'name: x',
    '---',
    '',
    '| **lite** | suggests |',
    '| **full** | stops |',
    '| **ultra** | auto-reverts |',
    '- lite: "suggest it"',
    '- full: "stop and ask"',
    '- ultra: "revert it"',
    '- No unrequested abstractions: keep this line in every mode.',
  ].join('\n');

  it('keeps only the active mode rows and examples', () => {
    const full = filterSkillBodyForMode(body, 'full');
    assert.match(full, /\*\*full\*\*/);
    assert.doesNotMatch(full, /\*\*lite\*\*/);
    assert.doesNotMatch(full, /\*\*ultra\*\*/);
    assert.match(full, /stop and ask/);
    assert.doesNotMatch(full, /suggest it/);
  });

  it('never drops normal rule prose', () => {
    for (const mode of ['lite', 'full', 'ultra']) {
      assert.match(
        filterSkillBodyForMode(body, mode),
        /No unrequested abstractions/
      );
    }
  });
});

describe('fallback + live instructions', () => {
  it('fallback contains the ladder and honesty rules', () => {
    const text = getFallbackInstructions('full');
    assert.match(text, /AFTERMATH MODE ACTIVE/);
    assert.match(text, /Revert now/);
    assert.match(text, /never hide a break/i);
    assert.match(text, /never invent an unverified root cause/i);
  });

  it('live instructions load at full, silence at off', () => {
    const full = getAftermathInstructions('full');
    assert.ok(full.length > 200, 'expected full skill body');
    assert.match(full, /AFTERMATH MODE ACTIVE/);
    assert.equal(getAftermathInstructions('off'), '');
  });
});
