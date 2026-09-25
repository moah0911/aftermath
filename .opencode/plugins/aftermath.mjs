// aftermath — OpenCode server plugin.
//
// Injects the Aftermath recovery ladder into every chat's system prompt at the
// active intensity, persists /aftermath mode switches, and runs lightweight
// failure-signal detectors (test green→red, repeat error, destructive command,
// user correction) that append the matching on-demand skill pointer.
// Reuses the shared instruction builder so Claude Code, Codex, and OpenCode
// all read one source of truth.
//
// OpenCode loads this as a server plugin — add it to your opencode.json:
// { "plugin": ["./.opencode/plugins/aftermath.mjs"] }

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { getAftermathInstructions } = require('../../hooks/aftermath-instructions');
const aftermathConfig = require('../../hooks/aftermath-config');
const { parseCommandFile } = require('./aftermath-frontmatter.cjs');
const signals = require('../../hooks/aftermath-signals.cjs');

const { readMode, writeMode, normalizePersistedMode, containsCorrectionSignal } =
  aftermathConfig;

// In-memory pending signals. Consumed (and cleared) by the next
// experimental.chat.system.transform so the reminder lands in-context.
function createSignalStore() {
  return {
    testRegression: false,
    testTransition: null, // 'green->red' | 'red' | null
    retryLoop: false,
    destructiveCommand: null,
    correction: false,
    scopeWatch: false,
    lastErrorFingerprint: null,
    lastTestResult: null, // 'pass' | 'fail' | null
    lastEditAt: null,
  };
}

const pending = createSignalStore();

function excerpt(text, max = 400) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export default async ({ client } = {}) => {
  const log = (level, message) => {
    try {
      client && client.app && client.app.log({ body: { service: 'aftermath', level, message } });
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
        for (const file of fs.readdirSync(commandDir).filter((f) => f.endsWith('.md'))) {
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
      if (pending.retryLoop) {
        extra +=
          '\n\nAFTERMATH SIGNAL: same error recurred. Load the `retry-loop` skill: stop varying the fix, state exact error + theory, ask.';
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
      if (pending.scopeWatch) {
        extra +=
          '\n\nAFTERMATH SIGNAL: recent edits touched files outside the stated scope. Run an `/aftermath-audit` pass before continuing.';
      }

      const block = instructions + extra;
      if (output.system.length > 0) {
        output.system[output.system.length - 1] += '\n\n' + block;
      } else {
        output.system.push(block);
      }

      // Consumed — clear one-shot flags (fingerprints and test history persist).
      pending.testRegression = false;
      pending.testTransition = null;
      pending.retryLoop = false;
      pending.destructiveCommand = null;
      pending.correction = false;
      pending.scopeWatch = false;
    },

    // Persist `/aftermath <mode>` so the next turn's injection follows it.
    'command.execute.before': async (input) => {
      if (!input || input.command !== 'aftermath') return;
      const args = String(input.arguments || '').trim();
      if (!args) return; // bare /aftermath just reports via its template
      const mode = normalizePersistedMode(args.split(/\s+/)[0]);
      if (!mode) return;
      writeMode(mode);
      log('info', 'aftermath ' + mode);
    },

    // Watch user messages for correction signals.
    event: async (input) => {
      try {
        const type = input && (input.type || input.event || '');
        const text =
          (input && (input.text || input.prompt || input.message || input.data || '')) || '';
        const blob = typeof text === 'string' ? text : JSON.stringify(text);
        if (/chat\.message|prompt|message/i.test(String(type)) && containsCorrectionSignal(blob)) {
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

    // Destructive-command tripwire (rung 4). v1 surfaces a STOP reminder via
    // the next system transform; it does not hard-block execution.
    'tool.execute.before': async (input) => {
      try {
        if (!input || input.tool !== 'bash') return;
        const cmd = (input.args && (input.args.command || input.args.cmd)) || input.command || '';
        if (!cmd) return;
        if (signals.isDestructiveCommand(String(cmd))) {
          const mode = readMode();
          if (mode === 'off' || mode === 'lite') return;
          pending.destructiveCommand = String(cmd);
          log('warn', 'aftermath: destructive command tripwire: ' + excerpt(cmd, 200));
        }
      } catch (_) {
        // tripwire must never break tool execution
      }
    },

    // Test green→red + repeat-error detectors (rungs 2–3) and scope tripwire.
    'tool.execute.after': async (input, output) => {
      try {
        const mode = readMode();
        if (mode === 'off') return;
        const tool = input && input.tool;

        if (tool === 'edit' || tool === 'write') {
          pending.lastEditAt = Date.now();
          return;
        }

        if (tool !== 'bash') return;
        const cmd =
          (input.args && (input.args.command || input.args.cmd)) || input.command || '';
        const outText =
          (output && (output.output || output.text || output.result || output.error)) || '';
        const blob = excerpt(String(outText), 4000);

        // Test signal.
        if (signals.isTestCommand(String(cmd))) {
          if (signals.indicatesTestFailure(blob)) {
            pending.testRegression = true;
            pending.testTransition = pending.lastTestResult === 'pass' ? 'green->red' : 'red';
            pending.lastTestResult = 'fail';
            log('warn', 'aftermath: test failure signal (' + (pending.testTransition || 'red') + ')');
          } else if (String(blob).trim()) {
            pending.lastTestResult = 'pass';
          }
        }

        // Repeat-error signal: fingerprint stderr-ish output, compare.
        if (blob && /error|fail|exception|traceback/i.test(blob)) {
          const fp = signals.fingerprintError(blob);
          if (signals.isRepeatError(pending.lastErrorFingerprint, fp)) {
            pending.retryLoop = true;
            log('warn', 'aftermath: repeat-error signal');
          }
          pending.lastErrorFingerprint = fp;
        }
      } catch (_) {
        // detectors must never break the session
      }
    },
  };
};

// Exported for tests (via dynamic import of the module is awkward, so tests
// target hooks/aftermath-signals.cjs directly). Kept here for documentation.
export { pending };
