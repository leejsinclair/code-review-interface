# Data Model: README Screenshots from a Seeded GitLab Demo

**Spec**: `readme-screenshots.spec.md` | **Plan**: `plan.md` | **Research**: `research.md`

This feature adds no product data. Every entity below is test-only data defined in `test/demo/scenarios.ts`, created on the local GitLab instance by `test/demo/seed.ts`, or written to the repository (`README.md`, `docs/screenshots/`). Nothing in `src/` changes, and no workbench store schema changes.

## Overview

```text
DemoConfig ──1──* DemoUser
     │
     └──1──* DemoProject ──1──* DemoMergeRequest ──*──1 DemoScenario ──1──1 FeatureView ──1──1 FeatureEntry
                  │                  │                                         │
                  └──0..1 DemoIssue ◀┘ (Closes #1)                             └── ViewAi (fake AI text)
                                     ├──0..* DemoNote
                                     └──0..1 DemoApproval

SeedReport ──1──* SeedItem          CaptureRun ──1──* CaptureResult
```

## Entities

### DemoConfig

Run parameters for `seed()` and `clean()` (R4).

| Field | Type | Default | Notes |
|---|---|---|---|
| `group` | string | `prwb-demo/acme` | Full path of the demo subgroup. Always a subgroup of `prwb-demo`. |
| `userPrefix` | string | `demo` | Prefix for demo usernames: `<prefix>-reviewer`, `<prefix>-author`. |
| `gitlabUrl` | string | `GITLAB_URL` or the existing default | Loopback only (XI.4). |
| `token` | string | `GITLAB_TOKEN` or the existing default | Root token of the local instance. Never printed. |

**Validation**
- `group` MUST have the form `prwb-demo/<name>`; the top-level `prwb-demo` itself is never a target of clean (R2).
- The default `group` and `userPrefix` MUST NOT start with `it-` (so `npm run gitlab:clean` never touches the demo). The live test passes `prwb-demo/it-demo-<stamp>` and `it-demo-<stamp>` so leftovers are swept by `gitlab:clean` (R4).
- The URL MUST resolve to loopback; otherwise the command stops.

### DemoUser

| Field | Type | Example | Notes |
|---|---|---|---|
| `role` | `'reviewer' \| 'author'` | `reviewer` | |
| `username` | string | `demo-reviewer` | Key for find-or-create. |
| `name` | string | `Demo Reviewer` | Display name shown on screen. |
| `email` | string | `demo-reviewer@prwb.invalid` | `.invalid` TLD only. |

**Validation**: names are neutral and never a real person (SC-004, constitution VII). Exactly one reviewer and one author per config.

### DemoProject

| Field | Type | Example | Notes |
|---|---|---|---|
| `path` | string | `storefront`, `billing-api` | Key: `<group>/<path>`. |
| `description` | string | | Throwaway text. |
| `defaultBranch` | string | `main` | |
| `baseFiles` | `Record<string, string>` | | Content of the initial commit on `main`. |
| `issues` | `DemoIssue[]` | | `storefront` has one; `billing-api` has none. |
| `mergeRequests` | `DemoMergeRequest[]` | | Five in `storefront`, one in `billing-api` (R6). |

**Validation**: exactly two projects; project paths unique within the group; no path starts with `it-`.

### DemoIssue

| Field | Type | Example | Notes |
|---|---|---|---|
| `title` | string | `Cart total rounds half-cents down` | Key: exact title within the project. |
| `description` | string | | |
| `iid` | number | `1` | Assigned by GitLab; referenced as `#1` by !4. |

### DemoMergeRequest

| Field | Type | Example | Notes |
|---|---|---|---|
| `sourceBranch` | string | `014-discount-codes` | Key for find-or-create. |
| `title` | string | `Add discount codes` | |
| `description` | string | `Closes #1` | Only !4 references an issue (R5). |
| `author` | `DemoUser.role` | `author` | Opened as demo-author. |
| `files` | `Record<string, string>` | | Pushed to `sourceBranch` only when the branch is missing (R3). |
| `notes` | `DemoNote[]` | | Only !4. |
| `approvedBy` | `DemoUser.role?` | `reviewer` | Only !5. |
| `scenario` | `DemoScenario.id` | `critical-risk` | Which feature it exists to show. |

**Validation**
- Source branches unique per project.
- !1 MUST include at least one file matching R-AUTH (`src/auth/…`) and one matching R-MIGRATION (`db/migrations/…`), plus one ordinary file, so the built-in rules produce Critical next to a lower class with no scripted risk output. It MUST also include one generated file (`src/generated/…`) so review focus lists a mechanical candidate in the same panel (R6).
- !2 MUST contain only lockfile and generated files (`package-lock.json`, `src/generated/…`) so it is a reduced-review change.
- !3 MUST use branch `014-discount-codes`, carry `specs/014-discount-codes/discount-codes.spec.md` (with acceptance criteria) and `specs/014-discount-codes/tests/tdd-evidence.md`, and `src/cart/discounts.ts`, so the alignment text can cite code against an acceptance criterion, and MUST NOT reference any issue in branch, title or description, so spec context falls back to the branch name (R5).
- !4 MUST say `Closes #1`, change `src/cart/total.ts`, and carry one author line comment on it with one reviewer reply.
- !5 MUST be approved by demo-reviewer.

### DemoNote

| Field | Type | Notes |
|---|---|---|
| `by` | `DemoUser.role` | Author writes the first note, reviewer replies. |
| `body` | string | Key: exact body within the merge request. |
| `path` | string? | File the first note is anchored to, e.g. `src/cart/total.ts`. Replies inherit the thread's position. |
| `line` | number? | New-side line in `path`; MUST be a line the merge request changes. |
| `replyTo` | index into `notes?` | Reply lands in the same discussion. |

