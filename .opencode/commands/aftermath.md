---
description: Set Aftermath intensity (lite, full, ultra, off) or report the current level.
---

$ARGUMENTS

With no argument, report the current Aftermath level and restate the six-rung ladder in one compact block. Include enforcement state: at full/ultra destructive commands and forward edits are blocked while a failure is unresolved; checkpoints are active at ultra only when `autoRevert: true`.

With `lite`, `full`, `ultra`, or `off`: confirm the switch in one line (`Aftermath <mode>.`), then behave at that level from the next message on:
- lite: flag problems, suggest the revert, let the user decide. No blocks or auto-revert.
- full (default): stop forward motion on failure, block destructive commands and forward edits, run the diff/isolate diagnostic, ask before the next edit.
- ultra: same guards as full, plus checkpoint auto-revert when `autoRevert: true`; report what was restored and what conflicted.
- off: disabled, behave normally.

Requested level: $ARGUMENTS
