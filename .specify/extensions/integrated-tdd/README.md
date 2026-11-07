# Integrated TDD for Spec Kit

Requirements-driven test-driven development built into the standard
[Spec Kit](https://github.com/github/spec-kit) stages. A developer runs the commands they
already use. The plan states how each requirement will be verified, the task list puts test
work ahead of the behaviour it verifies, implementation proceeds through Red, Green,
Refactor with evidence from real test runs, and a task cannot be marked complete without
that evidence.

It is delivered as two Spec Kit packages from this repository:

| Package | What it does |
|---------|--------------|
| Extension `integrated-tdd` | Supplies the process rules, one deterministic check script (Python standard library only) and a runtime event that refuses the edit marking a task complete while its gate fails |
| Preset `integrated-tdd` | Wraps the core plan, tasks, analyze and implement commands, and appends a Verification Plan section to the plan template and label conventions to the tasks template |

No command is added. Nothing in the project's test, lint or CI configuration is read or
changed, and no test framework is required: a test run is judged by its exit status and by
text in its output.

## Requirements

- Spec Kit CLI 0.15.0 or later, the first release with extension runtime events. Built
  and tested with 1.1.3.
- Python 3.9 or later.
- Claude Code for full enforcement. The process rules and the checks name no agent; the
  hard stop needs an agent whose runtime Spec Kit can attach a pre-tool-use event to.
- Linux or macOS. Windows is untested.

## Install

Install the extension first, then the preset, from a release archive. The address below
is that of the `v0.3.0` tag, which exists once the release is published:

```bash
specify extension add integrated-tdd --from https://github.com/leejsinclair/speckit-tdd-integrated/archive/refs/tags/v0.3.0.zip
specify preset add integrated-tdd --from https://github.com/leejsinclair/speckit-tdd-integrated/archive/refs/tags/v0.3.0.zip
```

Install from a release archive, not from a working copy. A release archive holds only the
shipped files. Spec Kit copies a preset's whole source directory, so `--dev` on a clone of
this repository also copies its `.git`, `.specify`, `.claude` and `specs` directories into
the project. Use `--dev` only when developing the packages themselves.

The order matters. Spec Kit installs the preset without the extension and gives no
warning; each wrapped command then says the extension is missing and carries on as core
Spec Kit does.

## Remove

```bash
specify preset remove integrated-tdd
specify extension remove integrated-tdd
```

Removal returns the four commands to their core content and takes the event out of
`.claude/settings.json`. Existing feature directories are left as they are: `plan.md`,
`tasks.md`, `tdd-evidence.md` and the `tests/` folder (`behaviour-checklist.md` and
`tdd-evidence.md`) stay readable Markdown. Spec Kit rewrites the whitespace of
`.claude/settings.json` when it adds and removes the event, and keeps a copy of the
extension's directory under `.specify/extensions/.backup/`.

## What changes in an existing Spec Kit project

Installing changes eight things about how Spec Kit behaves. Each is deliberate.

| Change | Why |
|--------|-----|
| `plan.md` gains a Verification Plan section: the project's test commands, verification obligations and exemptions | Verification is decided from the requirements and the design before implementation, so tests do not merely restate what the code does |
| Test tasks in `tasks.md` are mandatory for behaviour, where core Spec Kit generates them only on request, and every task carries a `[VO-nnn]` or `[NT: reason]` label | Each obligation needs a task that writes its failing test ahead of the task that delivers the behaviour, and the labels are what the checks trace |
| A task cannot be marked complete in `tasks.md` through the agent's edit tools until its gate passes | A rule that is checked and not enforced is skipped under pressure. A failed check blocks; it is not a note for review |
| `.claude/settings.json` gains one `PreToolUse` entry, managed by Spec Kit | It is how the gate runs at the moment a task is marked complete, without anyone invoking it |
| The feature directory gains `tdd-evidence.md`, which the agent's edit tools cannot change directly | Evidence is written only by the script that ran the tests, so a recorded result always comes from a real execution |
| The plan stage writes a behaviour checklist, `tests/behaviour-checklist.md`, and the plan check, the baseline and the gate depend on it passing | A person can judge, before any code is written, whether the planned verification matches what the specification asks. See [The behaviour checklist](#the-behaviour-checklist) |
| The feature directory gains a `tests/` folder, which holds the checklist and the evidence | Verification material about a feature lives together, apart from `checklists/`, which Spec Kit's own scan reads and which would hold up implementation on unchecked boxes. It is not where the project's executable tests live |
| New features keep their evidence in `tests/tdd-evidence.md`; a feature with evidence at the top of its directory keeps it there | Existing evidence is never moved. A feature with it in both places is refused with exit 2 and nothing is written |
| The edit that would remove `## Verification Plan` or `### Behaviour checklist` from a `plan.md` that holds it is refused through the agent's edit tools | Those two headings switch the checks on; removing them would silently take the feature out of the process |

A feature whose `plan.md` was written before installation has no Verification Plan and is
not under the process. The tasks, analyze and implement stages say so at their start and in
their final report, name `/speckit-plan` as the way to bring it under the process, and
carry on as core Spec Kit does. A feature planned with 0.1.0 has a Verification Plan and no
behaviour checklist: the stages report that gap in the same way, apply no checklist rule,
and keep its evidence where it is. Running `/speckit-plan` again adds the checklist.

## How it works

| Stage | Added to the stage | Check |
|-------|--------------------|-------|
| `/speckit-plan` | The Verification Plan: commands from the project's own tooling, obligations derived from requirements, acceptance scenarios, edge cases and design constraints, exemptions with reasons. Then the behaviour checklist, `tests/behaviour-checklist.md`, one item per behaviour. Material ambiguity is put to the developer | `plan` (covers the checklist) |
| `/speckit-tasks` | Every task labelled; a test task ahead of each behaviour task; each test task traces to a behaviour item | `tasks` |
| `/speckit-analyze` | The findings of both checks, including those of the checklist, in the analysis report. Nothing is modified | `plan`, `tasks` |
| `/speckit-implement` | A baseline, refused while the checklist fails, then Red, Green, Refactor per task through `run`, failures classified, exceptions and decisions recorded, a broad checkpoint per phase, the gate before each task is marked complete, any change to a fixed behaviour item recorded, and a final report of what is and is not verified, items included | `run`, `gate` |

The agent's instructions are in
[`templates/tdd-process-rules.md`](templates/tdd-process-rules.md). The checks are
[`scripts/python/tdd_check.py`](scripts/python/tdd_check.py). A reviewer reads the Summary
at the top of a feature's `tdd-evidence.md`.

## The behaviour checklist

**When and by whom.** The plan stage writes it, after the Verification Plan and before
tasks, from the specification and the plan. It is a Phase 1 output of `/speckit-plan`, and
there is no command to run for it.

**Where.** `tests/behaviour-checklist.md` in the feature directory, from the extension's
template. It is not in `checklists/`: Spec Kit's own checklist scan reads that folder, and
a file there with unchecked boxes would hold up `/speckit-implement`. This file has no
boxes and no status. The `tests/` folder holds verification material about the feature;
it is not where the project's own tests live.

**What each item holds.** An item is one observable behaviour, written as Given, When and
Then (with And for further outcomes) in the specification's terms. It names the
requirements, scenarios, edge cases or success criteria it expresses, and the verification
obligations or exemptions that verify it. There is one section per acceptance scenario,
opening with the scenario quoted word for word, and an Other behaviours section for
behaviour that refines no scenario.

**What it must not hold.** No file, module, function, class, table, endpoint or screen
component, no step of how the feature is built, no status, and no behaviour the
specification does not state.

**How it relates to the other documents.** `spec.md` says what is wanted. The checklist
restates each behaviour as an observable outcome and is the only document that links the
specification's words to the verification. `plan.md` says how each behaviour is verified;
its obligations are named by the items. `tasks.md` labels each task with the obligations it
serves, and a test task must trace to an item. The whole chain, from requirement to
recorded run, is: requirement, behaviour item, obligation, task, test, record.

**How a reviewer uses it.** `tdd_check.py status --scenarios` prints each scenario's quote
beside the items that refine it, with each item's requirements and obligations (and status,
once implementation has begun). The reviewer compares them with the specification before
any code is written; the plan stage asks for that review and waits for no approval. A
correction goes to the specification or the Verification Plan first and then to the
checklist.

**What the checks do.** `plan` and `tasks` apply rules B1 to B7: every requirement and
scenario is named, every item names obligations or exemptions that exist, every obligation
is named by an item, the format holds, no item names a code element the design introduces,
every quote and id matches the specification, and every test task traces to an item. A
baseline is refused while they fail. Items are fixed at the first recorded run; a changed
or removed item holds its tasks until the change is recorded with
`expectation --item` and, where it alters intended behaviour, approved (G10). A failing
checklist holds every task (G11). `compliance` reports both (C8).

**Where the evidence is.** `tests/tdd-evidence.md` for a feature planned with the
checklist, and `tdd-evidence.md` at the top of the feature directory for a feature whose
evidence was started with 0.1.0. A feature never holds both.

## Compared with spec-kit-bdd

[spec-kit-bdd](https://github.com/RSginer/spec-kit-bdd) is a community extension that also
brings behaviour-driven development to Spec Kit. The two take different approaches.

- **What a behaviour is.** spec-kit-bdd writes executable Gherkin: `.feature` files, and
  step-definition stubs that fail until the code exists, for a BDD tool to run. Here a
  behaviour is a checked statement in the specification's own terms. Nothing runs the
  checklist: an ordinary test verifies each item, and the evidence records that test failing
  and then passing. This is a behaviour specification that is traced and checked, not
  acceptance automation.
- **How it is used.** spec-kit-bdd adds three commands and two optional hooks. This preset
  adds no command: the checklist is written by `/speckit-plan` and checked by the existing
  stages.
- **How it is checked.** spec-kit-bdd's traceability matrix and coverage percentage are
  produced by the model. Here rules B1 to B7 and gates G10 and G11 are a script that gives
  the same answer every run, and the hook stops the stage when they fail.
- **Where it lives.** spec-kit-bdd writes to a project-wide `features/` folder. Here each
  feature keeps its checklist in its own directory.
- **What it has that this does not.** Scenarios a BDD tool can run, wording suited to the
  kind of project (API, command line, library or interface), and step stubs for several
  languages.

Using both on one feature would give two lists of the same scenarios. If you need
executable Gherkin, treat it as the test that verifies an obligation, and keep one list of
behaviours.

## When TDD and BDD cannot apply

Some work cannot be verified by a test: the project has no way to run tests, a service a
test needs is unreachable, or the check is one only a person can make. The process does
not stop, and it never reports such work as verified.

- **No test tooling.** The plan stage records a single `None` row in the Verification
  commands table and says plainly that nothing will be verified by tests. The process never
  chooses, installs or configures a framework. Stages complete, the final report states that
  nothing was verified by tests, and declaring a command later switches the checks on.
- **A test that cannot run.** `tdd_check.py defer --vo VO-nnn --reason "..."` records that
  an obligation's test is not being run. The agent may defer alone only for a recorded
  environment failure or for no test tooling; any other reason needs a named person's
  approval, as other exceptions do. A deferred obligation has the status `deferred`.
- **A check only a person can do.** The plan lists it in the `### Manual verification`
  table. The person records the result with
  `tdd_check.py manual --check MV-nnn --result pass|fail --by NAME`. Until then the check is
  `manual (open)`.

`status` lists these under "Not verified by tests" with a `Counts:` line, and `compliance`
gives notices for open or failed manual checks and for deferrals. Notices never fail the
check, whatever the proportion deferred. Deferrals and manual results are chained evidence
rows, so a casual edit shows. See the process rules,
[When verification is not possible](templates/tdd-process-rules.md), and the example runs
`examples/runs/no-tooling/` and `examples/runs/deferred/`.

## Observable criteria for successful operation

Each of these can be checked from a feature's artefacts, without reading its code. The
compliance check reads most of them; it is an evaluation aid and is not a step in normal
work, and no lifecycle command runs it. How to drive the stories and read the results is in
[docs/evaluation.md](docs/evaluation.md), the stories are in
[`examples/stories/`](examples/stories/), and two finished runs, one that followed the
process and one that only added tests, are in [`examples/runs/`](examples/runs/).

| Criterion | Where to see it | Success criterion |
|-----------|-----------------|-------------------|
| Every functional requirement and acceptance scenario has an obligation or an exemption with a reason, before implementation begins | `tdd_check.py plan` exits 0 | SC-001 |
| A story completes with the six standard commands only | No other command appears in the session | SC-002 |
| Every implemented behaviour has a failing run followed by a passing run, both recorded by the script, or a recorded exception with a rationale | `tdd-evidence.md`; `compliance` rules C5 | SC-003 |
| No test is weakened, skipped or removed to obtain a pass without a recorded justification, and an approval where behaviour changes | Expectation changes table; gate rules G5 and G8 | SC-004 |
| A reviewer who took no part can say, for any requirement, whether it is verified, by which tests and with what result, in under two minutes | The Summary in `tdd-evidence.md`; `tdd_check.py status` | SC-005 |
| Every blocked test, unresolved failure and exception appears in the evidence and none is reported as verified | `status`; `compliance` rule C7 | SC-006 |
| Routine cycles make no approval request; requests occur only for ambiguity, consequential trade-offs and exceptions beyond the agent's authority | The conversation | SC-007 |
| The plan's verification commands are the project's own, on at least three projects that differ in language and test framework | Verification commands table, Source column | SC-008 |
| The project's own lint, static analysis, security and CI configuration is untouched and still gates | `git diff` of the project's configuration; its own commands | SC-009 |
| Each example story produces its defined expected behaviour | The story's checklist | SC-010 |
| A run that only added test files is reported non-compliant, and the same result is given each time | `compliance` on `examples/runs/tests-only` | SC-011 |

SC-012, the view of developers and reviewers on understandability and overhead, needs
feedback from trial use and cannot be checked from artefacts.

The behaviour checklist adds these. They are numbered as in
[its specification](specs/002-bdd-behaviour-checklist/spec.md).

| Criterion | Where to see it | Success criterion |
|-----------|-----------------|-------------------|
| Every requirement and scenario is named by an item, every item names an obligation or exemption, and every obligation is named by an item | `tdd_check.py plan` exits 0 | SC-001 |
| Each seeded inconsistency in the fixtures is reported, identically on ten runs | The test suite | SC-002 |
| For any item, a reviewer can say which requirements it expresses and which tests verify it, in under two minutes | `status` | SC-003 |
| A reviewer can judge a 10 to 20 requirement checklist against its specification in under ten minutes | `status --scenarios` | SC-004 |
| A story completes with the standard commands, and no new command appears | The session | SC-005 |
| Every existing check gives the same result as before, and a feature planned before the change is reported as a gap | The compatibility test; the stages' gap report | SC-006 |
| Changing an item's outcome after implementation began without a record is reported non-compliant | `compliance` rule C8; gate rule G10 | SC-007 |
| A developer new to the workflow answers the four questions of the specification's User Story 5 from this README and the process rules in under five minutes | This section | SC-008 |
| In every compliant example, each scenario's outcomes appear unweakened in its items, with no two items for one behaviour | `examples/runs/compliant`, `examples/runs/frontend-planned` | SC-009 |
| Routine planning and implementation make no approval request on account of the checklist | The conversation | SC-010 |
| An attempt through the edit tools to change the evidence in its new location is refused every time | The hook; `tests/tdd-evidence.md` | SC-011 |

## Known limits

These are limits of the first release. None is presented as covered.

- **Shell edits bypass the hard stop.** The event guards the agent's Edit, Write and
  MultiEdit tools. An edit to `tasks.md` made through a shell command is not seen at the
  time. The end-of-stage `gate --all` and the compliance check report it afterwards.
- **An approver's name is not verified.** The script records the name it is given. The
  wrapped implement command tells the agent to record an approval only after the developer
  has given it in the conversation, and the name is visible to the reviewer.
- **`plan.md` is guarded for two headings only.** The edit tools cannot remove
  `## Verification Plan` or `### Behaviour checklist` from a `plan.md` that holds them. A
  shell edit that removes them is not seen at the time: it takes the feature out of the
  checks until a reviewer sees the diff, and the compliance check reports a missing Verification Plan afterwards.
- **The checklist's wording is judged by a person.** The checks compare ids, links and
  quotes. They do not decide whether an item keeps its scenario's wording as closely as it
  could, states every outcome and none weaker, or adds a behaviour the specification does
  not state.
- **B5 sees only fixed token shapes.** It flags paths and code-shaped identifiers (names
  with an underscore, a call such as `name()`, lower camel case, or text in backticks)
  that the specification does not use and the plan or task list does. Other
  implementation wording is left to the rules and the reviewer.
- **Duplicate items are not detected.** That no two items describe one behaviour is for
  the plan stage and the reviewer.
- **Item baseline rows are not chained.** They can be changed by a shell edit without the
  check value showing it, as for the exception and expectation tables. The agent's edit
  tools are refused for the whole evidence document.
- **A declared command is trusted.** A command added to the Verification commands table
  counts as declared whatever it runs. The table's Source column and the diff of `plan.md`
  show a reviewer where each command came from.
- **Only named test files are fingerprinted.** The fingerprint covers the test files named
  on a failing-first record. A change to any other existing test is forbidden by the
  process rules and visible in the diff, and is not detected by a check.
- **The check value is not a signature.** The chained value on each evidence row shows a
  casual edit. It does not resist an agent that recomputes it.
- **Full enforcement is on Claude Code only.** Other agents get the rules and the checks,
  and no hard stop until a payload adapter is added for them.
- **A composed command can keep the wrapper after removal.** When another preset wraps the
  same command, Spec Kit stores its composed text and does not recompose it when this
  preset is removed. The leftover note says to carry on as core Spec Kit when the check
  script is absent, so it is inert. Removing and re-adding the other preset refreshes it.
- **The archive install commands were not run against a published tag.** The path tested
  is a release tree made by `git archive` and installed with `--dev`. The `--from` form
  shown under Install uses Spec Kit's documented option and is untried here.
- **Large features slow down.** `gate --all`, `status` and `compliance` scan every record
  per task or obligation and take longer than two seconds at about ten times the stated
  scale of 200 tasks and 1,000 records.
- **Items stay editable with no baseline.** A feature with no recorded run has no fixed
  behaviour items, so its checklist can be edited freely until the first run.
- **A person's word on manual checks.** `manual` records the name and result it is given.
  Nothing confirms that the check was done as the steps say.
- **The reason for a deferral is judgement.** The checks require a reason and, outside an
  environment failure or no test tooling, an approval. They do not decide whether the reason
  is good.
- **All deferred completes, by design.** A feature whose obligations are all deferred
  passes, with notices. A reviewer reads the counts.
- **Windows is untested.**
- **No bundle.** The two packages are installed by two commands.

## Releasing

Both manifests declare the version; the tag must match (`v0.3.0` for `0.3.0`). Pushing a tag
runs `.github/workflows/release.yml`, which builds the zip and attaches it to a GitHub
release. The same zip can be built locally from any tag, local or on GitHub:

```bash
tools/release-zip.sh v0.3.0        # writes dist/speckit-tdd-integrated-0.3.0.zip
```

The script refuses a tag whose manifests declare another version. The zip holds only the
files not marked `export-ignore` in `.gitattributes`, which is what GitHub's own tag archive
holds too, so the install URLs under Install work with either.

## Development

```bash
python3 -B -m unittest discover -s tests
uvx ruff check .
npx -y markdownlint-cli2
```

The design is in [`specs/001-integrated-tdd/`](specs/001-integrated-tdd/): the
specification, plan, research, data model and contracts. Fixture features under
`tests/fixtures/features/` are generated by `tests/fixtures/make_features.py`.

Background on Spec Kit's customisation mechanisms is in
[speckit-overview.md](speckit-overview.md). The approach takes
[spec-kit-tdd](https://github.com/d0whc3r/spec-kit-tdd) as its reference and differs from it
in adding no command.

## Licence

MIT. See [LICENSE](LICENSE).
