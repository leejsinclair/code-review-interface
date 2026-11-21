# Tasks: README Screenshots from a Seeded GitLab Demo

**Spec**: `readme-screenshots.spec.md` | **Plan**: `plan.md` (Verification Plan VO-001..VO-013) | **Checklist**: `tests/behaviour-checklist.md` | **Design**: `data-model.md`, `contracts/screenshots.md`, `research.md`

Line format: `- [ ] T### [P?] [US#?] [VO-nnn… | NT: reason] Description · file`. Each obligation's test task comes before the task that delivers it (constitution XI.1). Nothing in `src/` changes.

## Phase 1: Setup

Files: `package.json`

- [x] T001 [NT: npm script wiring with no behaviour of its own] Add scripts `gitlab:demo` (`node test/demo/seed.ts`), `gitlab:demo:clean` (`node test/demo/clean.ts`) and `screenshots` (`node test/demo/screenshots.ts`) per contracts §1 · package.json

## Phase 2: Foundational

Files: `test/seeder/gitlab-seeder.ts`, `test/demo/after-hooks.ts`, `test/demo/scenarios.ts`, `test/unit/demo-scenarios.test.ts`

Blocks every story: seed, clean and screenshots read `scenarios.ts`, and the README test reads its `views`.

**Wave 1 — independent (different files):**

- [x] T002 [P] [VO-005] [VO-013] Write failing test: `views` has eight entries, one per headline feature, unique lowercase kebab-case `.png` files and non-empty `alt`; every FR-006 scenario exists; `DEMO_GROUP` has the form `prwb-demo/<name>`; no group, user or project name starts with `it-`; !1 has an R-AUTH file (`src/auth/…`), an R-MIGRATION file (`db/migrations/…`), an ordinary file and a generated file (`src/generated/…`); !2 holds only `package-lock.json` and `src/generated/…`; !3 is on `014-discount-codes` with `specs/014-discount-codes/discount-codes.spec.md` and `specs/014-discount-codes/tests/tdd-evidence.md` and no issue reference; !4 says `Closes #1`, changes `src/cart/total.ts`, and its first note has a `path` and `line` that !4 changes, with one reviewer reply; !5 is approved by the reviewer; every `ai` citation points at a line range in that MR's seeded files or a passage in the demo spec; every view uses `VIEWPORT` 1440×900, `COLOR_SCHEME` light and its own `ai` · test/unit/demo-scenarios.test.ts
- [x] T003 [P] [NT: test-support REST helpers; their behaviour is verified through VO-006 and VO-007] Export `until`; add find-or-create helpers to `GitlabAdmin` (group and project by full path, user by username, issue by exact title, MR by source branch, note by exact body, approval state), each returning `created | exists`, and a helper that opens a diff discussion at a file and new-side line using the merge request's `diff_refs` · test/seeder/gitlab-seeder.ts
- [x] T004 [P] [NT: test-harness plumbing; its restore behaviour is verified through VO-012] `createAfterHooks()` returning `{ after(fn), run() }`; `run()` calls callbacks in reverse order and keeps going when one throws (R7) · test/demo/after-hooks.ts

**⟶ Wait for Wave 1 to finish, then:**

