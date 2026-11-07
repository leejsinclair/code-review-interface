# Evaluating Integrated TDD

How to judge whether the extension does what it claims on your own projects. The agent is
driven by a person: nothing here automates a coding agent.

## What you need

- A throwaway project with its own test command, with both packages installed
  ([README](../README.md#install)).
- The example stories in [`examples/stories/`](../examples/stories/). Each holds the text
  to give `/speckit-specify`, any setup to do first, and a checklist of observable items.
- Claude Code in the project.

## Driving a story

For each story, in a clean copy of the project, run the six standard commands in order and
answer a question or approval request as a developer would:

```text
/speckit-specify <the story text>
/speckit-clarify
/speckit-plan
/speckit-tasks
/speckit-analyze
/speckit-implement
```

Do this for every story in one project, and for stories 01, 05 and 07 in each of two more
projects that differ in language and test framework. That is 14 runs, of which story 08
stops after the plan stage. Keep each project's
lint and CI configuration in place, and run its own quality commands before the first
command and again after the last: they must still run and still gate as they did.

## Reading the result

From the repository root of the project:

```bash
python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py compliance
python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py status
```

`compliance` prints `COMPLIANT` or `NON-COMPLIANT` and lists each finding as
`<rule> <subject>: <reason>`:

| Rule | Passes when |
|------|-------------|
| C1 | Every requirement and acceptance scenario has an obligation or an exemption |
| C2 | Every obligation is named by a test task and by a behaviour task |
| C3 | A test task comes before the first behaviour task |
| C4 | The chain of check values in the record table is intact |
| C5 | Every completed task passes the gate rules G1 to G9 |
| C6 | A baseline comes first, and the latest checkpoint passed or its failure is pre-existing and reported |
| C7 | No obligation is planned or in progress, and the stored Summary matches the regenerated view |
| C8 | For a feature with a behaviour checklist: the checklist passes the plan and tasks checks (B1 to B7), and no behaviour item fixed at the baseline has been changed or removed without an accepted change record |

`status` prints, for each obligation, its requirements, derived status
(planned, in progress, verified, blocked or failed), the tests that ran and the latest
result, followed by what is not verified and why, exceptions, expectation changes, open
decisions and failures that were present before the work began.

For a feature with a behaviour checklist, `status` also prints a table of the behaviour
items. Each row has the item, its scenario (or `-` for Other behaviours), the obligations
that verify it, its derived status and the tests that ran. An item is `verified` only when
every obligation it names is verified, `exempt` when it names exemptions only, and
otherwise `failed`, `blocked`, `in progress` or `planned`, in that order of precedence. An
item that is not verified is listed on the **Not verified** line, and the **Item changes**
line lists each change record with its approval state and each change with no record.

Then work through the story's checklist from the artefacts: the plan, the task list,
`tests/behaviour-checklist.md` and the evidence, which is `tests/tdd-evidence.md` for a
feature planned with the behaviour checklist and `tdd-evidence.md` for an older one.

## Judging a behaviour checklist

The check script decides what can be decided mechanically (that every requirement is named,
that the quotes match, that no item names a code element). It does not decide whether the
checklist is a faithful statement of the specification. A reviewer who took no part reads
`spec.md` and the checklist, with the side-by-side view:

```bash
python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py status --scenarios
```

and judges:

- **Nothing weaker.** For each scenario, every outcome it states appears in its items.
  A scenario saying "the total is zero and no error is raised" is not matched by an item
  that says only "the total is zero".
- **Nothing beyond.** No item states a behaviour the specification does not. A behaviour
  found in the code and not in the specification is a question for the developer, not an
  item.
- **No duplicates.** No two items describe one behaviour, and a small change has about one
  item per scenario.
- **Observable terms.** Each item says what a user sees, a caller receives, or is stored
  and can be read back, in the specification's words. An item that reads like a description
  of the code is the sign of a checklist written from the code.
- **Where it comes from.** For any item, the reviewer can name the requirement it expresses
  from its *Expresses* line, and the tests that verify it from `status`, without the plan or
  the task list. Target: under two minutes per item, and under ten minutes to judge the
  whole checklist against the specification.

Story 08 shows the failure on purpose. Give its text to `/speckit-specify` in a project
whose code already does more than asked, run `/speckit-plan`, and read the result as the
story's checklist describes: `plan` reports **B5** for items that name code elements and
**B1** for the requirement the code does not yet meet, and the plan stage does not report
completion until they are corrected.

## Judging work that tests cannot verify

Three cases cover it. Story 09 in an empty project with no test framework: all five stages
complete, the plan records `None`, no framework is chosen or installed, and the final report
says nothing was verified by tests. The run `examples/runs/no-tooling/` shows the result,
and `examples/runs/deferred/` shows a deferral and a manual check beside a verified
obligation. For each, run `status` and `compliance` and read:

- **Counted apart.** Deferred obligations and manual checks sit under "Not verified by
  tests" and are not in the verified count.
- **Reasoned.** Every deferral has a reason, and one outside an environment failure or no
  test tooling has a named approver.
- **A person's result is theirs.** A manual result carries the name of the person who did
  the check, not the agent's.

## What a compliant verdict does and does not show

It shows that the recorded process was followed: the evidence came from real runs through
the script, each behaviour had a failing run for the expected reason before a passing run,
tests were not changed unrecorded between the two, and nothing is left unreported.

It does not show that the tests' assertions are meaningful or that the requirements are
right. Those are what a reviewer judges, and `status` is the place to start. The example
runs in [`examples/runs/`](../examples/runs/) show the difference between a run that
followed the process and one that only added tests.

## Comparing with your baseline

`tdd-evidence.md` keeps the columns later comparison needs. Where you hold baseline data
for the same kind of work, compare it with:

| Measure | Taken from |
|---------|------------|
| Review effort | The time a reviewer needs to answer, for a requirement chosen at random, whether it is verified, by which tests and with what result. The Summary at the top of the evidence is the starting point; the target in the specification is under two minutes |
| Escaped defects | Defects found after merge, matched to the requirement and its obligation. An obligation with `verified` status that a defect escaped through points at a weak assertion |
| Test reliability | Records classified `unreliable` and failures classified `environment`, by time and by test selector |
| Rework | Expectation Changes (a test changed after its failing run), exceptions raised late, and tasks with several `red` records for one obligation. The Time, Task, Phase, Result and Classification columns carry each |

## Limits

Reductions in review effort, defects and rework need baseline data the adopting team
holds. The extension makes the comparison possible and does not run it.
