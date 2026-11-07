---
description: "Hook entry point: starts the grill as a nested run straight after specify"
---

# Specify Grill: entry point

This command is registered as the mandatory `after_specify` hook of the Specify Grill
extension. It exists so that the grill can be told it is running nested inside specify:
a hook entry cannot carry an argument, so this command supplies it.

## What to do

1. Invoke `__SPECKIT_COMMAND_GRILL_SPECIFY_WITH_DOCS__` with the single argument
   `--nested`, in this same session, and wait for it to finish. Do not ask for permission
   first; the hook is mandatory.
2. When it ends it prints one block whose first line starts `GRILL OUTCOME:`. Carry that
   block into specify's Completion Report **unchanged**: do not reword it, shorten it or
   add to it.
3. **Do not stop here.** You are in the middle of specify's "Mandatory Post-Execution
   Hooks" step. Go back to it and continue: run every remaining `after_specify` hook, in
   order, exactly as specify instructs, and wait for each. Only after the last hook give
   specify's Completion Report, with the outcome block in it. Ending your turn straight
   after the outcome block, with other hooks still unrun, is a mistake.

## What not to do

- Do not ask the developer anything yourself. All questions belong to the grill.
- Do not invoke any specify hook, and do not start specify again.
- Do not write any file. This command writes nothing.
