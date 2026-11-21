# Implementation Plan: README Screenshots from a Seeded GitLab Demo

**Spec**: `readme-screenshots.spec.md` | **Size**: normal | **Research**: `research.md` | **Design**: `data-model.md`, `contracts/`

## Summary

The README gets a Features section with eight entries. Each entry has a short description and a PNG from `docs/screenshots/`. The README is also corrected in place: the "never comments or approves" bullet, the sign-in table (it is missing GitLab and GitLab Issues), the Specification section (it says "Jira key" and leaves out the branch-name fallback), and the Development section, which gets the demo commands.

Three test-only commands produce the images, all under `test/demo/` because constitution XI.4 allows platform writes only from `test/`.
- `npm run gitlab:demo` seeds a fixed demo on the local GitLab: the subgroup `prwb-demo/acme`, two projects, an issue, five merge requests, and two users with neutral display names. It finds an item by path before it creates one, so a second run creates nothing.
- `npm run gitlab:demo:clean` removes the subgroup and the two demo users and nothing else.
- `npm run screenshots` mints a short-lived reviewer token, clones the demo projects into one folder, and runs the real workbench through the existing test harness (`startWorkbench`, `useBrowser`, the fake `claude` CLI). It gives the fake CLI demo text for each view, captures each view at 1440×900 in light theme, and writes each image only after its view reaches its ready state.

No product code changes and no new dependencies. The commands reuse `GitlabAdmin`, the push and merge-request logic in `test/seeder/gitlab-seeder.ts`, and the helpers in `test/helpers/`.

## Project Structure

```text
README.md                         Features section; in-place fixes (FR-001..FR-004, FR-013)
docs/screenshots/                 NEW  eight PNGs, names in contracts/screenshots.md
package.json                      scripts gitlab:demo, gitlab:demo:clean, screenshots
test/seeder/gitlab-seeder.ts      export `until`; small find-or-create helpers on GitlabAdmin
test/demo/
  scenarios.ts                    NEW  the demo as data: group, users, projects, MRs, files, issue, notes, AI text per view
  seed.ts                         NEW  idempotent seeder: probe, find-or-create, report each item and its purpose
  clean.ts                        NEW  removes prwb-demo/acme and the demo users only
  screenshots.ts                  NEW  isolated workbench run, one capture per view, keep-previous on failure
  after-hooks.ts                  NEW  `{ after }` collector so the node:test helpers run in a plain script
test/unit/demo-scenarios.test.ts  NEW  every README feature has a scenario and a view; names avoid `it-`
test/unit/readme-features.test.ts NEW  README Features entries, image files exist, alt text present, no stale claims
test/unit/capture-file.test.ts    NEW  failed capture keeps the previous image and names the view
test/gitlab/demo.test.ts          NEW  live: seed twice → zero creations; clean leaves prwb-it untouched
```

**Structure Decision**: all writing code lives in `test/demo/` and reuses `test/seeder/` and `test/helpers/`. Nothing in `src/` changes.

## Calls

```text
npm run gitlab:demo
  test/demo/seed.ts
    probeGitlab()                          test/gitlab/env.ts      fails with START_HINT when GitLab is down
    GitlabAdmin.findOrCreate*()            test/seeder/gitlab-seeder.ts
    pushFiles / openMergeRequest           git CLI + REST, waits via until()
    → prints one line per item: created | exists, with its purpose

npm run screenshots
  test/demo/screenshots.ts
    probeGitlab(); mint reviewer token     GitlabAdmin, revoked in after-hooks
    clone demo projects into <tmp>/prwb-demo/   liveClone-style credential in temp HOME
    useBrowser(hooks, { fake, live })      test/helpers/browser.ts → startWorkbench (temp app data, fake keyring)
    for each view in scenarios.views:
      fake.configure(view.ai)              test/helpers/fake-ai-cli.ts
      openPage(view.hash, { now })         waits for view.ready selector
      captureTo(docs/screenshots/<file>)   writes <file>.tmp, renames only on success
    hooks.run()                            restores PATH/HOME/XDG_DATA_HOME, closes server and browser
```

## Constitution Check

| Principle | Assessment |
|---|---|
| I Evidence before opinion | PASS. Demo AI text cites real seeded lines and spec passages, so the citation checks pass on screen and show the labels as they really appear. |
| II Human accountability | PASS. The product makes no new writes. The approval and the comment thread are created by test code acting as the demo users, not by the workbench. |
| III Separation of records | PASS. Not touched. |
| IV Explainability | PASS. Not touched. The Critical class comes from the built-in R-AUTH and R-MIGRATION rules. |
| V Missing context shown | PASS. The README describes gaps as they are. The Request changes control shows as unavailable on GitLab, and the README says so. |
| VI Incremental integration | PASS. Reuses GitLab, the fake CLI and Playwright, which is already a dev dependency. |
| VII No developer metrics | PASS. Demo users have neutral names. Nothing ranks a person. |
| VIII Provider neutrality | PASS. No product code changes. The platform names stay in test code and docs. |
| IX Repository safety | PASS. The screenshot run uses its own clones in a temp folder. The developer's tree is never used. |
| X Local server security | PASS. The workbench runs through the normal server with the fake keyring. The tokens are throwaway local-instance credentials (X.7). The minted reviewer token is revoked at the end of the run. |
| XI Test-first | PASS. Unit tests for scenario coverage, README integrity and keep-previous capture come first. One live test proves idempotency and that clean is scoped (XI.4: loopback only, test-only code, it changes only data it created). |

