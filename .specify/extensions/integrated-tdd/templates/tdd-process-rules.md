# Integrated TDD process rules

These rules name no coding agent. They apply to whichever agent carries out the Spec Kit
lifecycle, and to the developer who remains accountable for the result.

## Purpose and how the wrapped commands use these rules

The plan, tasks, analyze and implement stages of Spec Kit are extended so that
verification is derived from requirements before implementation, implementation proceeds
through Red, Green, Refactor with evidence from real test runs, and a task cannot be marked
complete without that evidence. No command is added: each extended stage tells the agent to
read this file first and then follow its own procedure.

Two things do the work:

- **These rules**, which the agent follows and a reviewer can hold it to.
- **The check script**, `.specify/extensions/integrated-tdd/scripts/python/tdd_check.py`,
  which checks what can be checked objectively, runs the project's declared test commands
  and writes the evidence. Run it from the repository root. A check that fails blocks the
  work it guards; it is never downgraded to a note.

Verification intent is kept in the feature's `plan.md` (the Verification Plan section) and
`tasks.md` (task labels). The behaviour items the feature must show are kept in
`tests/behaviour-checklist.md`, which the plan stage writes. Evidence is kept in one
document that only the check script writes: `tests/tdd-evidence.md` for a feature planned
after the behaviour checklist was introduced, and `tdd-evidence.md` at the top of the
feature directory for a feature whose evidence was started before. A feature never holds
both.

## Verification intent

Verification is decided from the requirements and the design, before implementation, and
recorded in the plan's Verification Plan. It is not invented while the code is written.

**Where it comes from.**

- Derive verification scenarios and their expected outcomes from the specification: its
  functional requirements, acceptance scenarios, edge cases and failure conditions
  (FR-006, FR-007).
- Take interfaces, data integrity rules, security requirements and integration boundaries
  from the design, and reflect them in the scenarios and in the levels chosen (FR-008).
  Give a design constraint a `DC-nn` label and an edge case an `EC-nn` label, and state it
  in the obligation's Scenario cell.
- State each expected outcome as what must be observed, without reference to how the code
  will be written (FR-010). "The total is zero and no error is raised" is an outcome;
  "the loop returns early" is not.

**Coverage.**

- Every `FR-` requirement and every acceptance scenario is covered by a verification
  obligation, or by an exemption that says why automated verification is inappropriate and
  how the requirement is verified instead (FR-009). An acceptance scenario's id is
  `USn-ASm`: scenario `m` of user story `n`.
- Choose a testing level for each obligation: unit, integration, contract, end-to-end or
  other. No single level is required for all verification (FR-011).
- Scale the number of obligations to the scope, risk and complexity of the change
  (FR-013). A small, low-risk change gets one obligation per requirement and per
  acceptance scenario and no more. A large or risky one gets obligations for its failure
  conditions, boundaries and constraints as well.
- **Write no more obligations than the requirements and scenarios need.** An obligation
  verifies a requirement, an acceptance scenario, an edge case or a design constraint of
  the specification. It is not one per assertion, and it is not a check of a property the
  specification does not state (a value's type, the absence of a word in the source, that
  an import works). For a small, low-risk change, write one obligation per requirement and
  per acceptance scenario, at one level, and exempt nothing that a larger change would not
  also exempt.
- Planning names scenarios and outcomes. It does not write the executable tests: those are
  written one at a time during implementation, each just before the behaviour it verifies
  (FR-014).

**Edge case ids.** Obligations and behaviour items cite an edge case as `EC-nn`, and the
checks accept an `EC-` id only if the specification holds it as a whole word. When the
specification's edge cases carry no ids, label them `EC-01`, `EC-02` in order by adding the
label to each edge case in the specification, change no other word, and name the labels in
the Completion Report. Never cite an `EC-` id the specification does not hold.

**Ambiguity.** When a requirement is ambiguous, or contradicts another, in a way that
changes what a test should assert, put the question to the developer. Do not choose an
interpretation. Plan nothing for that requirement until it is answered: leave it without
an obligation, so that the plan check fails and the plan is not reported complete. Record
the answer in the specification's Clarifications, then write the obligation (FR-015).

