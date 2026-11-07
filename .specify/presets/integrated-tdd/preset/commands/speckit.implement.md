---
description: Execute the implementation plan by processing and executing all tasks defined in tasks.md, each through the Red, Green, Refactor cycle with recorded evidence.
strategy: wrap
---

<!-- markdownlint-disable-file MD041 -->

> **Integrated TDD: tasks are completed through the Red, Green, Refactor cycle.**
>
> First check that `.specify/extensions/integrated-tdd/scripts/python/tdd_check.py`
> exists. If it does not exist, the `integrated-tdd` extension is not installed: say so
> now and again in the Completion Report, ignore the rest of this note and the
> "Test-driven implementation" section at the end of this command, and carry on as core
> Spec Kit would.
>
> Otherwise read `.specify/extensions/integrated-tdd/templates/tdd-process-rules.md` in
> full, then read the `## Verification Plan` section of the feature's `plan.md`.
>
> - **If `plan.md` has no Verification Plan**, the feature was planned before the process
>   applied and is not under it. State this gap now and again in the Completion Report,
>   name `__SPECKIT_COMMAND_PLAN__` as the way to bring the feature under the process, and
>   then carry on as core Spec Kit would. Record no evidence, run no check, and never
>   describe the feature's work as verified.
> - **If `plan.md` has a Verification Plan with no `### Behaviour checklist` sub-heading
>   and the feature has no `tests/behaviour-checklist.md`**, the feature was planned before
>   the behaviour checklist existed. State this gap now and again in the Completion Report,
>   name `__SPECKIT_COMMAND_PLAN__` as the way to add the checklist, and carry on as
>   before: no checklist rule applies to it, and its evidence stays where it is.
> - **Otherwise** every task is completed through the cycle in "Test-driven
>   implementation" at the end of this command, which applies throughout "Execute
>   implementation" below. A task is marked `[X]` only after its gate passes: the edit that
>   marks it is refused until then. A refusal is a result to act on, not an obstacle to
>   get round: never mark a task by any other means, and never edit `tdd-evidence.md`
>   or `tests/tdd-evidence.md`, which only the check script writes.

{CORE_TEMPLATE}

## Test-driven implementation

This section governs how every task in the steps above is carried out. Skip it when the
extension is not installed or when `plan.md` has no Verification Plan, as the note at the
top of this command says.

`CHECK` stands for
`python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py`, run from the
repository root. Follow the process rules read at the start. Every test result reported in
this stage comes from `CHECK run`.

1. **Before the first task**, rerun the two planning checks and record a baseline:

   ```bash
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py plan
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py tasks
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py run --phase baseline --command <broad command id>
   ```

   If `plan` or `tasks` exits non-zero, stop and report the findings: the plan or the task
   list must be corrected by its own stage first. `plan` also covers the behaviour
   checklist, and the baseline is refused while the checklist fails, so a refusal means
   returning to the plan stage: the checklist is corrected there and not here. The baseline
   is written to `tests/tdd-evidence.md`, or to `tdd-evidence.md` where the feature
   already keeps its evidence there. If the baseline fails, name the tests
   that were already failing with `--note`; they are pre-existing and are kept apart from
   failures this work introduces.

2. **For each task**, by its labels:

   - **A test task** (the first task to name an obligation): write or update the test,
     state the text its failure should show, and record the failing run:

     ```bash
     python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py run --phase red --command <id> --select <selector> \
         --task <task id> --vo <obligation id> --tests <test file> --expect "<expected failure text>"
     ```

     Continue only when the run is recorded as valid. A pass on first run, or a failure
     for another reason, is not a Red step: investigate, correct the test, and run again.

   - **A behaviour task** (a later task naming the obligation): make the minimum change
     that satisfies the failing test, then record the passing run with `--phase green`,
     the task and the obligation. After any tidying, record `--phase refactor`. Run the
     existing tests that cover the area alongside the new one.

   - **A no-test task** (`[NT: reason]`): carry it out. It needs no run.

3. **Before marking a task complete**, check it:

   ```bash
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py gate --task <task id>
   ```

   Mark the task `[X]` in `tasks.md` only when the gate passes. If the edit is refused,
   read the findings: each names the rule and what is missing. Meet the rule, or record
   what the process rules allow in its place, and try again.

4. **At the end of each phase** of the task list, record a broad run:

   ```bash
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py run --phase checkpoint --command <broad command id>
   ```

   A failing checkpoint is a regression to investigate before the next phase.

5. **At the end of the stage**, after the last task:

   ```bash
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py gate --all
   ```

   Every completed task must pass. Resolve each finding before reporting completion.

### A test changed after its Red run

When `gate` reports **G5** for a task, a test file differs between the failing-first run
and the passing run. Do not change the test back and forth to clear the finding, and do
not weaken it to pass.

1. Decide what the change is. A **correction** brings the test into line with the approved
   requirements. Otherwise it **alters intended behaviour**.
2. Record it, naming the requirement it is justified against:

   ```bash
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py expectation --task <task id> \
       --tests <test file> --requirement <requirement id> --justification "<why>" [--alters-behaviour]
   ```

3. Where it alters intended behaviour, explain the change to the developer and ask for
   approval. Record the approval only after the developer has given it in the
   conversation, with the developer's name:

   ```bash
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py approve --id <XC-nn> --by "<name>"
   ```

   Until then the task stays incomplete (G8). Continue with tasks that do not depend on
   it.

### A behaviour item changed after the baseline

Behaviour items are fixed at the first recorded run. When `gate` reports **G10** for a
task, an item that the task's obligations verify has been changed or removed since then,
or its change awaits approval, or its id has been reused. Do not edit the item back and
forth to clear the finding.