**Validation**: the first note on !4 MUST be a line comment on `src/cart/total.ts`, on the changed line holding the rounding call. The reply is posted into the same discussion.

### DemoApproval

Not stored as data beyond `approvedBy`. Key: the reviewer's entry in the merge request's approval state (R3).

### DemoScenario

The spec's "Demo scenario" key entity: one merge request, the feature it illustrates, and why its content makes the feature visible.

| Field | Type | Example |
|---|---|---|
| `id` | string | `critical-risk`, `reduced-review`, `spec-linked`, `discussion`, `approved`, `second-repo` |
| `project` | `DemoProject.path` | `storefront` |
| `sourceBranch` | `DemoMergeRequest.sourceBranch` | |
| `purpose` | string | `Critical file (auth + migration) next to an ordinary change` |

**Validation**: every scenario that FR-006 names exists (critical risk, reduced review, spec-linked with TDD evidence, existing discussion, approved). `purpose` is printed by the seed report (US2 AS1).

### FeatureView

One screenshot to capture. Defined in `scenarios.views`; ready selectors and file names are fixed in `contracts/screenshots.md`.

| Field | Type | Example | Notes |
|---|---|---|---|
| `name` | string | `review-focus` | Used in failure messages (FR-012). |
| `feature` | `FeatureEntry.id` | `review-focus` | Exactly one feature per view. |
| `scenario` | `DemoScenario.id?` | `critical-risk` | Absent for the review queue. |
| `route` | `(sessionId) => string` | `#/sessions/:sessionId` | Route the browser opens. |
| `ready` | string | CSS / test-id selector | Must be visible before capture. |
| `actions` | `({ fill, text } \| { click })[]?` | | Run in order before waiting for `ready`, e.g. fill the question and submit it. |
| `file` | string | `review-focus.png` | Under `docs/screenshots/`. |
| `ai` | `ViewAi` | | Fake AI text for this view. |

**Validation**
- Eight views, one per headline feature: review queue, overview summary, review focus, diff with risk, ask a question, specification alignment, comments and replies, review decision (FR-001, SC-001).
- `file` names are unique, lowercase kebab-case, `.png`.
- Viewport 1440×900, colour scheme `light` for every view (FR-011).

### ViewAi

The fake `claude` CLI output for one view, passed to `fake.configure()` before its session opens (R8). Shape follows `FakeConfig` in `test/helpers/fake-ai-cli.ts`.

| Field | Type | Notes |
|---|---|---|
| `summary` | structured summary output | Overview text. |
| `answer` | structured answer output | Ask-a-question view. |
| `alignment` | structured spec-alignment output | Spec alignment view; criteria match the demo spec. |

**Validation**: every citation MUST point at a line range that exists in that merge request's seeded files, or at a passage present in the demo spec, so the UI shows checked Evidence rather than "not found" (R8, constitution I). Text is fixed, so reruns are deterministic (FR-010).

### FeatureEntry

The spec's "Feature entry" key entity: one item in the README Features section.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Matches `FeatureView.feature`. |
| `heading` | string | README heading text. |
| `description` | string | One or two sentences, true of current behaviour. |
| `image` | string | Relative path `docs/screenshots/<file>.png` (FR-002). |
| `alt` | string | Non-empty, describes what the image shows (FR-003). |

**Validation** (checked by `test/unit/readme-features.test.ts`)
- One entry per `FeatureView`; the image file exists in the repository.
- The review-decision entry states GitLab supports approve and withdraw and that Request changes shows as unavailable there (R11).
- No README text says the workbench never comments or approves; GitLab and GitLab Issues appear in the sign-in and platform tables (FR-004).
- Existing README sections keep their order; Features is inserted near the top.

### SeedReport / SeedItem

Output of one seed run.

| Field | Type | Notes |
|---|---|---|
| `kind` | `'group' \| 'user' \| 'project' \| 'issue' \| 'merge_request' \| 'note' \| 'approval'` | |
| `key` | string | The find-or-create key (path, username, title, branch, body). |
| `status` | `'created' \| 'exists'` | |
| `purpose` | string? | From `DemoScenario.purpose` for merge requests. |

**Validation**: a second run against an unchanged instance reports status `exists` for every item (FR-007, SC-003).

### CaptureRun / CaptureResult

| Field | Type | Notes |
|---|---|---|
| `view` | `FeatureView.name` | |
| `file` | string | Final path under `docs/screenshots/`. |
| `outcome` | `'written' \| 'failed'` | |
| `reason` | string? | Set when failed, printed as `<view>: <reason>`. |

The run exits 0 only if every result is `written`; otherwise it lists the failed views and exits 1 (FR-012).

## State transitions

### Seed item (per entity, per run)

```text
probe GitLab ──down──▶ stop with START_HINT (no items touched)
     │ up
     ▼
find by key ──found──▶ exists
     │ missing
     ▼
create ──▶ created
```

A merge request's branch content is pushed only on the `missing` path; an existing branch is never rewritten.

### Demo lifecycle on the instance

```text
absent ──seed──▶ seeded ──seed──▶ seeded (no change)
   ▲                │
   └────clean───────┘   removes <group> subgroup and the two demo users only;
                        prwb-demo, prwb-it and it-* items are untouched
```

### Screenshot file (per view)

```text
previous image (or none)
     │ open view, wait for ready (15 s)
     ├─ready──▶ write <file>.tmp ──▶ rename over <file> ──▶ written
     └─timeout / error ──▶ delete <file>.tmp, previous image kept ──▶ failed
```

### Reviewer token (per screenshot run)

```text
minted (root token, for demo-reviewer) ──▶ in use by workbench ──▶ revoked (after-hooks, always in finally)
```
