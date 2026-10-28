// aftermath — OpenCode server plugin.
//
// Injects the Aftermath recovery ladder into every chat's system prompt at the
// active intensity, persists /aftermath mode switches, enforces the two hard
// rules (destructive commands, no forward edits after a failure), and runs
// failure-signal detectors (test green→red, repeat error, user correction).
// At ultra with autoRevert enabled it checkpoints files and restores the
// last-known-good state on a green→red test.
//
// OpenCode loads this as a server plugin — add it to your opencode.json:
// { "plugin": ["./.opencode/plugins/aftermath.mjs"] }

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { getAftermathInstructions } = require('../../hooks/aftermath-instructions');
const aftermathConfig = require('../../hooks/aftermath-config');
const { parseCommandFile } = require('./aftermath-frontmatter.cjs');
const signals = require('../../hooks/aftermath-signals.cjs');
const { createCheckpointStore } = require('../../hooks/aftermath-checkpoints.cjs');
const {
  evaluateDestructiveCommand,
} = require('../../hooks/aftermath-destructive-policy.cjs');

const {
  readMode,
  writeMode,
  normalizePersistedMode,
  containsCorrectionSignal,
  getAutoRevert,
  getPolicy,
  getTestCommands,
} = aftermathConfig;

// In-memory pending signals. Consumed (and cleared) by the next
// experimental.chat.system.transform so the reminder lands in-context.
// failureUnresolved persists until a test passes or the user reverts/stands down.
function createSignalStore() {
  return {
    testRegression: false,
    testTransition: null, // 'green->red' | 'red' | null
    retryLoop: false,
    retryAttempt: 0,
    destructiveCommand: null,
    correction: false,
    failureUnresolved: false,
    editSinceLastFailure: false,
    autoRevertReport: null,
    checkpointReport: null,
    buildFailure: null,
    dependencyFailure: null,
    mergeConflict: null,
    flakyTest: false,
    lastErrorFingerprint: null,
    lastErrorExcerpt: null,
    lastTestResult: null, // 'pass' | 'fail' | null
  };
}

const pending = createSignalStore();
const checkpoints = createCheckpointStore();
const attemptLedger = signals.createAttemptLedger();
const outcomeTracker = signals.createOutcomeTracker();

function resetState() {
  Object.assign(pending, createSignalStore());
  checkpoints.reset();
  signals.resetLedger(attemptLedger);
  signals.resetOutcomes(outcomeTracker);
}

function excerpt(text, max = 400) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function bashCommand(input) {
  const args = (input && input.args) || {};
  return String(args.command || args.cmd || (input && input.command) || '');
}

function toolPath(input) {
  const args = (input && input.args) || {};
  return String(
    args.filePath || args.path || args.file || (input && input.filePath) || ''
  );
}

function outputText(output) {
  return (
    (output &&
      (output.output || output.text || output.result || output.error)) ||
    ''
  );
}

function blockedError(message) {
  const error = new Error(message);
  error.name = 'AftermathBlockError';
  return error;
}

function formatRestoreReport(result) {
  if (!result) return 'no files changed';
  const parts = [];
  if (result.restored) parts.push('restored ' + result.restored + ' file(s)');
  if (result.deleted) parts.push('deleted ' + result.deleted + ' new file(s)');
  if (result.skipped) parts.push('skipped ' + result.skipped + ' conflict(s)');
  let text = parts.length ? parts.join(', ') : 'no files changed';
  if (result.conflicts && result.conflicts.length) {
    text += ' — conflicts: ' + result.conflicts.join(', ');
  }
  return text;
}

