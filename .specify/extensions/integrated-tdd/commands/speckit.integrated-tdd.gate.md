---
description: "Runtime event handler for the Integrated TDD task gate. Not a command to invoke."
scripts:
  py: scripts/python/tdd_check.py hook
---

# Integrated TDD task gate

This file is run by the coding agent's runtime, through Spec Kit's event dispatcher, before
a file edit is carried out. It is not a command to invoke, and it is not listed among the
extension's commands.

The dispatcher reads the `scripts:` entry above and runs the check script's `hook`
subcommand with the tool call on standard input. The script allows the edit, or refuses it
and says why. What it refuses is described in the extension's process rules,
`templates/tdd-process-rules.md`.