Re-checked after Phase 1 design: no change.

## Verification Plan

Added after analysis on 2026-11-14 to bring the feature under the integrated-tdd process (constitution XI.1). Edge cases are cited by the `EC-nn` labels added to the spec's Edge Cases.

### Verification commands

| ID | Command | Scope | Source |
|----|---------|-------|--------|
| unit | `node --test {select}` | focused | `package.json` script `test` runs `node --test "test/**/*.test.ts"`; the selector narrows it to one test file |
| typecheck | `npm run typecheck` | focused | `package.json` script `typecheck` |
| test-all | `npm test` | broad | `package.json` script `test` |
| test-gitlab | `npm run test:gitlab` | broad | `package.json` script `test:gitlab` (needs `npm run gitlab:up` and `gitlab:bootstrap`) |

### Verification obligations

| ID | Requirements | Scenario | Expected outcome | Level | Origin |
|----|--------------|----------|------------------|-------|--------|
| VO-001 | FR-001, US1-AS1, SC-001 | The README is read alongside the demo views | A Features section comes before Requirements with one entry per view, eight in all (review queue, overview summary, review focus, diff with risk, ask a question, specification alignment, comments and replies, review decision), each with a description and an image | unit | planned |
| VO-002 | FR-002, FR-003 | Every image link in Features is resolved | Each is a relative `docs/screenshots/*.png` path to a file that exists, with non-empty alt text | unit | planned |
| VO-003 | FR-004, US1-AS3, US1-AS4, SC-005 | The README is read for platform and write claims | No text says the workbench never comments or approves; reviewer actions are named as the exception to read-only; GitLab and GitLab Issues are listed beside GitHub, Bitbucket Cloud and Jira; the decision entry says Request changes is unavailable on GitLab; the original sections keep their order | unit | planned |
| VO-004 | FR-013 | The Development section is read | It names the demo seed, demo clean and screenshot commands | unit | planned |
| VO-005 | FR-005, FR-006, US1-AS2 | The demo data is inspected | Every FR-006 merge request exists; the Critical one has an authentication file, a migration, an ordinary file and a mechanical file; the spec-linked one carries a spec with acceptance criteria and TDD evidence and no issue reference; one closes the demo issue; one has a comment with a reply; one is approved; every scripted AI citation resolves to seeded content | unit | planned |
| VO-006 | FR-005, FR-007, US2-AS1, US2-AS2, SC-003 | A run-scoped demo is seeded twice on the local GitLab | The first report lists every item with its purpose; the second reports every item as existing and creates nothing | integration | planned |
| VO-007 | FR-008, US2-AS4, EC-01 | The run-scoped demo is cleaned | Its subgroup and two users are gone; the integration-test group and the persistent demo parent group remain | integration | planned |
| VO-008 | US2-AS3 | Seed and clean target a loopback port where nothing listens | Each stops with a message naming the command that starts GitLab and sends no write | unit | planned |
| VO-009 | FR-008, DC-01 | Seed and clean are given a non-loopback URL, or a group outside the demo parent group | Each is refused before any request is sent (DC-01: platform writes only on the loopback test instance, constitution XI.4) | unit | planned |
| VO-010 | FR-012, US3-AS2, EC-04 | A capture's expected state never appears, or the image write fails | The previous image is unchanged byte for byte, no temporary file remains, and the result names the view and the reason | unit | planned |
| VO-011 | FR-002, US3-AS1 | A capture's expected state appears | The image is written under its final name and the result reports success | unit | planned |
| VO-012 | FR-009, US3-AS3 | The screenshot run's workbench setup is built and torn down | App data is inside the OS temp folder, the keyring is the fake one, and PATH, HOME and XDG_DATA_HOME are restored afterwards | unit | planned |
| VO-013 | FR-010, FR-011, EC-03, EC-05 | The demo view settings are inspected | Every view uses a 1440×900 viewport, the light theme and its own fixed AI text | unit | planned |

### Verification exemptions

| Requirement | Reason | Alternative verification |
|-------------|--------|--------------------------|
| SC-002 | Wall-clock time on a developer machine against a live GitLab | MV-001 |
| SC-004 | Judging what an image shows needs a person | MV-002 |
| EC-02 | The same image judgement as SC-004 | MV-002 |

### Manual verification

| ID | Covers | Steps | Expected result | Why not automated |
|----|--------|-------|-----------------|-------------------|
| MV-001 | SC-002, US3-AS1 | 1. `npm run gitlab:reset`, then `npm run gitlab:bootstrap`. 2. Time `npm run gitlab:demo` followed by `npm run screenshots`. | Both finish in under 5 minutes in total; the screenshot command lists eight written files | Needs a freshly reset live GitLab and a wall clock |
| MV-002 | SC-004, EC-02, US1-AS2 | Open each image in `docs/screenshots/`. | No real token, real person's name or path outside the demo folder appears; each image makes its feature obvious | Judging image content needs a person |

### Behaviour checklist

Behaviour items are in [tests/behaviour-checklist.md](tests/behaviour-checklist.md).
