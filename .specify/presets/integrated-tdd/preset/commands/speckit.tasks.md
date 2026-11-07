---
description: Generate an actionable, dependency-ordered tasks.md for the feature based on available design artifacts, with every task labelled against the Verification Plan and test tasks ordered first.
strategy: wrap
---

<!-- markdownlint-disable-file MD041 -->

> **Integrated TDD: test tasks are required.**
>
> First check that `.specify/extensions/integrated-tdd/scripts/python/tdd_check.py`
> exists. If it does not exist, the `integrated-tdd` extension is not installed: say so
> now and again in the Completion Report, ignore the rest of this note and the
> "Verification labels and order" section at the end of this command, and carry on as core
> Spec Kit would.
>
> Otherwise read `.specify/extensions/integrated-tdd/templates/tdd-process-rules.md` in
> full, then read the `## Verification Plan` section of the feature's `plan.md`.
>
> - **If `plan.md` has no Verification Plan**, the feature was planned before the process
>   applied and is not under it. State this gap now and again in the Completion Report,
>   name `__SPECKIT_COMMAND_PLAN__` as the way to bring the feature under the process,
>   and then carry on as core Spec Kit would, without verification labels and without
>   running the check. Do not describe the feature's work as verified.
> - **If `plan.md` has a Verification Plan with no `### Behaviour checklist` sub-heading
>   and the feature has no `tests/behaviour-checklist.md`**, the feature was planned before
>   the behaviour checklist existed. State this gap now and again in the Completion Report,
>   name `__SPECKIT_COMMAND_PLAN__` as the way to add the checklist, and carry on as
>   before: generate and check the task list against the Verification Plan, with no
>   checklist rule applied. Do not describe the feature's behaviour as covered by a
>   checklist.
> - **Otherwise** run the `plan` check first, from the repository root:
>   `python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py plan`.
>   If it exits non-zero, stop: do not generate tasks while the plan check fails, because
>   tasks written over a failing plan inherit its gaps. Report the findings, name
>   `__SPECKIT_COMMAND_PLAN__` as the stage that corrects them, and generate nothing.
> - **If the plan records no test tooling** (a single `None` row in Verification commands),
>   the plan check passes and the task list is generated as usual. State plainly now and in
>   the Completion Report that the project has no test tooling and that nothing is verified
>   by tests.
> - **Otherwise**, with the plan check passing, test tasks are not optional. This overrides the statement below that
>   "Tests are OPTIONAL" and every instruction to generate test tasks only on request:
>   every obligation in the Verification Plan gets a test task, placed before the task
>   that delivers the behaviour, as "Verification labels and order" at the end of this
>   command describes. Do not report the task list complete while its check fails.

{CORE_TEMPLATE}

## Verification labels and order

This section adds to **Generate tasks.md**. Skip it when the extension is not installed
or when `plan.md` has no Verification Plan, as the note at the top of this command says.

1. **Label every task.** After the story label and before the description, each task
   carries either `[VO-nnn]` for each obligation it satisfies, or `[NT: reason]` when it
   has no behaviour to verify (documentation, configuration with no observable effect,
   project setup). The reason is required. The rest of the task line is unchanged.

2. **Generate a test task ahead of each behaviour task.** For each obligation in the
   Verification Plan, write a task that creates or updates the failing test, and after it
   the task or tasks that deliver the behaviour. Both carry the obligation's label. The
   first task in the file to name an obligation is its test task whatever its description
   says, so write the test task first. Every obligation is named by at least two tasks.

3. **Keep the test work close to the behaviour.** Order tasks so that each test task is
   followed by its behaviour task within the same user story phase. Do not gather all
   test tasks at the start: tests are written one increment at a time.

4. **Keep the conventions.** `TASKS_TEMPLATE` ends with a "Verification labels" section.
   Keep it in the generated `tasks.md`.

5. **Check**: from the repository root run

   ```bash
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py tasks
   ```

   Each finding names a rule and a task or obligation: a task without a label (G1), a
   label naming an obligation the plan does not hold, an obligation without a test task
   and a behaviour task (C2), behaviour ordered before its test (C3), or, when the
   behaviour checklist applies, a test task whose obligations no behaviour item names
   (B7) or a checklist that is missing (`CHECKLIST`). A B7 finding means a test task
   traces to no item: correct the label if it is wrong, and otherwise return to
   `__SPECKIT_COMMAND_PLAN__` to add the item. Correct
   `tasks.md` and run the check again until it exits 0. Do not report completion while it
   exits non-zero.

In the Completion Report, state the number of test, behaviour and no-test tasks and the
result of the check. When the plan records no test tooling, also say that the project has no
test tooling and that nothing is verified by tests.