1. Decide what the change is. A **correction** brings the item into line with the approved
   specification. Otherwise it **alters intended behaviour**. A removed item is a change
   too. An id is never reused: give a new behaviour a new id.
2. Record it, naming the requirement it is justified against:

   ```bash
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py expectation --item <item id> \
       --requirement <requirement id> --justification "<why>" [--alters-behaviour]
   ```

3. Where it alters intended behaviour, explain the change to the developer and ask for
   approval. Record the approval only after the developer has given it in the
   conversation, with the developer's name:

   ```bash
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py approve --id <BX-nn> --by "<name>"
   ```

   Until then the item's tasks stay incomplete (G10). Continue with tasks that do not
   depend on it.

Two other refusals come from the checklist:

- **A Red run is refused for an obligation that no behaviour item names.** Return to the
  checklist and add it to an existing or new item first: put it in an item's *Verified by*
  list, or write a new item, in `tests/behaviour-checklist.md`, rerun `plan`, and then
  record the run. Do this before the test is written.
- **A G11 finding on any task** means the checklist no longer passes the checks `plan`
  applies, for example because a requirement was added that no item names. Bring the
  specification, the Verification Plan and the checklist back into line: correct the
  specification or the Verification Plan first and then the checklist, rerun `plan`, and
  record any change to a fixed item with `expectation --item`. No task can be marked
  complete until `plan` passes again.

### Failures, exceptions and decisions

Follow "Failures, exceptions and decisions" in the process rules. In this stage:

1. **Classify each failure after investigating it.** A run that fails, other than a valid
   Red step, is recorded as `unclassified`. Find the cause, then record what it is:

   ```bash
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py classify --seq <record number> \
       --as <assertion|defect|environment|unreliable> --note "<what was found>"
   ```

   Resolve the failure before starting work that depends on it. An `environment` failure
   blocks the obligation; an `unreliable` test is reported as unreliable and is not rerun
   until it passes.

2. **Record an exception where the cycle does not fit the work**, with the rationale and
   the verification followed instead:

   ```bash
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py exception --task <task id> --vo <obligation id> \
       --kind <kind> --rationale "<why>" --alternative "<how it is verified instead>"
   ```

   The passing run is still required of the behaviour task. Exceptions of kind `legacy`,
   `exploratory` or `other`, and any with no alternative verification, need the
   developer's approval: explain the trade-off, ask, and record
   `approve --id <EX-nn> --by "<name>"` only after the developer has approved in the
   conversation. Give `--needs-approval` for any other exception that involves a
   consequential trade-off.

3. **Open a decision when work must wait for a person**, listing the affected task and
   every task that depends on it:

   ```bash
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py decision open \
       --question "<what is to be decided>" --tasks <task id> <task id>
   ```

   Hold only the tasks listed and continue with the others. Never proceed on an assumed
   answer. When every remaining task depends on an open decision, stop and report. When
   the developer answers, record `decision resolve --id <DN-nn> --answer "<answer>"
   --by "<name>"` and resume.

4. **Report blocked and failed items as what they are.** In every progress report and in
   the Completion Report, list each blocked test, unresolved failure, exception and open
   decision, with the tasks held back. Never describe such work as verified, and leave its
   tasks unmarked.

### When verification is not possible

Follow "When verification is not possible" in the process rules. In this stage:

1. **No test tooling.** When the plan's Verification commands hold a single `None` row, work
   in no-tooling mode: run no `run` and no `gate --all` for a test, never choose, install or
   configure a framework, and write a test only where the project already has a place for
   one. Mark each task complete when its work is done, and report that nothing is verified
   by tests.

2. **An unreachable service or broken environment.** Classify the failed run as `environment`
   with `classify`, then record the deferral:

   ```bash
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py defer --vo <obligation id> \
       --reason "<what could not be reached and why>"
   ```

   Ask the developer before a deferral that follows no `environment` classification, and
   record `approve --id <DF-nn> --by "<name>"` only after they have approved in the
   conversation. A deferred obligation is never reported as verified.

3. **Manual checks.** For each check in the Manual verification table, ask the person to do
   it and tell you the result. Record it only on their word, under their name:

   ```bash
   python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py manual --check <MV-nnn> \
       --result <pass|fail> --by "<name>"
   ```

   Never record a result for a check nobody has done, and never invent a name. An open or
   failed manual check does not hold a task back; report it.

### End-of-stage report

After `gate --all`, print the review view and report from it:

```bash
python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py status
```

In the Completion Report, in addition to what the core command asks for:

- State what is verified and what is not, and why, obligation by obligation as `status`
  shows it.
- List every blocked or failed item, every exception, every expectation change and every
  open decision, with the tasks held back. List any change made to an existing test file,
  with its reason.
- List every behaviour item that is not verified, with the reason, from `status`, and every
  change to a fixed behaviour item with its approval state.
- Report the counts `status` prints: obligations verified, obligations deferred, and manual
  checks open, failed and passed. List each deferred obligation with its reason and each
  manual check with its state, and say that none of them is verified by tests. When the
  project has no test tooling, say that nothing was verified by tests.
- State plainly that passing tests do not show that requirements listed as not verified
  are met.
- State that passing tests do not stand in for linting, static analysis, security checks
  or any other validation the project requires: those are run and reported as the project
  already requires.
- Point the reviewer to the evidence document at its resolved location: `tests/tdd-evidence.md`,
  or `tdd-evidence.md` where the feature keeps it at the top of the feature directory.

Do not describe the stage as complete while `gate --all` exits non-zero or while an
obligation is planned or in progress: say what remains.

Routine cycles involve no approval request to the developer. Never edit `tdd-evidence.md`
or `tests/tdd-evidence.md` directly, and never copy test output into the artefacts.
