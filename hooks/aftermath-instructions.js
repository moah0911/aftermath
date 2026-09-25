#!/usr/bin/env node
// Shared Aftermath instruction builder for host adapters.
// Single source of truth: skills/aftermath/SKILL.md. Adapters never copy rules.

const fs = require('fs');
const path = require('path');
const { DEFAULT_MODE, normalizeMode } = require('./aftermath-config');

const SKILL_PATH = path.join(__dirname, '..', 'skills', 'aftermath', 'SKILL.md');

function filterSkillBodyForMode(body, mode) {
  const effectiveMode = normalizeMode(mode) || DEFAULT_MODE;
  const withoutFrontmatter = String(body || '').replace(/^---[\s\S]*?---\s*/, '');

  // Only intensity table rows and worked examples are mode-specific, both keyed
  // by a mode name (lite/full/ultra). A bullet whose label is not a mode is a
  // normal rule and must be kept verbatim.
  return withoutFrontmatter
    .split(/\r?\n/)
    .filter((line) => {
      const tableLabel = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|/);
      if (tableLabel) {
        const labelMode = normalizeMode(tableLabel[1].trim());
        if (labelMode) return labelMode === effectiveMode;
      }
      // Every worked example is `- lite: "..."` (quoted value required).
      // Without the quote check, prose like "- Full: ..." would be dropped.
      const exampleLabel = line.match(/^-\s*([^:]+):\s*"/);
      if (exampleLabel) {
        const labelMode = normalizeMode(exampleLabel[1].trim());
        if (labelMode) return labelMode === effectiveMode;
      }
      return true;
    })
    .join('\n');
}

function getFallbackInstructions(mode) {
  const effectiveMode = normalizeMode(mode) || DEFAULT_MODE;
  return (
    'AFTERMATH MODE ACTIVE — level: ' +
    effectiveMode +
    '\n\n' +
    'Post-failure recovery. Stop at the first rung that holds:\n' +
    '1. Uncommitted / one file / cheap to undo? → Revert now. Do not patch forward.\n' +
    '2. Last-known-good exists? → Diff it, isolate one change, revert just that.\n' +
    '3. 2nd+ failed attempt at same fix? → Stop varying. State exact error, state theory, ask.\n' +
    '4. Next action irreversible (force push, drop, delete, overwrite)? → Confirm state explicitly. Never assume.\n' +
    '5. Filling a gap with a guess? → Say so out loud. Never continue silently.\n' +
    '6. User just corrected you? → Do not defend. Find the diff. Fix only that.\n\n' +
    'Honesty: never hide a break. Never silently revert (at full and above, announce every revert). Never invent an unverified root cause.\n\n' +
    'Current level: **' +
    effectiveMode +
    '**. Switch: `/aftermath lite|full|ultra|off`.\n' +
    'Persistence: ACTIVE EVERY RESPONSE until failure is resolved or mode changes. Off only via `/aftermath off`.'
  );
}

function getAftermathInstructions(mode) {
  const { normalizePersistedMode } = require('./aftermath-config');
  const configuredMode = normalizePersistedMode(mode) || DEFAULT_MODE;
  if (configuredMode === 'off') return '';
  try {
    const raw = fs.readFileSync(SKILL_PATH, 'utf8');
    return (
      'AFTERMATH MODE ACTIVE — level: ' +
      configuredMode +
      '\n\n' +
      filterSkillBodyForMode(raw, configuredMode)
    );
  } catch (_) {
    return getFallbackInstructions(configuredMode);
  }
}

module.exports = {
  filterSkillBodyForMode,
  getFallbackInstructions,
  getAftermathInstructions,
};
