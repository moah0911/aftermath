'use strict';

// aftermath — path-aware destructive policy.
//
// Default is block. A filesystem destructive command is allowed only when every
// target is a literal, relative path inside the project, under a configured
// safePath, and not under any protectedPath. Everything else (git reset --hard,
// force push, database drops, unknown/dynamic targets) stays blocked unless the
// command matches destructiveAllowlist.

const fs = require('fs');
const path = require('path');
const { isDestructiveCommand } = require('./aftermath-signals.cjs');

const SHELL_CONTROL = /[;&|<>`\n]|\$\(/;
const DYNAMIC_TOKEN = /[$*?[\]{}~`\\]/;

function tokenize(command) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (const char of String(command || '')) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (quote) return null;
  if (current) tokens.push(current);
  return tokens;
}

function parseRmTargets(tokens) {
  if (!tokens || tokens[0] !== 'rm') return null;
  const targets = [];
  let literal = false;
  for (const token of tokens.slice(1)) {
    if (!literal && token === '--') {
      literal = true;
      continue;
    }
    if (!literal && token.startsWith('-') && token !== '-') continue;
    targets.push(token);
  }
  return targets;
}

function parseFindTargets(tokens) {
  if (!tokens || tokens[0] !== 'find') return null;
  if (!tokens.includes('-delete')) return null;
  const targets = [];
  for (const token of tokens.slice(1)) {
    if (token.startsWith('-') || token === '(' || token === '!') break;
    targets.push(token);
  }
  return targets;
}

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function realPathIfPossible(target) {
  try {
    return fs.realpathSync(target);
  } catch (_) {
    try {
      return path.join(
        fs.realpathSync(path.dirname(target)),
        path.basename(target)
      );
    } catch (_) {
      return target;
    }
  }
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeRel(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

function matchesProtected(rel, patterns) {
  const normalized = normalizeRel(rel);
  if (!normalized) return false;
  const base = path.posix.basename(normalized);
  for (const raw of patterns) {
    const pattern = normalizeRel(raw);
    if (!pattern) continue;
    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.split('*').map(escapeRegex).join('[^/]*') + '$'
      );
      if (regex.test(normalized) || regex.test(base)) return true;
      continue;
    }
    if (normalized === pattern || normalized.startsWith(pattern + '/')) {
      return true;
    }
  }
  return false;
}

function block(reason, target) {
  return {
    destructive: true,
    decision: 'block',
    reason,
    target: target || null,
    targets: target ? [target] : [],
  };
}

function evaluateDestructiveCommand(cmd, policy = {}) {
  const text = String(cmd || '');
  if (!isDestructiveCommand(text)) {
    return {
      destructive: false,
      decision: 'allow',
      reason: 'not-destructive',
      target: null,
      targets: [],
    };
  }

  const allowlist = Array.isArray(policy.destructiveAllowlist)
    ? policy.destructiveAllowlist
    : [];
  const lower = text.toLowerCase();
  if (
    allowlist.some(
      (entry) =>
        typeof entry === 'string' &&
        entry.trim() &&
        lower.includes(entry.trim().toLowerCase())
    )
  ) {
    return {
      destructive: true,
      decision: 'allow',
      reason: 'explicit-allowlist',
      target: null,
      targets: [],
    };
  }

  const projectRoot = policy.projectRoot
    ? path.resolve(policy.projectRoot)
    : null;
  if (!projectRoot) return block('no-project');
  if (SHELL_CONTROL.test(text)) return block('complex-shell');

  const tokens = tokenize(text);
  if (!tokens) return block('unterminated-quote');
  const targets = parseRmTargets(tokens) || parseFindTargets(tokens);
  if (!targets) return block('non-path-destructive');
  if (targets.length === 0) return block('unknown-target');

  const safePaths = (Array.isArray(policy.safePaths) ? policy.safePaths : [])
    .filter((entry) => typeof entry === 'string' && entry.trim())
    .map((entry) => path.resolve(projectRoot, entry.trim()));
  const protectedPaths = (
    Array.isArray(policy.protectedPaths) ? policy.protectedPaths : []
  ).filter((entry) => typeof entry === 'string' && entry.trim());

  for (const target of targets) {
    if (!target || DYNAMIC_TOKEN.test(target)) {
      return block('dynamic-target', target);
    }
    if (path.isAbsolute(target)) {
      return block('outside-project', target);
    }
    const lexical = path.resolve(projectRoot, target);
    if (!isInside(projectRoot, lexical)) {
      return block('outside-project', target);
    }
    const real = realPathIfPossible(lexical);
    if (!isInside(projectRoot, real)) {
      return block('outside-project', target);
    }
    const rel = path.relative(projectRoot, real);
    if (matchesProtected(rel, protectedPaths)) {
      return block('protected-path', target);
    }
    const safe = safePaths.some((dir) => isInside(dir, real));
    if (!safe) return block('unknown-target', target);
  }

  return {
    destructive: true,
    decision: 'allow',
    reason: 'safe-artifact',
    target: null,
    targets,
  };
}

module.exports = {
  evaluateDestructiveCommand,
  tokenize,
  parseRmTargets,
  parseFindTargets,
  matchesProtected,
  isInside,
};
