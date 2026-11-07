## Verification Plan

<!--
  Added by the Integrated TDD preset and filled by the plan stage as a Phase 1 output.
  The heading text, the three sub-headings and the three header rows are fixed: a check
  script reads them. Replace the example rows. This section holds no status: what is
  verified is derived from the evidence in tdd-evidence.md, never written here.
-->

### Verification commands

<!--
  The ways this project already runs its tests, taken from what the project defines
  (package scripts, a Makefile, CI configuration, contributor documentation).
  ID: short, lowercase letters, digits and hyphens. Command: in backticks, with at most
  one {select} where a test selector goes. Scope: focused (run per increment) or broad
  (run at checkpoints). Source: where the project defines the command.
  A project with no way to run tests writes a single `None` row: the ID is None and the
  other cells are -. The checks then run in no-tooling mode, and nothing is reported as
  verified by tests. Never invent a command or choose a test framework.
-->

| ID | Command | Scope | Source |
|----|---------|-------|--------|
| [id] | `[the project's own command, with {select} where a selector goes]` | focused | [where it is defined] |
| [id] | `[the project's own command for the whole suite]` | broad | [where it is defined] |

### Verification obligations

<!--
  One row per scenario that must be verified. ID: VO- and three digits, numbered in
  order of creation and never reused. Requirements: the FR-, SC- and acceptance scenario
  ids (USn-ASm, scenario m of user story n) from spec.md that the row verifies, with
  DC-nn for a design constraint and EC-nn for an edge case, each stated in the Scenario
  cell. Expected outcome: what must be observed, stated without reference to how the code
  will be written. Level: unit, integration, contract, end-to-end or other. Origin:
  planned, or discovered when added during implementation.
-->

| ID | Requirements | Scenario | Expected outcome | Level | Origin |
|----|--------------|----------|------------------|-------|--------|
| VO-001 | [FR-001, US1-AS1] | [The situation to test, in terms of behaviour] | [What must be observed] | [level] | planned |

### Verification exemptions

<!--
  One row per requirement that will not be verified automatically, with the reason and
  how it is verified instead (or none, with why). A single row reading None in the
  Requirement column when there are no exemptions.
-->

| Requirement | Reason | Alternative verification |
|-------------|--------|--------------------------|
| None | - | - |

### Manual verification

<!--
  This heading is read by the checks and must be kept. One row per check that a person
  does by hand because it cannot be automated: a visual layout, a judgement of wording,
  a step in an external system. ID: MV- and three digits. Covers: the FR-, SC-, USn-ASm,
  DC- or EC- ids, or the VO- ids, that the check is about. A single None row when there
  are no manual checks. A person records the result with the manual subcommand; the plan
  holds no result.
-->

| ID | Covers | Steps | Expected result | Why not automated |
|----|--------|-------|-----------------|-------------------|
| None | - | - | - | - |

### Behaviour checklist

<!--
  This heading is read by the checks and must be kept: it switches the behaviour checklist
  rules on for this feature. The plan stage writes the checklist itself to
  tests/behaviour-checklist.md; keep the line below as it is.
-->

Behaviour items are in [tests/behaviour-checklist.md](tests/behaviour-checklist.md).
