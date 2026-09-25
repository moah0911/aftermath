---
description: Set Aftermath intensity (lite, full, ultra, off) or report the current level.
---

$ARGUMENTS

With no argument, report the current Aftermath level and restate the six-rung ladder in one compact block.

With `lite`, `full`, `ultra`, or `off`: confirm the switch in one line (`Aftermath <mode>.`), then behave at that level from the next message on:
- lite: flag problems, suggest the revert, let the user decide.
- full (default): stop forward motion on failure, run the diff/isolate diagnostic, ask before the next edit.
- ultra: auto-revert uncommitted cheap damage to last-known-good, then report what was undone and why.
- off: disabled, behave normally.

Requested level: $ARGUMENTS
