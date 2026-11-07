---
description: Execute the implementation planning workflow using the plan template to generate design artifacts, including the Verification Plan that states how each requirement will be verified.
strategy: wrap
---

<!-- markdownlint-disable-file MD041 -->

> **Integrated TDD: additional Phase 1 deliverable.**
>
> First check that `.specify/extensions/integrated-tdd/scripts/python/tdd_check.py`
> exists. If it does not exist, the `integrated-tdd` extension is not installed: say so
> now and again in the Completion Report, ignore the rest of this note and the
> "Verification Plan" section at the end of this command, and carry on as core Spec Kit
> would.
>
> Otherwise read `.specify/extensions/integrated-tdd/templates/tdd-process-rules.md` in
> full before planning. This planning run must also fill the `## Verification Plan`
> section of the plan, and write the behaviour checklist, `tests/behaviour-checklist.md`,
> as described in "Verification Plan" at the end of this command. Both are Phase 1 outputs
> alongside `data-model.md`, `contracts/` and `quickstart.md`: complete them before the
> post-design Constitution Check, the post-execution hooks and the Completion Report, and
> do not report the plan complete while its check fails.

{CORE_TEMPLATE}

## Verification Plan

This section adds a step to **Phase 1: Design & Contracts**. Run it after `data-model.md`
and `contracts/` are written, because verification takes account of them. Skip it when
the extension is not installed, as the note at the top of this command says.

`IMPL_PLAN` already ends with a `## Verification Plan` section holding three tables. Keep
the heading, the three sub-headings and the three header rows exactly as they are, and
replace the example rows. Follow the "Verification intent" rules in the process rules.

1. **Verification commands**: find how the project already runs its tests, in its package
   scripts, Makefile, CI configuration or contributor documentation. Record each command
   with a short id, the command line in backticks (with `{select}` where a test selector
   goes), a scope of `focused` or `broad`, and where the project defines it. Declare at
   least one `broad` command. If the project has no way to run tests, write a single `None`
   row, say plainly that the project has no test tooling and that nothing will be verified
   by tests, say that the process never chooses a framework and that declaring a command
   later switches the checks on, and carry on with the remaining steps. Do not invent a
   command, choose a test framework or stop.

2. **Edge case labels**: obligations and items cite edge cases by id, and the check accepts
   an `EC-` id only if FEATURE_SPEC holds it. If FEATURE_SPEC's edge cases carry no ids,
   label them `EC-01`, `EC-02`, in the order they appear, by adding the label at the start
   of each edge case in FEATURE_SPEC. Do this before writing the obligations: change no
   other word of the specification, name the labels in the Completion Report so the
   developer can see the edit, and never name an `EC-` id that FEATURE_SPEC does not hold.

3. **Verification obligations**: for every functional requirement (`FR-`) and every
   acceptance scenario (`USn-ASm`, scenario `m` of user story `n`) in FEATURE_SPEC, write
   the scenarios that verify it and what must be observed, stated without reference to the
   implementation. Add obligations for edge cases and failure conditions, and for the
   interfaces, data integrity rules, security requirements and integration boundaries in
   the design, in proportion to the scope, risk and complexity of the change. Choose a
   level for each. Number them `VO-001`, `VO-002`, ... and set Origin to `planned`. For a
   small, low-risk change write one obligation per requirement and per acceptance
   scenario, and no more: not one per assertion, and not for a property the specification
   does not state. Before writing an obligation, ask whether the change gives anything to
   test. When a requirement or an edge case states that existing behaviour stays unchanged
   and the change gives no way to vary it, write no obligation for it: a test would only
   restate how the language works. Exempt it instead, as step 4 says, and do not put it to
   the developer as an ambiguity; if the change does add a way to vary it, write an
   obligation as usual.

4. **Verification exemptions**: for a requirement that cannot sensibly be verified
   automatically, add a row with the reason and how it is verified instead. Write a single
   `None` row when there are no exemptions. For a requirement or an edge case that states
   that existing behaviour stays unchanged where the change gives no way to vary it, the
   reason is "unchanged by construction: the change gives no way to vary it" and the
   alternative is a review of the diff. Give it a behaviour item whose Verified by is that
   exemption (step 6), and name it in the Completion Report so the developer can overrule it.

5. **Manual verification**: for each requirement or edge case that a person must check by
   hand because no automated test can, add a row to the `### Manual verification` table
   with the requirement ids it covers, the steps, the expected result and why it is not
   automated. When `IMPL_PLAN` has no such sub-heading, add it after the exemptions table.
   Write a single `None` row when there are none. Record no result: a person does that
   later with `manual`.

6. **Behaviour checklist**: write `tests/behaviour-checklist.md` in FEATURE_DIR, after the
   three tables, following "Behaviour checklist" in the process rules. When `IMPL_PLAN`'s
   Verification Plan has no `### Behaviour checklist` sub-heading, add it after the
   exemptions table, followed by this line exactly:

   ```text
   Behaviour items are in [tests/behaviour-checklist.md](tests/behaviour-checklist.md).
   ```

   Spec Kit does not copy the template again when `IMPL_PLAN` already exists. Copy
   `.specify/extensions/integrated-tdd/templates/behaviour-checklist-template.md` to
   `FEATURE_DIR/tests/behaviour-checklist.md`, creating `tests/` if needed, replace the
   example sections, and fill it from FEATURE_SPEC and the obligations and exemptions just
   written. Do not put it in `checklists/`.

7. **Material ambiguity**: if a requirement is ambiguous, or contradicts another, in a way
   that changes what a test should assert, stop and ask the developer. Do not choose an
   interpretation. Leave that requirement without an obligation until the question is
   answered, record the answer under `## Clarifications` in FEATURE_SPEC, and then write
   the obligation.

8. **Check**: from the repository root run

   ```bash
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py plan
   ```

   The check covers the Manual verification table and the behaviour checklist as well as the
   Verification Plan. Each finding
   names a rule and a requirement, obligation or item. Correct the Verification Plan or the
   checklist and run the check again until it exits 0. Do not report the plan complete while it
   exits non-zero: say which findings remain and why, for example a question waiting for
   the developer.

In the Completion Report, state the number of obligations, exemptions and manual checks, the
verification commands found and where they came from (or that the project has no test
tooling and nothing will be verified by tests), the location of the behaviour checklist
(`tests/behaviour-checklist.md`) with the number of sections and items, and the result of
the check. Ask for the checklist to be reviewed against the specification, and name
`tdd_check.py status --scenarios` as the way to read each scenario's quote beside its
items. No approval is requested and nothing waits for one: report the plan complete when
the check passes.
