# Research: README Screenshots from a Seeded GitLab Demo

## R1. Where the demo code lives

**Decision**: `test/demo/`, run with `node` directly like `test/gitlab/clean.ts`.
**Rationale**: XI.4 allows writes to the local instance only from test-only code under `test/`, never through an adapter. The existing seeder already follows this.
**Alternatives considered**: `gitlab/` scripts (bash and Ruby, outside `test/`, and they would duplicate the REST client). A Rails runner seed (it would bypass the API the adapters read, so the demo would not prove anything).

## R2. Group layout and names

**Decision**: the persistent top-level group `prwb-demo` and the demo subgroup `prwb-demo/acme`. The users are `demo-reviewer` ("Demo Reviewer") and `demo-author` ("Demo Author"), with `@prwb.invalid` emails. Clean deletes the subgroup and the two users, never `prwb-demo` itself.
**Rationale**: GitLab 19 cannot permanently delete a top-level group. It stays "deletion scheduled" under its path, so a clean followed by a seed would collide. A subgroup can be permanently removed, which is the reason `prwb-it` exists. No demo name starts with `it-`, so `npm run gitlab:clean` (which deletes `it-*` items) never touches the demo, and the demo clean never touches `prwb-it`.
**Alternatives considered**: a top-level `prwb-demo` group deleted by clean (re-seed breaks for days). A subgroup under `prwb-it` (it mixes demo and test data and confuses `listLeftovers`).

## R3. Idempotency

**Decision**: every create is find-then-create by a fixed key. The group and projects are found by full path, users by username, the issue by exact title, merge requests by source branch, notes by exact body, and the approval by the reviewer's entry in the approval state. Branch content is pushed only when the branch is missing. Each item is reported as `created` or `exists`.
**Rationale**: FR-007 and SC-003 count projects, issues and merge requests. Fixed keys make the check exact without any state file.
**Alternatives considered**: a local state file of created ids (it drifts from the instance). Reusing `GitlabSeeder.begin()` (it always makes a fresh timestamped run).

## R4. Seeder parameters for the live test