**A requirement that existing behaviour stays unchanged.** When a requirement states that
existing behaviour stays unchanged and the change gives no way to vary that behaviour,
there is nothing a test can observe: any test would only restate how the language works.
Do not leave it uncovered and do not put it to the developer as an ambiguity. Exempt it
with the reason "unchanged by construction: the change gives no way to vary it", give it a
behaviour item whose *Verified by* is that exemption, and say so in the Completion Report so
the developer can overrule it. Where the change does add a way to vary the behaviour, it is
an ordinary requirement and gets an obligation.

**Verification commands.** Take the commands only from what the project already defines:
its package scripts, Makefile, CI configuration or contributor documentation (FR-049).
Record where each one is defined. When the project has no runnable test command, say so
as a gap to resolve and do not proceed as though verification had happened. Do not choose
or install a test framework on the project's behalf.

**A feature already past planning.** A feature whose `plan.md` has no Verification Plan
was planned before these rules applied and is not under the process. Each later stage
reports that as a gap at its start and again in its final report, names the plan stage as
the way to bring the feature under the process, and then carries on as core Spec Kit does.
No check is run and no evidence is recorded for it, and its work is never described as
verified.

## Behaviour checklist

The behaviour checklist states, in the specification's terms, each behaviour the feature
must show, and links it to the requirements it comes from and to the obligations that
verify it. It lets a person judge, before any code is written, whether the planned
verification covers what the specification asks.

**When and by whom.** The plan stage writes it, after the Verification Plan, because its
items name obligations and exemptions the Verification Plan holds. Start from the
extension's template, `.specify/extensions/integrated-tdd/templates/behaviour-checklist-template.md`.
The Verification Plan carries a `### Behaviour checklist` sub-heading with a fixed line
linking to the file. The heading is read by the checks: keep it, and add it when the plan
lacks it.

**Where.** `tests/behaviour-checklist.md` in the feature directory, and never in
`checklists/`. Spec Kit's own checklist scan reads `checklists/`, and a file there with
unchecked boxes would hold up implementation; this file has no checkboxes and is not a
requirements-quality review. The `tests/` folder holds verification material about the
feature. It is not where the project's executable tests live. The evidence document goes
in the same folder for a feature planned after the checklist was introduced
(`tests/tdd-evidence.md`); a feature whose evidence was started earlier keeps
`tdd-evidence.md` at the top of the feature directory. A feature never holds both.

**Layout.** Write one section per acceptance scenario, in order, headed `## USn-ASm`, which opens
with the scenario's text from the specification as a block quote, word for word. Then one
`## Other behaviours` section, when needed, for behaviour that refines no scenario: a
requirement with no scenario of its own, an edge case with an outcome of its own, a
measured success criterion the Verification Plan verifies. Under a section, each item is
one line,

```text
- **BI-001** Expresses: FR-001, US1-AS1. Verified by: VO-001.
```

followed by indented clauses in the order Given, When, Then (`**Given**`, `**When**`,
`**Then**`), with `**And**` clauses where one action has several outcomes. *Expresses* lists the `FR-`,
`SC-`, `USn-ASm` and `EC-` ids the item comes from. *Verified by* lists `VO-` obligations
and `exemption <requirement id>` entries. Item ids are `BI-` and three digits, numbered in
order of creation and never reused.

**What an item says.**

- An item refines a scenario: it keeps the scenario's terms and states every outcome the
  scenario states, none weaker. It may add concrete values and the boundary the
  specification describes. It never replaces an outcome with a vaguer one (FR-016).
- State what can be observed at the boundary the specification describes: what a user sees
  or can do, what a caller receives, what is stored and can be read back, what is refused
  (FR-011).
- An item names no file, module, function, class, table, endpoint or screen component, and
  no step of how the feature is built (FR-012). The exception is a file the specification
  itself names as part of the behaviour it describes: the check allows what the
  specification says.
- Add no behaviour the specification does not state (FR-013). A behaviour found in the
  code and not in the specification is not an item: it is a question for the developer.
- Keep it in proportion. One item per behaviour, and no two items for one behaviour
  (FR-015). A small, low-risk change has one item per acceptance scenario and per
  requirement with no scenario, and no more.
- There is no checkbox and no status in the file (FR-014). What is verified is derived from
  the evidence and shown by `status`.
- A requirement that has an exemption still gets an item, whose *Verified by* is the
  exemption: the item states what is expected, and the exemption says how it is checked
  instead.
