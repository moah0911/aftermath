'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createAttemptLedger,
  recordAttempt,
  resetLedger,
  errorKey,
} = require('../hooks/aftermath-signals.cjs');

describe('attempt ledger', () => {
  it('first failure is attempt 1 and does not escalate', () => {
    const ledger = createAttemptLedger();
    const r = recordAttempt(ledger, 'pytest::boom', { hadEdit: false, now: 1000 });
    assert.deepEqual(r, { attempt: 1, escalated: false, first: true });
  });

  it('same error without an edit is the same attempt', () => {
    const ledger = createAttemptLedger();
    recordAttempt(ledger, 'pytest::boom', { now: 1000 });
    const r = recordAttempt(ledger, 'pytest::boom', { hadEdit: false, now: 2000 });
    assert.equal(r.attempt, 1);
    assert.equal(r.escalated, false);
  });

  it('same error after an edit is the 2nd failed attempt', () => {
    const ledger = createAttemptLedger();
    recordAttempt(ledger, 'pytest::boom', { now: 1000 });
    const r = recordAttempt(ledger, 'pytest::boom', { hadEdit: true, now: 2000 });
    assert.equal(r.attempt, 2);
    assert.equal(r.escalated, true);
  });

  it('tracks different errors separately', () => {
    const ledger = createAttemptLedger();
    recordAttempt(ledger, 'pytest::one', { now: 1000 });
    recordAttempt(ledger, 'pytest::two', { now: 1000 });
    assert.equal(ledger.entries.size, 2);
  });

  it('expires entries after the TTL', () => {
    const ledger = createAttemptLedger({ ttlMs: 1000 });
    recordAttempt(ledger, 'pytest::boom', { now: 1000 });
    const r = recordAttempt(ledger, 'pytest::boom', {
      hadEdit: true,
      now: 5000,
    });
    assert.equal(r.attempt, 1);
    assert.equal(r.escalated, false);
  });

  it('evicts the oldest entry beyond the cap', () => {
    const ledger = createAttemptLedger({ maxEntries: 2 });
    recordAttempt(ledger, 'a', { now: 1000 });
    recordAttempt(ledger, 'b', { now: 2000 });
    recordAttempt(ledger, 'c', { now: 3000 });
    assert.equal(ledger.entries.size, 2);
    assert.equal(ledger.entries.has('a'), false);
    assert.equal(ledger.entries.has('c'), true);
  });

  it('reset clears all attempts', () => {
    const ledger = createAttemptLedger();
    recordAttempt(ledger, 'a', { now: 1000 });
    resetLedger(ledger);
    assert.equal(ledger.entries.size, 0);
  });

  it('empty keys are inert', () => {
    const ledger = createAttemptLedger();
    const r = recordAttempt(ledger, '  ', { now: 1000 });
    assert.deepEqual(r, { attempt: 0, escalated: false, first: false });
    assert.equal(ledger.entries.size, 0);
  });

  it('errorKey normalizes command whitespace and case', () => {
    assert.equal(
      errorKey('  PYTEST   tests/  ', 'boom'),
      'pytest tests/::boom'
    );
  });
});
