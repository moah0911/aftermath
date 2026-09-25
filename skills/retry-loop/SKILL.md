---
name: retry-loop
description: >
  Use when the same error message recurs after a fix attempt, or this is the
  2nd+ try at the same fix. Stop varying the fix, state the exact error and
  the theory, then ask instead of trying a third variation.
license: MIT
---

# Retry Loop

Same error twice means the theory is wrong, not the formatting.

1. Stop. No third variation.
2. Paste the exact error verbatim — not a paraphrase.
3. State the current theory in one line, labeled as theory until verified.
4. State what was already tried (attempt 1, attempt 2) and what each attempt proved.
5. Ask: confirm theory with the user, or request the missing fact (log, version, repro step) instead of guessing it.
6. One deliberate next step only after the answer. If it fails identically, return to step 2 — do not widen scope.

Forbidden: varying imports, flags, or syntax hoping the error changes shape; filling a missing fact with a guess; touching files outside the failing path to "see if it helps". Gap-filling must be said out loud.