- [x] T005 [VO-005] [VO-013] Demo as data per data-model.md and contracts §2–§4: `DEMO_GROUP`, `DEMO_USER_PREFIX`, `VIEWPORT`, `COLOR_SCHEME`, users `demo-reviewer`/`demo-author` with `@prwb.invalid` emails, `storefront` (issue #1; MRs !1–!5 with files from contracts §3, including `src/generated/session-types.ts` on !1, a line note on `src/cart/total.ts` at its rounding line plus a reply on !4, approval, scenario purpose) and `billing-api` (!1), and eight `views` with `name`, `file`, `route`, `ready`, `actions` (ask-question fills `[data-testid="question-input"]` and clicks `[data-testid="ask-button"]`), `ai` and `alt`; T002 goes green · test/demo/scenarios.ts

**Checkpoint**: `node --test test/unit/demo-scenarios.test.ts` passes.

## Phase 3: User Story 1 — See what the workbench does before installing it (P1) 🎯 MVP

Files: `README.md`, `test/unit/readme-features.test.ts`

**Goal**: a Features section with eight entries, each a short true description and a screenshot, and every contradicted statement fixed in place.

**Independent Test**: `test/unit/readme-features.test.ts` passes, and the README on the repository host shows eight loading images and no stale claims.

### Tests

- [x] T006 [US1] [VO-001] [VO-002] [VO-003] [VO-004] Write failing test: Features sits immediately after the intro, before `## Requirements`, with one entry per `views` item; each links `docs/screenshots/<file>` by relative path with non-empty alt text and the file exists; the original section order is unchanged; no text says the workbench never comments or approves and reviewer actions are named as the exception to read-only; GitLab and GitLab Issues are in the sign-in and platform tables beside GitHub, Bitbucket Cloud and Jira; the review-decision entry says GitLab supports approve and withdraw and Request changes shows as unavailable (R11); Development names `npm run gitlab:demo`, `npm run gitlab:demo:clean` and `npm run screenshots` · test/unit/readme-features.test.ts

### Implementation

**⟶ Wait for T006, then:**

- [x] T007 [US1] [VO-001] [VO-002] [VO-003] [VO-004] Insert the Features section immediately after the intro, before `## Requirements` (eight entries, descriptions, image links, alt text from `views`); fix in place the read-only bullet, the sign-in and platform tables, the Specification section (branch-name fallback, not "Jira key" alone); add the demo seed, clean and screenshot commands to Development, pointing to `gitlab/README.md` for starting GitLab (FR-001..FR-004, FR-013) · README.md

**Checkpoint**: every T006 assertion passes except image existence, which turns green once T015 has written `docs/screenshots/`.

## Phase 4: User Story 2 — Seed a varied demo on local GitLab with one command (P2)

Files: `test/demo/seed.ts`, `test/demo/clean.ts`, `test/gitlab/demo.test.ts`, `test/unit/demo-guards.test.ts`

**Goal**: `npm run gitlab:demo` creates the demo idempotently; `npm run gitlab:demo:clean` removes only the demo subgroup and users; both refuse unsafe targets.

**Independent Test**: against a running local GitLab, seed twice (second report all `exists`), then clean, with `prwb-it` untouched; the guard tests pass with no GitLab running.

### Tests

**Wave 1 — independent (different files):**

- [x] T008 [P] [US2] [VO-006] [VO-007] Write failing live test, skipped like the other `test/gitlab` files when GitLab is not up: `seed({ group: 'prwb-demo/it-demo-<stamp>', userPrefix: 'it-demo-<stamp>' })` lists every item with its purpose; a second call reports `exists` for every line; `clean` with the same options removes that subgroup and both users and leaves `prwb-it` and `prwb-demo` intact (FR-005, FR-007, FR-008, SC-003) · test/gitlab/demo.test.ts
- [x] T009 [P] [US2] [VO-008] [VO-009] Write failing test: `seed` and `clean` with `gitlabUrl` set to a loopback port where nothing listens stop with the message naming `npm run gitlab:up` and send no write; with a non-loopback `gitlabUrl`, or a `group` not of the form `prwb-demo/<name>`, each is refused before any request (count requests through a stubbed fetch) · test/unit/demo-guards.test.ts

### Implementation

**⟶ Wait for Wave 1 to finish, then — Wave 2, independent (different files):**

- [x] T010 [P] [US2] [VO-006] [VO-008] [VO-009] `seed(options)` with `DemoOptions { group?, userPrefix?, gitlabUrl? }`: refuse a non-loopback URL and a malformed group; `probeGitlab()` and stop with START_HINT; find-or-create `prwb-demo`, the subgroup, users, projects with base files, issue, MR branches (push only when the branch is missing), MRs as demo-author, the line discussion on !4 (found by exact body) then the reply in that discussion, approval on !5 as demo-reviewer; print `<created|exists> <kind> <key> — <purpose>`; CLI entry exits 0 or 1 per contracts §1 · test/demo/seed.ts
- [x] T011 [P] [US2] [VO-007] [VO-008] [VO-009] `clean(options)`: same refusals and probe; permanently delete the subgroup and the two prefixed users, never `prwb-demo`; print one line per item, `absent` when missing; CLI entry · test/demo/clean.ts

**Checkpoint**: `node --test test/unit/demo-guards.test.ts` and `npm run test:gitlab` pass; `npm run gitlab:demo` run twice prints only `exists` the second time.

## Phase 5: User Story 3 — Regenerate every screenshot with one command (P3)

Files: `test/demo/screenshots.ts`, `test/unit/capture-file.test.ts`, `test/unit/screenshot-isolation.test.ts`, `docs/screenshots/*.png`

**Goal**: `npm run screenshots` runs the real workbench in isolation against the seeded demo and writes eight PNGs, keeping the previous image for any view that fails.

**Independent Test**: run the command twice with no code change; the same eight files are written with the same content, and the user's config and keychain are untouched.

### Tests

**Wave 1 — independent (different files):**

- [x] T012 [P] [US3] [VO-010] [VO-011] Write failing test with a stub page: `captureTo` writes `<file>.tmp` then renames over `<file>` when the ready selector appears and returns ok; on timeout or screenshot error it deletes `<file>.tmp`, leaves the previous `<file>` byte-identical, and returns `{ ok: false, reason }` naming the view (FR-012) · test/unit/capture-file.test.ts
- [x] T013 [P] [US3] [VO-012] Write failing test: `workbenchOptions()` puts app data inside `os.tmpdir()`, uses the fake keyring and puts the fake `claude` first on PATH; after `createAfterHooks().run()`, PATH, HOME and XDG_DATA_HOME equal their values before the run · test/unit/screenshot-isolation.test.ts

### Implementation

**⟶ Wait for Wave 1 to finish, then:**

- [x] T014 [US3] [VO-010] [VO-011] [VO-012] `captureTo(file, view, page)` and `workbenchOptions()` per contracts §2, and the CLI run: probe GitLab; mint a demo-reviewer token with the root token and revoke it in after-hooks; clone both demo projects into `<os tmpdir>/prwb-demo/`; `useBrowser(createAfterHooks(), workbenchOptions())`; viewport 1440×900, light scheme, clock pinned to the newest MR `created_at` + 1 h; for each view `fake.configure(view.ai)`, start its session, open `view.route`, run `view.actions`, `captureTo`; print each written file and each `<view>: <reason>`; exit 1 if any failed; `hooks.run()` in `finally` (FR-009..FR-012) · test/demo/screenshots.ts

**⟶ Wait for T014, then:**

- [x] T015 [US3] [VO-002] With GitLab up, run `npm run gitlab:demo` then `npm run screenshots`; commit the eight PNGs; rerun `npm run screenshots` and confirm the same files and content · docs/screenshots/*.png

**Checkpoint**: eight images exist in `docs/screenshots/`; T006's image-existence assertion passes, completing US1.

## Phase 6: Polish

- [ ] T016 [NT: manual checks MV-001 and MV-002, recorded with tdd_check.py manual] Time seed plus screenshots from `npm run gitlab:reset` and bootstrap (MV-001, SC-002); review each image for tokens, personal names or paths outside `prwb-demo/` and for whether it makes its feature obvious (MV-002, SC-004); compare the README with the product (SC-005). Any finding reopens its owning task (T005 or T007), then T015 reruns · (no file)
- [ ] T017 [NT: broad validation run against the Success Criteria] Run `npm run typecheck`, `npm test` and `npm run test:gitlab`; confirm every Success Criterion · (no file)

## Dependencies & Execution Order

- **Phases**: Setup → Foundational → US1, US2, US3 → Polish. The three stories own disjoint files and can be built in parallel after Foundational. T015 is where they meet: it needs US2's seeder (T010), US3's command (T014) and the scripts (T001), and it completes US1.
- **Phase 1**: T001 alone.
- **Phase 2**: Wave 1 (T002, T003, T004) → T005.
- **Phase 3 (US1)**: T006 → T007.
- **Phase 4 (US2)**: Wave 1 (T008, T009) → Wave 2 (T010, T011).
- **Phase 5 (US3)**: Wave 1 (T012, T013) → T014 → T015.
- **Phase 6**: T016 → T017, after T015.
