# Behaviour Checklist: <feature directory name>

<!--
  Written by the plan stage from spec.md and the Verification Plan in plan.md, before
  tasks and implementation. Read by tdd_check.py; the rules are in the "Behaviour
  checklist" section of tdd-process-rules.md.
  - One "## USn-ASm" section per acceptance scenario of spec.md, in order, opening with
    the scenario's text from spec.md as a block quote, word for word.
  - One "## Other behaviours" section, when needed, for items that refine no scenario.
  - Items state what can be observed from outside: what a user sees or can do, what a
    caller receives, what is stored and can be read back, what is refused. They name no
    file, module, function, class, table, endpoint or screen component.
  - No checkboxes and no status: what is verified is derived from tdd-evidence.md.
-->

**Specification**: [spec.md](../spec.md) | **Verification Plan**: [plan.md](../plan.md#verification-plan) | **Tasks**: [tasks.md](../tasks.md)

## US1-AS1

> **Given** [the scenario's context, copied from spec.md], **When** [its action], **Then** [its outcome]

- **BI-001** Expresses: FR-001, US1-AS1. Verified by: VO-001.
  - **Given** [the context, in the specification's terms, with concrete values]
  - **When** [the action]
  - **Then** [an observable outcome]
  - **And** [a further outcome of the same action]

## Other behaviours

- **BI-002** Expresses: FR-002, EC-01. Verified by: VO-002.
  - **Given** [the context]
  - **When** [the action]
  - **Then** [the observable outcome]