- Edge cases and measured success criteria that the Verification Plan verifies get items
  under Other behaviours.
- When a requirement is ambiguous in a way that changes what an item should say, put the
  question to the developer as under "Verification intent" and leave the item out until it
  is answered.

**Fixed at the baseline, changed afterwards.** The items are fixed from the first recorded
run: the check script records each item's content and the obligations it names, once,
and refuses a baseline while the checklist fails. After that:

- Adding an item for a discovered obligation is allowed, and the item comes before the
  obligation's test: add the item (or add the obligation to an existing item's *Verified
  by*), rerun `plan`, then write the test. A Red run for an obligation that no item names
  is refused.
- Linking an obligation to an existing item is not a change to the item.
- Changing the wording of a fixed item, or removing one, is a change to what the feature
  must show. Record it with `tdd_check.py expectation --item <item id> --requirement <id>
  --justification "<why>"`, adding `--alters-behaviour` when it alters what the
  specification asks. The tasks that verify the item are held until the change is recorded,
  and approved when it alters behaviour: explain it to the developer, and record
  `approve --id <BX-nn> --by "<name>"` only after the developer has approved in the
  conversation.
- An id is never reused. A removed item's id is not given to another behaviour.
- While the checklist fails the checks the `plan` stage applies, no task can be marked
  complete (the gate rule G11): it is brought back into line, through the specification or
  the Verification Plan first.

**Check.** The `plan` check covers the checklist: every requirement and scenario is named
by an item, every item names obligations or exemptions that exist, every obligation is
named by an item, the format holds, no item names a code element the design introduces,
and every quote matches the specification. The plan is not complete while a finding
remains. The check does not decide whether an item keeps its scenario's wording closely
enough, whether two items describe one behaviour, or whether an item adds behaviour; those
are for the plan stage to get right and for the reviewer to judge.

### Reviewing the checklist

A person can judge the checklist from the specification and the checklist alone, before any
code is written, without the plan or the task list.

- **What the reviewer compares.** The reviewer compares each scenario's quote against its
  items: every outcome the scenario states appears in the items, none weaker. Whether every requirement is named
  by an item, and whether nothing goes beyond the specification: no item states a behaviour
  the specification does not.
- **The side-by-side view.** `python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py status --scenarios`
  prints each scenario's quote with the items that refine it, each item with the
  requirements it expresses and the obligations that verify it, and then the Other
  behaviours. It needs no evidence and changes no file.
- **Corrections go through the specification first.** When the reviewer finds the
  checklist wrong because the specification or the Verification Plan is wrong, a correction
  is made in `spec.md` or the Verification Plan first and then carried into the checklist,
  so that the quotes and the obligations it names stay in line. A correction to the
  checklist alone, to an item's wording, is made in the checklist.
- **Review is asked for and never awaited.** The plan stage asks for review and waits for
  no approval: the plan is reported complete when the check passes, and a correction found
  later follows the route above.

## The Red, Green, Refactor cycle

Implementation proceeds one behaviour at a time. Every result comes from the check
script's `run` subcommand, which executes one of the plan's declared verification commands,
judges the outcome by exit status and expected text, and writes the record itself.

```text
python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py run \
    --phase <baseline|red|green|refactor|checkpoint> --command <command id> \
    [--select <selector>] [--task <task id>] [--vo <obligation id> ...] \
    [--tests <test file> ...] [--expect <text>] [--note <text>]
```

**Before the first task.** Record a `baseline` with a `broad` command, so that tests
already failing before this feature are known and kept apart from failures the work
introduces. Name the failing tests with `--note`. No other run is accepted until a
baseline exists.

**For each behaviour, in this order.**

1. **Write the test first.** Create or update the test for the behaviour before any of
   its implementation (FR-017). This is the obligation's test task.
2. **Red.** State in advance the text the failure should show, then run the test with
   `--phase red`, the test task, the obligation, the test files (`--tests`) and that text
   (`--expect`). Proceed only when the record is valid: the run failed and its output
   held the expected text (FR-018).
   - A test that passes on its first run is not a Red step. Investigate: the behaviour may
     already exist, or the test may not exercise it.
   - A test that fails for another reason, such as a missing import or a mistake in the
     test, is not a Red step either. Correct the test and run `red` again.