**Decision**: `seed()` and `clean()` take `{ group, userPrefix }`, defaulting to `prwb-demo/acme` and `demo`. `test/gitlab/demo.test.ts` passes a run-scoped `prwb-demo/it-demo-<stamp>` and `it-demo-<stamp>`, seeds twice, asserts the second report says `exists` for every item, then cleans.
**Rationale**: XI.4 says each suite changes only data it created. A test must not wipe a maintainer's demo, and the `it-` names mean `gitlab:clean` sweeps any leftovers.
**Alternatives considered**: testing against the fixed demo group (it destroys the maintainer's state).

## R5. The spec-linked merge request cannot also reference an issue

**Decision**: split FR-006's "merge request referencing an issue with a matching feature spec and TDD evidence" into two merge requests. The spec one is on branch `014-discount-codes` and carries `specs/014-discount-codes/discount-codes.spec.md` and `specs/014-discount-codes/tests/tdd-evidence.md`. No issue reference appears in its branch, title or description. A separate merge request, "Fix cart total rounding", says `Closes #1` and links the demo issue.
**Rationale**: spec context searches by tracker key when the pull request has any. A GitLab Issues key is `prwb-demo/acme/storefront#1`, and a `specs/<folder>` name cannot contain it, so that lookup always ends "no folder". The branch-name fallback (feature 007, R12) applies only when there is no key. Changing the lookup is product work outside this spec.
**Alternatives considered**: changing spec matching for GitLab keys (out of scope, and it touches core). A Jira-style key in the title (there is no Jira in the demo).

## R6. Which merge request shows which feature

**Decision** (the ready selectors are listed in `contracts/screenshots.md`):

| Merge request (project `storefront` unless noted) | Shows |
|---|---|
| !1 "Add session tokens and sessions table": `src/auth/session.ts`, `db/migrations/0007_create_sessions.sql`, `src/cart/total.ts`, `src/generated/session-types.ts` | overview summary, review focus, diff with risk, ask a question |
| !2 "Update dependencies": `package-lock.json`, `src/generated/api-types.ts` | reduced review (in the review-focus image) |
| !3 `014-discount-codes` "Add discount codes": `specs/014-discount-codes/discount-codes.spec.md`, `specs/014-discount-codes/tests/tdd-evidence.md`, `src/cart/discounts.ts`, `test/cart/discounts.test.ts` | specification alignment |
| !4 "Fix cart total rounding", `Closes #1`: `src/cart/total.ts`, a demo-author line comment on it with a demo-reviewer reply | comments and replies |
| !5 "Tidy README badges", approved by demo-reviewer | review decision |
| `billing-api` !1 "Add invoice export": `src/invoices/export.ts`, `src/invoices/csv.ts` | a second repository in the review queue |

**Rationale**: the rules alone make R-AUTH and R-MIGRATION files Critical, so no scripted risk output is needed. Review focus lists only the session's own files, so !1 carries a generated file too: its review-focus image shows Critical files and a mechanical candidate in one panel. !2 stays for variety in the review queue.

## R7. Running the node:test helpers from a plain script

**Decision**: `test/demo/after-hooks.ts` exports `createAfterHooks()`, which returns `{ after(fn), run() }`. `run()` calls the callbacks in reverse order, keeps going when one fails, and is always called in `finally`.
**Rationale**: `startWorkbench` and `useBrowser` need only an object with `after`. A collector reuses them unchanged, including the temp app data, the fake keyring and the restoring of PATH, HOME and XDG_DATA_HOME.
**Alternatives considered**: running as a `node --test` file (its output reads as a test run, not a command listing the files it wrote). Refactoring the helpers (it changes tested code for one caller).

## R8. Fixed AI text per view

**Decision**: each view in `scenarios.ts` carries its fake `summary`, `answer` and `alignment`. The script calls `fake.configure(view.ai)` before it opens that view's session. Citations point at line ranges in the seeded files and at passages in the demo spec, which are fixed in `scenarios.ts`.
**Rationale**: `FakeConfig` holds one output per kind. Configuring before each session gives each merge request its own text. Citations to real lines show as checked Evidence and not as "not found" markers.

## R9. Credentials, clock and paths

**Decision**:
- `GITLAB_URL` and `GITLAB_TOKEN` (the root token) come from the environment, with the existing defaults. The script uses the root token only to mint a `demo-reviewer` token and revokes that token at the end, so the signed-in account on screen is "Demo Reviewer".
- The page clock is pinned to the newest demo merge request's `created_at` plus one hour, so ages read "1 hour ago" and stay stable across reruns.
- Clones go in `<os tmpdir>/prwb-demo/`, so every path the UI shows is inside the demo folder.
**Rationale**: SC-004 rules out a real name or token on screen. The default `PINNED_NOW` (2026-11-10) comes before the seed date and would show negative ages.

## R10. Failure keeps the previous image

**Decision**: `captureTo(file, view)` waits for `view.ready` (15 s, through `waitFor`), writes the image to `<file>.tmp`, then renames it over `<file>`. On any failure it deletes the temp file, records `<view>: <reason>`, and moves on to the next view. The command exits 1 at the end if any view failed, listing each one.
**Rationale**: FR-012 asks the command to name the view and keep the old image. Rename is atomic on one filesystem.

## R11. What the README says about GitLab decisions

**Decision**: the review-decision entry says that GitLab supports approve and withdraw, and that Request changes shows as unavailable there.
**Rationale**: `reviewCapability` reports `request_changes` as not allowed on GitLab. The screenshot will show that, so the text has to agree (SC-005).

## R12. Out-of-scope files

**Decision**: `gitlab/README.md` stays unchanged. The README's Development section points to it for starting GitLab.
**Rationale**: the spec limits prose changes to `README.md`.
