'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createOutcomeTracker,
  recordOutcome,
  resetOutcomes,
} = require('../hooks/aftermath-signals.cjs');

describe('outcome tracker', () => {
  it('does not flag a single flip as flaky', () => {
    const tracker = createOutcomeTracker();
    assert.deepEqual(recordOutcome(tracker, 'pytest', 'pass', { now: 1 }), {
      flaky: false,
      alternations: 0,
    });
    assert.deepEqual(recordOutcome(tracker, 'pytest', 'fail', { now: 2 }), {
      flaky: false,
      alternations: 1,
    });
  });

  it('flags pass→fail→pass as flaky', () => {
    const tracker = createOutcomeTracker();
    recordOutcome(tracker, 'pytest', 'pass', { now: 1 });
    recordOutcome(tracker, 'pytest', 'fail', { now: 2 });
    const result = recordOutcome(tracker, 'pytest', 'pass', { now: 3 });
    assert.equal(result.flaky, true);
    assert.equal(result.alternations, 2);
  });

  it('flags fail→pass→fail as flaky', () => {
    const tracker = createOutcomeTracker();
    recordOutcome(tracker, 'pytest', 'fail', { now: 1 });
    recordOutcome(tracker, 'pytest', 'pass', { now: 2 });
    const result = recordOutcome(tracker, 'pytest', 'fail', { now: 3 });
    assert.equal(result.flaky, true);
  });

  it('does not flag repeated failures', () => {
    const tracker = createOutcomeTracker();
    recordOutcome(tracker, 'pytest', 'fail', { now: 1 });
    recordOutcome(tracker, 'pytest', 'fail', { now: 2 });
    const result = recordOutcome(tracker, 'pytest', 'fail', { now: 3 });
    assert.equal(result.flaky, false);
  });

  it('resets history after an edit', () => {
    const tracker = createOutcomeTracker();
    recordOutcome(tracker, 'pytest', 'pass', { now: 1 });
    recordOutcome(tracker, 'pytest', 'fail', { now: 2 });
    const result = recordOutcome(tracker, 'pytest', 'pass', {
      hadEdit: true,
      now: 3,
    });
    assert.equal(result.flaky, false);
    assert.equal(result.alternations, 0);
  });

  it('keeps separate histories per command', () => {
    const tracker = createOutcomeTracker();
    recordOutcome(tracker, 'pytest', 'pass', { now: 1 });
    recordOutcome(tracker, 'jest', 'fail', { now: 1 });
    recordOutcome(tracker, 'pytest', 'fail', { now: 2 });
    assert.equal(recordOutcome(tracker, 'jest', 'pass', { now: 2 }).flaky, false);
  });

  it('drops outcomes beyond the window', () => {
    const tracker = createOutcomeTracker({ window: 2 });
    recordOutcome(tracker, 'pytest', 'pass', { now: 1 });
    recordOutcome(tracker, 'pytest', 'fail', { now: 2 });
    const result = recordOutcome(tracker, 'pytest', 'pass', { now: 3 });
    assert.equal(result.alternations, 1);
    assert.equal(result.flaky, false);
    assert.equal(tracker.entries.get('pytest').outcomes.length, 2);
  });

  it('ignores empty keys and invalid results', () => {
    const tracker = createOutcomeTracker();
    assert.deepEqual(recordOutcome(tracker, '', 'pass'), {
      flaky: false,
      alternations: 0,
    });
    assert.deepEqual(recordOutcome(tracker, 'pytest', 'maybe'), {
      flaky: false,
      alternations: 0,
    });
    assert.equal(tracker.entries.size, 0);
  });

  it('reset clears all histories', () => {
    const tracker = createOutcomeTracker();
    recordOutcome(tracker, 'pytest', 'pass');
    resetOutcomes(tracker);
    assert.equal(tracker.entries.size, 0);
  });
});