3. **Green.** Make the minimum change that satisfies the failing test (FR-019), then run
   it with `--phase green` on the behaviour task (FR-020). Minimum means minimum: do not
   write the general solution while making the first test pass. Leave the cases of the
   next obligations unhandled, so that each next test can be seen to fail for the intended
   reason first. When a test of a later obligation passes at once because the first change
   already covered it, that is the case for a `no-meaningful-red` exception, recorded with
   that reason, and not for a test written to pass.
4. **Refactor.** Tidy the code while the tests stay passing, and run the affected tests
   with `--phase refactor` afterwards (FR-021). Where there is nothing to tidy, there is
   nothing to run.

**Rules that hold throughout.**

- Never state that a test failed or passed unless `run` recorded it. "It should pass" is
  not a result (FR-022).
- Work in small increments, and verify each one before starting work that depends on it
  (FR-024). Tests are run throughout and never left to the end (FR-025).
- Select the existing tests that cover the area being changed and run them alongside the
  new one, so that a regression shows at once (FR-027).
- Run a `broad` command as a `checkpoint` at the end of each phase of the task list, and
  not after every change (FR-028).
- When a run fails, resolve the failure before starting dependent work (FR-026). The
  section on failures says how.
- Before marking a task complete, run `gate --task <task id>`. The edit that marks a task
  `[X]` is refused while its gate fails. Never edit `tdd-evidence.md` or
  `tests/tdd-evidence.md`: only the script writes the evidence.
- A routine cycle involves no approval request (FR-053). Ask the developer only for what
  the sections on test integrity and on failures, exceptions and decisions name.

## Test integrity

A passing suite means something only if the tests were not bent to produce it.

- **Never remove, weaken, skip or bypass a test to obtain a pass** (FR-029). This holds
  for every existing test in the project, and not only for the test files a check covers.
  An existing test that starts failing is a regression to investigate (FR-027): find what
  the change broke. Any change made to an existing test file is named in the stage's
  final report, with its reason.
- **Assert a meaningful outcome.** An assertion checks what the behaviour must produce,
  and not merely that the code ran without error (FR-030).
- **Tests agree with the approved requirements and design** (FR-031). A test that
  contradicts the specification is wrong, however convenient.
- **A test changed after its Red run is recorded.** The script takes a fingerprint of the
  test files at the failing-first run and again at the passing run. When they differ, the
  task's gate fails until the change is recorded:

  ```text
  python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py expectation \
      --task <task id> --tests <test file> ... --requirement <id> ... \
      --justification "<why the expectation was wrong or has changed>" [--alters-behaviour]
  ```

  The justification names the requirement the change is made against. Decide honestly
  which of two things the change is:
  - a **correction**, which brings the test into line with the approved requirements. It
    needs the recorded justification and no approval.
  - a change that **alters intended behaviour**. Give `--alters-behaviour`, explain the
    change to the developer, and wait. Only after the developer has approved it in the
    conversation, record `approve --id <XC-nn> --by <the developer's name>` (FR-032).
- **Add the next obligation's test after the current one is green.** The fingerprint
  covers the whole test file named on a failing-first record, so a test added to that file
  between a Red run and its Green run changes the fingerprint and needs an expectation
  change. Where it happens, record it as a correction with `expectation`: the justification
  says that tests were added and no assertion changed.
- **Test doubles must be able to fail as the real thing can.** A mock, fixture or double
  that stands in for an important integration boundary must be able to produce the
  failures that boundary can produce, so that it does not hide them (FR-033).
- **Passing tests are not proof while coverage is incomplete.** Do not report that
  requirements are met when some have no verification or are not yet verified (FR-034).
- **A requirement is never altered to pass.** When implementation shows a requirement to
  be wrong, raise it with the developer for correction through the specification. Do not
  change the requirement, or the test, to match the code (FR-035).

**Limit.** Only the test files named on a failing-first record are fingerprinted. A change
to any other existing test is not detected by a check: the rules above forbid it, and a
reviewer sees it in the diff.

## Failures, exceptions and decisions

Not every piece of work fits the cycle, and not every run succeeds. Each such case is
recorded as what it is. Nothing is quietly skipped and nothing incomplete is reported as
done.

### A run that fails

Investigate every failure that is not a valid Red step, and then say which of these it is
(FR-036):