export default async ({ client } = {}) => {
  const log = (level, message) => {
    try {
      client &&
        client.app &&
        client.app.log({ body: { service: 'aftermath', level, message } });
    } catch (_) {
      // logging must never break the session
    }
  };

  const skillsDir = path.resolve(__dirname, '../../skills');

  return {
    // Register slash commands + skills directory.
    config: async (config) => {
      if (!config.command) config.command = {};
      const commandDir = path.join(__dirname, '..', 'commands');
      try {
        for (const file of fs
          .readdirSync(commandDir)
          .filter((f) => f.endsWith('.md'))) {
          const name = path.basename(file, '.md');
          const parsed = parseCommandFile(path.join(commandDir, file));
          if (parsed) config.command[name] = parsed;
        }
      } catch (_) {
        // commands dir missing — slash commands fall back to markdown autodiscovery
      }

      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
    },

    // Append the ladder to the system prompt every turn, plus any pending
    // failure-signal pointers. Silent when mode is off.
    'experimental.chat.system.transform': async (_input, output) => {
      const mode = readMode();
      if (mode === 'off') return;
      const instructions = getAftermathInstructions(mode);
      if (!instructions) return;

      let extra = '';
      if (pending.testRegression) {
        extra +=
          '\n\nAFTERMATH SIGNAL: test suite just went ' +
          (pending.testTransition || 'red') +
          ' after an edit. Load the `test-regression` skill: diff against last-known-good, isolate one hunk, revert just that. No forward edits.';
      }
      if (pending.flakyTest) {
        extra +=
          '\n\nAFTERMATH SIGNAL: the test result alternated without code edits. Load the `flaky-test` skill: rerun to confirm, find nondeterminism, do not revert working code. Auto-revert skipped.';
      }
      if (pending.retryLoop) {
        extra +=
          '\n\nAFTERMATH SIGNAL: same error recurred' +
          (pending.retryAttempt > 1
            ? ' after ' + pending.retryAttempt + ' attempts'
            : '') +
          '. Load the `retry-loop` skill: stop varying the fix, state exact error + theory, ask.' +
          (pending.lastErrorExcerpt
            ? ' Exact error: ' + pending.lastErrorExcerpt
            : '');
      }
      if (pending.destructiveCommand) {
        extra +=
          '\n\nAFTERMATH SIGNAL: destructive command attempted (`' +
          excerpt(pending.destructiveCommand, 160) +
          '`). Load the `destructive-action` skill: confirm current state explicitly (git status, target). Do not proceed on assumption.';
      }
      if (pending.correction) {
        extra +=
          '\n\nAFTERMATH SIGNAL: user corrected you. Do not defend the last step. Find the diff. Fix only that.';
      }
      if (pending.buildFailure) {
        extra +=
          '\n\nAFTERMATH SIGNAL: build failed. Load the `build-failure` skill: read the first error, isolate the hunk, no tests until the build is green. Error: ' +
          pending.buildFailure;
      }
      if (pending.dependencyFailure) {
        extra +=
          '\n\nAFTERMATH SIGNAL: dependency install/resolution failed. Load the `dependency-failure` skill: paste the exact resolver error, respect the lockfile, one change at a time. Error: ' +
          pending.dependencyFailure;
      }
      if (pending.mergeConflict) {
        extra +=
          '\n\nAFTERMATH SIGNAL: merge conflict detected. Load the `merge-conflict` skill: read both sides, never blindly take ours/theirs, run affected tests after resolving.';
      }
      if (pending.autoRevertReport) {
        extra +=
          '\n\nAFTERMATH REPORT: auto-revert ' +
          formatRestoreReport(pending.autoRevertReport) +
          '. Re-run the failing subset before any new edit.';
      }
      if (pending.checkpointReport) {
        const report = pending.checkpointReport;
        if (report.action === 'restore') {
          extra +=
            '\n\nAFTERMATH REPORT: manual checkpoint restore — ' +
            formatRestoreReport(report.result) +
            '.';
        } else if (report.action === 'clear') {
          extra += '\n\nAFTERMATH REPORT: checkpoints cleared.';
        } else {
          const info = checkpoints.describe();
          extra +=
            '\n\nAFTERMATH REPORT: checkpoints — ' +
            info.count +
            ' file(s), last green: ' +
            (info.lastGreenAt
              ? new Date(info.lastGreenAt).toISOString()
              : 'none') +
            ', autoRevert: ' +
            (getAutoRevert() ? 'on' : 'off') +
            '.';
        }
      }

      let state = '';
      if (pending.failureUnresolved) {
        state +=
          '\n\nAFTERMATH STATE: failure unresolved. Forward edits are blocked at full/ultra until a test command passes, /aftermath-revert runs, or the level drops to lite/off.';
      }
      const checkpointInfo = checkpoints.describe();
      if (checkpointInfo.count > 0) {
        state +=
          '\n\nAFTERMATH STATE: checkpoint active — ' +
          checkpointInfo.count +
          ' file(s) since last green; autoRevert ' +
          (getAutoRevert() ? 'on' : 'off') +
          '.';
      }

      const block = instructions + extra + state;
      if (output.system.length > 0) {
        output.system[output.system.length - 1] += '\n\n' + block;
      } else {
        output.system.push(block);
      }

      // Consumed — clear one-shot flags (failure and test history persist).
      pending.testRegression = false;
      pending.testTransition = null;
      pending.retryLoop = false;
      pending.retryAttempt = 0;
      pending.destructiveCommand = null;
      pending.correction = false;
      pending.autoRevertReport = null;
      pending.checkpointReport = null;
      pending.buildFailure = null;
      pending.dependencyFailure = null;
      pending.mergeConflict = null;
      pending.flakyTest = false;
    },

    // Persist `/aftermath <mode>`, clear guards on revert, and handle checkpoint actions.
    'command.execute.before': async (input) => {
      if (!input) return;
      const command = input.command;
      const args = String(input.arguments || '').trim();

      if (command === 'aftermath') {
        if (!args) return; // bare /aftermath just reports via its template
        const mode = normalizePersistedMode(args.split(/\s+/)[0]);
        if (!mode) return;
        writeMode(mode);
        if (mode === 'off' || mode === 'lite') {
          pending.failureUnresolved = false;
          pending.editSinceLastFailure = false;
          checkpoints.reset();
        }
        log('info', 'aftermath ' + mode);
        return;
      }

      if (command === 'aftermath-revert') {
        pending.failureUnresolved = false;
        pending.editSinceLastFailure = false;
        signals.resetLedger(attemptLedger);
        checkpoints.reset();
        return;
      }

      if (command === 'aftermath-checkpoint') {
        const action = (args.split(/\s+/)[0] || 'status').toLowerCase();
        if (action === 'clear') {
          checkpoints.clear();
          pending.checkpointReport = { action: 'clear' };
        } else if (action === 'restore') {
          pending.checkpointReport = {
            action: 'restore',
            result: checkpoints.restoreAll(),
          };
        } else {
          pending.checkpointReport = { action: 'status' };
        }
        log('info', 'aftermath checkpoint ' + action);
      }
    },

    // Watch user messages for correction signals.
    event: async (input) => {
      try {
        const type = input && (input.type || input.event || '');
        const text =
          (input &&
            (input.text || input.prompt || input.message || input.data || '')) ||
          '';
        const blob = typeof text === 'string' ? text : JSON.stringify(text);
        if (
          /chat\.message|prompt|message/i.test(String(type)) &&
          containsCorrectionSignal(blob)
        ) {
          const mode = readMode();
          if (mode !== 'off') {
            pending.correction = true;
            log('warn', 'aftermath: user-correction signal detected');
          }
        }
      } catch (_) {
        // event sniffing must never break the session
      }
    },

    // Enforcement: destructive commands and forward edits after a failure.
    // Ultra checkpoints files here, before the edit runs.
    'tool.execute.before': async (input) => {
      const mode = readMode();
      if (mode === 'off') return;

      let block = null;
      try {
        const tool = input && input.tool;

        if (tool === 'bash') {
          const cmd = bashCommand(input);
          if (cmd) {
            const verdict = evaluateDestructiveCommand(cmd, getPolicy());
            if (verdict.destructive && verdict.decision === 'block') {
              pending.destructiveCommand = cmd;
              log(
                'warn',
                'aftermath: destructive command blocked (' +
                  verdict.reason +
                  ')' +
                  (verdict.target ? ': ' + verdict.target : '')
              );
              if (mode === 'full' || mode === 'ultra') {
                block = blockedError(
                  'AFTERMATH: destructive command blocked (' +
                    verdict.reason +
                    ')' +
                    (verdict.target ? ' Target: ' + verdict.target + '.' : '') +
                    ' Confirm current state explicitly (git status, target) before proceeding. Command: ' +
                    excerpt(cmd, 200) +
                    '. Fix the target, or allowlist it in the global or project config (destructiveAllowlist) if intentional.'
                );
              }
            } else if (
              verdict.destructive &&
              verdict.reason === 'safe-artifact'
            ) {
              log(
                'info',
                'aftermath: destructive command allowed as safe artifact: ' +
                  excerpt(cmd, 120)
              );
            }
          }
        } else if (tool === 'edit' || tool === 'write') {
          if (pending.failureUnresolved && (mode === 'full' || mode === 'ultra')) {
            block = blockedError(
              'AFTERMATH: forward edit blocked — a failure is unresolved. Broke: ' +
                (pending.lastErrorExcerpt || 'test regression') +
                '. Run /aftermath-status, revert the implicated hunk, and get tests green before editing again. ' +
                'Use /aftermath lite or /aftermath off to override.'
            );
          } else if (mode === 'ultra' && getAutoRevert()) {
            const filePath = toolPath(input);
            if (filePath) {
              const snapshot = checkpoints.snapshot(filePath);
              if (!snapshot.stored && snapshot.reason !== 'already-tracked') {
                log('info', 'aftermath: checkpoint skipped (' + snapshot.reason + '): ' + filePath);
              }
            }
          }
        }
      } catch (_) {
        // detectors must never break tool execution; deliberate blocks throw below
      }
      if (block) throw block;
    },

    // Test green→red + repeat-error detectors, checkpoint confirmation,
    // and opt-in ultra auto-revert.
    'tool.execute.after': async (input, output) => {
      try {
        const mode = readMode();
        if (mode === 'off') return;
        const tool = input && input.tool;

        if (tool === 'edit' || tool === 'write') {
          const filePath = toolPath(input);
          if (filePath) checkpoints.confirmEdit(filePath);
          pending.editSinceLastFailure = true;
          signals.resetOutcomes(outcomeTracker);
          return;
        }

        if (tool !== 'bash') return;
        const cmd = bashCommand(input);
        const blob = excerpt(String(outputText(output)), 4000);
        const configuredTest = getTestCommands().some((entry) =>
          cmd.includes(entry)
        );

        if (signals.isTestCommand(cmd) || configuredTest) {
          const fingerprint = signals.fingerprintError(blob);
          if (signals.indicatesTestFailure(blob)) {
            const wasGreen = pending.lastTestResult === 'pass';
            const outcome = signals.recordOutcome(
              outcomeTracker,
              signals.errorKey(cmd, ''),
              'fail',
              { hadEdit: pending.editSinceLastFailure }
            );
            pending.testRegression = true;
            pending.testTransition = wasGreen ? 'green->red' : 'red';
            pending.lastTestResult = 'fail';
            pending.lastErrorExcerpt = excerpt(blob, 200);
            pending.lastErrorFingerprint = fingerprint;
            if (outcome.flaky) {
              pending.flakyTest = true;
              pending.failureUnresolved = false;
            } else {
              pending.failureUnresolved = true;
            }

            const attempt = signals.recordAttempt(
              attemptLedger,
              signals.errorKey(cmd, fingerprint),
              { hadEdit: pending.editSinceLastFailure }
            );
            pending.editSinceLastFailure = false;
            if (attempt.escalated && !outcome.flaky) {
              pending.retryLoop = true;
              pending.retryAttempt = attempt.attempt;
            }

            if (
              !outcome.flaky &&
              wasGreen &&
              mode === 'ultra' &&
              getAutoRevert() &&
              checkpoints.shouldRestore()
            ) {
              pending.autoRevertReport = checkpoints.restoreAll();
              log('warn', 'aftermath: auto-revert triggered');
            }
            log(
              'warn',
              'aftermath: test failure signal (' + pending.testTransition + ')'
            );
          } else if (blob.trim()) {
            signals.recordOutcome(
              outcomeTracker,
              signals.errorKey(cmd, ''),
              'pass',
              { hadEdit: pending.editSinceLastFailure }
            );
            pending.lastTestResult = 'pass';
            pending.failureUnresolved = false;
            pending.editSinceLastFailure = false;
            pending.lastErrorExcerpt = null;
            pending.lastErrorFingerprint = null;
            pending.flakyTest = false;
            signals.resetLedger(attemptLedger);
            checkpoints.markGreen();
          }
          return;
        }

        if (signals.indicatesMergeConflict(blob)) {
          pending.mergeConflict = excerpt(blob, 200);
          log('warn', 'aftermath: merge-conflict signal');
        }
        if (
          signals.isDependencyCommand(cmd) &&
          signals.indicatesDependencyFailure(blob)
        ) {
          pending.dependencyFailure = excerpt(blob, 200);
          log('warn', 'aftermath: dependency-failure signal');
        }
        if (signals.isBuildCommand(cmd) && signals.indicatesBuildFailure(blob)) {
          pending.buildFailure = excerpt(blob, 200);
          log('warn', 'aftermath: build-failure signal');
        }

        // Repeat-error signal: fingerprint stderr-ish output, escalate only
        // when the same error recurs after an edit.
        if (blob && /error|fail|exception|traceback/i.test(blob)) {
          const fingerprint = signals.fingerprintError(blob);
          const attempt = signals.recordAttempt(
            attemptLedger,
            signals.errorKey(cmd, fingerprint),
            { hadEdit: pending.editSinceLastFailure }
          );
          pending.editSinceLastFailure = false;
          pending.lastErrorFingerprint = fingerprint;
          pending.lastErrorExcerpt = excerpt(blob, 200);
          if (attempt.escalated) {
            pending.retryLoop = true;
            pending.retryAttempt = attempt.attempt;
            pending.failureUnresolved = true;
            log(
              'warn',
              'aftermath: repeat-error signal (attempt ' + attempt.attempt + ')'
            );
          }
        }
      } catch (_) {
        // detectors must never break the session
      }
    },
  };
};

// Exported for tests: reset the module-level store between cases.
export { pending, resetState };
