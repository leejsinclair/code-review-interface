---
description: Perform a non-destructive cross-artifact consistency and quality analysis across spec.md, plan.md, and tasks.md after task generation, including verification coverage findings.
strategy: wrap
---

<!-- markdownlint-disable-file MD041 -->

> **Integrated TDD: verification coverage is part of the analysis.**
>
> First check that `.specify/extensions/integrated-tdd/scripts/python/tdd_check.py`
> exists. If it does not exist, the `integrated-tdd` extension is not installed: say so
> in the analysis report, ignore the rest of this note and the "Verification coverage
> findings" section at the end of this command, and carry on as core Spec Kit would.
>
> Otherwise read `.specify/extensions/integrated-tdd/templates/tdd-process-rules.md` in
> full. The analysis report must also include the findings of the two verification
> checks, as "Verification coverage findings" at the end of this command describes. This
> stage stays read-only: it reports and modifies nothing.

{CORE_TEMPLATE}

## Verification coverage findings

This section adds to the analysis report. Skip it when the extension is not installed, as
the note at the top of this command says.

1. **If the feature's `plan.md` has no Verification Plan**, the feature was planned before
   the process applied and is not under it. Report that as a gap at the start of the
   analysis report and again in its summary, name `__SPECKIT_COMMAND_PLAN__` as the way
   to bring the feature under the process, run neither check, and carry on as the core
   analysis. Do not describe the feature's work as verified.

2. **If `plan.md` has a Verification Plan with no `### Behaviour checklist` sub-heading
   and the feature has no `tests/behaviour-checklist.md`**, the feature was planned before
   the behaviour checklist existed. Report that as a gap at the start of the analysis
   report and again in its summary, name `__SPECKIT_COMMAND_PLAN__` as the way to add the
   checklist, and carry on with the checks below: no checklist rule applies to it.

3. **Otherwise run both checks** from the repository root:

   ```bash
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py plan
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py tasks
   ```

   The first checks the Verification Plan against the specification: every functional
   requirement and acceptance scenario has an obligation or an exemption (C1), and every
   obligation and exemption is complete and names known requirements. The second checks
   the task list against the Verification Plan: every task is labelled (G1), and every
   obligation has a test task ahead of a behaviour task (C2, C3).

   When the behaviour checklist applies, the first check also covers it (B1 to B6) and the
   second adds B7: every requirement and acceptance scenario is named by an item (B1),
   every item names obligations or exemptions the plan holds (B2), every obligation is
   named by an item (B3), the checklist's format holds (B4), no item names a code element
   the design introduces (B5), every id and scenario quote matches the specification (B6),
   and every test task traces to an item (B7). A missing checklist is reported as
   `CHECKLIST`. Together these are the findings B1 to B7.

   The first check also covers the Manual verification table: each manual check is complete
   and has a unique id (M1), and covers requirements the specification or the plan holds
   (M2). When the feature has an evidence document, add its standing deferrals and manual
   checks: a deferral that no approval covers where one is needed is G12, and compliance
   rule C9 gives a notice for each deferred obligation and each open or failed manual
   check. Notices are not findings: copy each into the report under "Verification
   coverage" as a notice, and do not count it among the issues.

4. **Report the findings.** Add each finding to the analysis report under a "Verification
   coverage" heading, exactly as the check printed it, with the rule identifier, and count
   it among the report's issues. When both checks exit 0, say so in one line.

5. **Modify nothing.** Do not correct `plan.md`, `tasks.md` or the behaviour checklist
   here. Name the stage that corrects each finding: `__SPECKIT_COMMAND_PLAN__` for the
   Verification Plan and the behaviour checklist, and `__SPECKIT_COMMAND_TASKS__` for the
   task list.