| Classification | Meaning |
|----------------|---------|
| `assertion` | The test ran and its expectation was not met |
| `defect` | The implementation is wrong in some other way: an error raised, a crash, a wrong type |
| `environment` | The test could not run properly: a missing dependency, an unreachable service, a broken tool |
| `unreliable` | The test passes and fails with no change to the code |

```text
python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py classify \
    --seq <record number> --as <assertion|defect|environment|unreliable> [--note <what was found>]
```

- A failure stays `unclassified` until it has been investigated, and a task with an
  unclassified failure cannot be completed.
- An `unreliable` record counts as evidence in neither direction. Report the test as
  unreliable; do not rerun it until it happens to pass.
- An `environment` failure blocks the obligation. Report it as blocked, with what is
  needed to unblock it. Never report a blocked test or an unresolved failure as verified
  (FR-037, FR-040).
- When tests cannot be run at all in the working environment, that is a blocking
  condition: say so and claim no result.
- Resolve a failure before starting work that depends on it (FR-026).

### An exception to the cycle

When a meaningful first failure cannot reasonably be shown, or the work is of a kind that
test-first development does not suit, record an exception with the reason and the
verification followed instead (FR-023, FR-038):

```text
python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py exception \
    --task <task id> [--vo <obligation id> ...] --kind <kind> \
    --rationale "<why the cycle was not followed>" --alternative "<how it is verified instead>" \
    [--needs-approval]
```

An exception that names an obligation covers it for the test task and the behaviour tasks
alike. It stands in for the failing-first run only: a passing run is still required of the
behaviour task. Choose the kind that fits, and verification that suits the work (FR-039):

| Kind | When | Verification that suits it |
|------|------|----------------------------|
| `no-meaningful-red` | The behaviour already holds, or a failing test would prove nothing | The test is written and passes, and the reason no failure could be shown is given |
| `behaviour-preserving` | A refactor or optimisation that must leave behaviour unchanged | The existing tests covering the behaviour pass before the change (a `baseline` or `green` run) and after it (a `refactor` run of the same command and selector). Where coverage is too thin to show that behaviour was preserved, add tests first |
| `legacy` | Code with no seams to test through | Characterisation tests of current behaviour, or a seam added first |
| `external-system` | A system that cannot be exercised from the tests | A contract test, or a double that can fail as the real system can |
| `generated-code` | Output of a generator | Tests of the generator's input or of the generated interface |
| `migration` | A data or schema migration | A run against representative data, with before and after checks |
| `infrastructure` | Build, deployment or configuration changes | A smoke or dry run that shows the effect |
| `exploratory` | A spike whose result is not kept as it stands | Stated as exploratory; tests are written when the result is adopted |
| `environment-blocked` | The tests cannot be run | None. The obligation stays blocked and its tasks stay incomplete until the tests can be run, then the cycle is followed |
| `other` | A kind not named here | Stated in full |

### When to ask the developer

Explain each significant testing decision, unexpected failure and exception in terms the
developer can assess (FR-051). Ask for a decision or an approval, and do not decide alone,
when (FR-052):

- the exception is of kind `legacy`, `exploratory` or `other`, or offers no alternative
  verification (an alternative of `none`). These always exceed the agent's authority, and
  the script marks them as needing approval;
- an exception of any other kind involves a consequential trade-off. Give
  `--needs-approval`, so that the judgement is visible to the reviewer;
- a test change alters intended behaviour (see Test integrity);
- a requirement turns out to be ambiguous or wrong.

Record an approval only after the developer has given it in the conversation:
`approve --id <EX-nn> --by <the developer's name>`.

### Waiting for a decision

When work has to wait for a person, open a Decision listing the affected task and every
task that depends on it:

```text
python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py decision open \
    --question "<what the person is asked to decide>" --tasks <task id> ...
python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py decision resolve \
    --id <DN-nn> --answer "<the decision>" --by "<who decided>"
```

- The tasks listed cannot be completed while the decision is open. Continue with the tasks
  it does not list (FR-065).
- Report the open decision and the work it is holding back, in progress reports and in the
  final report.
- Never proceed on an assumed answer.
- When every remaining task depends on an open decision, stop and report.

## When verification is not possible

Some work cannot be verified by an automated test. Three cases are named, and each is
stated in the evidence and the reports rather than passed over.

**The project has no test tooling.** The plan stage records a single `None` row in the
Verification commands table, says the project has no test tooling, and carries on. The
process never chooses or installs a test framework, and writes no example tests for a
project that has none: choosing one belongs to the developer. In this no-tooling mode no
`run` is made, tasks are marked complete once their work is done, and every report says
nothing is verified by tests. Declaring a command in the table later switches the checks
on, with no other change.

**An obligation's test cannot be run now.** A service is unreachable or an environment is
broken. Classify the failed run as `environment`, then record a deferral of the obligation
with the reason (`defer --vo <id> --reason "<why>"`). A deferral is explicit, reasoned and
reported. It does not make the obligation verified, and it is lifted by a later passing
run. Who may defer: the agent may record a deferral that follows an `environment`
classification. A deferral on any other ground, or one the developer should judge, needs
the developer's approval, recorded with `approve --id <DF-nn> --by "<name>"` only after the
developer has given it in the conversation.

**A behaviour cannot be automated.** The plan stage lists it as a manual check in the
Manual verification table, with its steps, the expected result and why it is not
automated. A person does the check and records the result with `manual --check <MV-nnn>
--result <pass|fail> --by "<name>"`. The result is a person's own word: the agent never
records one on their behalf and never invents a name.

Nothing deferred or manual is reported as verified. Each is listed under "Not verified by
tests" with its state, and the counts of verified obligations, deferred obligations and
open, failed and passed manual checks are reported. An open or failed manual check is a
notice, not a failure of the gate.

## Traceability and review evidence

A reviewer who took no part in the work must be able to say, for any requirement, whether
it is verified, by which tests and with what result, from the feature's artefacts alone.

- **The chain is requirement, behaviour item, obligation, task, test, record.** The
  checklist's behaviour items name the requirements and scenarios they express and the
  obligations that verify them. The plan's obligations name the requirements they verify.
  Task labels name the obligations. Each recorded run names its task, its obligations and
  the test it selected. Keep every link: use the obligation's real id on the task and on
  the run.
- **A scenario discovered during implementation is added before its test is written.** Add
  it to the plan's obligations table with origin `discovered` and the requirements it
  verifies, give it the next unused `VO-` id, and add its test task and behaviour task to
  `tasks.md` with that label. Then link it to a behaviour item: an obligation is linked to
  a behaviour item before its test is written. Then write the test. Never leave a test that
  traces to no obligation, or an obligation that traces to no item (FR-016, FR-032).
- **When a requirement, a design decision or the implementation changes**, update the
  obligations, tasks and tests it affects, and rerun the `plan` and `tasks` checks. A
  changed expectation in a test that has already had its Red run is recorded as the Test
  integrity section says (FR-044).
- **The evidence document is written by the script and read by people.** Its Summary shows
  each obligation's status and everything not verified, with the reason. Status is derived
  from the records: it is never written by hand, in the plan or anywhere else.
- **Do not duplicate.** Do not copy test output, coverage reports or CI results into the
  specification, the plan, the task list or the evidence. The record of a run says what
  was run, at which point in the cycle and with what result, and no more (FR-045).
- **Explain what a reviewer will need explained.** State the reason for each significant
  testing decision, unexpected failure and exception in terms a developer can assess: in
  the obligation's scenario and expected outcome, in a run's note, in an exception's
  rationale, and in the stage's final report (FR-051, FR-054).

The view is printed on demand by:

```text
python3 .specify/extensions/integrated-tdd/scripts/python/tdd_check.py status
```

## Fitting the project

The process uses what the project already has and leaves its other controls alone.

- **Use only the project's declared verification commands**, and follow the project's own
  conventions for where tests live and how they are named (FR-049).
- **Never install or choose a test framework** for the project, and never edit its test,
  lint or CI configuration to make this process work. No particular language or test
  framework is required: a run is judged by its exit status and by text in its output
  (FR-046, FR-048).
- **Add no check the project already runs.** Linting, static analysis, security scanning,
  code-quality checks and CI stay in force as they were, and are not repeated here
  (FR-050).
- **Passing tests satisfy nothing but the tests.** Do not report passing tests as meeting
  static analysis, security checks or any other validation the project requires. Those
  are run and reported as the project already requires (FR-047).
