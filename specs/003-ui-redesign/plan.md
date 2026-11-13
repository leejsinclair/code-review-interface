# Implementation Plan: PR Review Workbench UI Redesign

**Branch**: `003-ui-redesign` | **Date**: 2026-11-09 | **Spec**: [ui-redesign.spec.md](ui-redesign.spec.md) | **Wireframes**: [wireframes/](wireframes/index.html), approved 2026-11-09 ([approval.md](wireframes/approval.md))

**Scale note**: This change touches about 60 files in four areas: the config and discovery path on the server, the session service's single-repository assumption, every UI screen, and the stylesheet. Two of those areas change shared wire types (`/api/config`, `/api/pulls`, `POST /api/sessions`), so the existing end-to-end tests change in the same tasks as the routes. Build in story order. Stories 2 to 4 touch only `src/ui/` and can ship before the workspace work begins.

## Summary

This feature rebuilds the browser UI around a persistent review shell, and replaces the single configured repository with a base folder whose repositories feed a dashboard of open pull requests. On the UI side, the P0 trust and accessibility defects are fixed first: diff rows, badges, cited ranges and the Ask form. Then `<main key={hash}>` is removed, so a session-scoped shell owns the session, one live-update stream and the view state, which is kept in `sessionStorage`. Ask and Evidence become width-dependent panels over the existing routes. On the server, a read-only discovery walk finds repositories under the base folder. Each repository is matched to the platform by a new adapter method, `repositoryForRemote`, and the session service runs against each session's own repository. Browser tests use Playwright and axe as dev-only dependencies, run under `node:test` (research R1).

## Project Structure

```text
src/
├── config.ts                         ~ workspace replaces repository (R10)
├── main.ts                           ~ builds the Workspace service, discovery at start-up
├── contracts/
│   ├── shared.ts                     ~ AdapterDescriptor.settingsFields (R14)
│   ├── source-control.ts             ~ repositoryForRemote (R11)
│   └── http.ts                       ~ Workspace, PullGroup, repositoryAvailable, repository_unavailable
├── adapters/
│   ├── github|bitbucket|gitlab/source-control.ts   ~ repositoryForRemote
│   └── github|gitlab|jira/issues.ts                ~ settingsFields
├── repo/
│   ├── discovery.ts                  + folder walk, no symlinks, skips app data (R11)
│   └── manager.ts                    ~ readRemotes for discovery
├── core/
│   ├── workspace.ts                  + discovery state, rescan, cancel, cloneFor(repo)
│   ├── sessions.ts                   ~ environment per session repository (R13)
│   ├── interrogation.ts, summaries.ts ~ environment by session
├── server/routes/
│   ├── context.ts                    ~ /api/workspace, PullGroup, start body
│   └── interrogation.ts              ~ repository_unavailable
└── ui/
    ├── app.tsx                       ~ AppHeader + ReviewShell, no remount (R4)
    ├── api.ts                        ~ new endpoints, sign-in return, one stream
    ├── labels.ts                     ~ verbatim copy
    ├── app.css                       ~ tokens, three bands, badges, diff, panels, dialog, reduced motion
    ├── index.html                    ~ the page's one static live region, #live-region (R17)
    ├── state/                        + pure, unit-tested (R2)
    │   ├── view-state.ts  selection.ts  routes.ts  layout.ts  announcer.ts  units.ts
    │   ├── live-stream.ts  review-context.ts
    ├── components/
    │   ├── app-header.tsx  review-shell.tsx  badge.tsx  async-region.tsx      +
    │   ├── panel.tsx  panel-host.tsx  disclosure-menu.tsx  (Ask panel only)    +
    │   ├── session-actions.tsx (menu + native delete dialog)  live-banner.tsx +
    │   ├── file-list.tsx  ask-composer.tsx  code-view.tsx  completeness.tsx   +
    │   ├── sources-nav.tsx                                                    +
    │   └── claims.tsx  summaries.tsx                                          ~
    │       (the scope bar stays inside screens/diff.tsx)
    └── screens/                      ~ every screen (home, overview, diff, ask, code,
                                         description, issue, setup, signin)
test/
├── ui/*.ui.ts                        + Playwright + axe, `npm run test:ui` (R1)
├── helpers/browser.ts                + starts workbench + Chromium
├── unit/ui-*.test.ts                 + selection, view state, routes, units, layout
├── unit/discovery.test.ts            + walk, matching, duplicates
├── integration/discovery-safety.test.ts + IX before/after comparison (XI.3)
├── contract/source-control.suite.ts  ~ repositoryForRemote for every adapter
└── end-to-end/*.test.ts, unit/config.test.ts  ~ new config, PullGroup, start body
```

**Structure Decision**: Keep the existing single-package layout. New UI logic goes in `src/ui/state/` as plain TypeScript so `node --test` can import it. New server logic goes in `src/repo/discovery.ts` and `src/core/workspace.ts`, beside the modules they extend.

## Call paths

```calls dashboard lists pulls across repositories
  reader.pulls() @ src/server/routes/context.ts:186
    requireSignedIn() @ src/server/routes/context.ts:144
~   sessions.listPulls() @ src/core/sessions.ts:414
+     workspace.matched() **new** @ src/core/workspace.ts
~     environment() @ src/server/routes/context.ts:120
        listOpenPullRequests() @ src/contracts/source-control.ts:51
~   writer.start() @ src/server/routes/context.ts:203
~     sessions.start() @ src/core/sessions.ts:457
```
note: `environment()` becomes `environmentFor(repo)`; one repository's failure is that group's `failed` state (V.4).

```calls discovery at start-up, on save and on Rescan
  startWorkbench() @ src/main.ts:52
+   createWorkspace() **new** @ src/core/workspace.ts
+     rescan() **new** @ src/core/workspace.ts
+       discover() **new** @ src/repo/discovery.ts
+         readRemotes() @ src/repo/manager.ts:126
+         repositoryForRemote() @ src/contracts/source-control.ts:49
~   createContextRoutes() @ src/main.ts:83
```
note: `saveConfig` (src/server/routes/context.ts:201) and the Rescan route call the same `rescan()`; discovery changes nothing (IX).

```calls review shell keeps state across pages
~ screenFor() @ src/ui/app.tsx:19
+   ReviewShell() **new** @ src/ui/components/review-shell.tsx
      subscribeSession() @ src/ui/api.ts:253
+     viewState **new** @ src/ui/state/view-state.ts
~   DiffScreen() @ src/ui/screens/diff.tsx:19
+     selection **new** @ src/ui/state/selection.ts
~   AskScreen() @ src/ui/screens/ask.tsx:103
~   refHref() @ src/ui/components/claims.tsx:13
```
note: `<main key={hash}>` at src/ui/app.tsx:81 goes; the shell is keyed by session id only.

## States

```states discovery of the base folder
Idle: No scan has run since start-up. (start) (proposed)
Scanning: Walking folders and counting them. (proposed)
Complete: The result is held; the dashboard lists matched repositories. (proposed) shows home
Cancelled: Stopped early; repositories found so far are kept. (proposed)
Failed: The base folder could not be read. (proposed)
Idle -> Scanning: start-up or save (proposed)
Scanning -> Complete: walk ends (proposed)
Scanning -> Cancelled: cancel (proposed)
Scanning -> Failed: base folder unreadable (proposed)
Complete -> Scanning: Rescan or save (proposed)
Cancelled -> Scanning: Rescan or save (proposed)
Failed -> Scanning: Rescan or save (proposed)
grid:
Idle | Scanning | Complete | .
.    | Failed   | Cancelled | .
```
note: a save while Scanning cancels the running walk and starts a new one.

```states contextual panel on a review page
Closed: No panel; the page fills the main region. (start) (proposed) shows diff
Ask: The Ask panel sits beside or over the page with the scope filled in. (proposed) shows diff
Evidence: The cited source, with its full range highlighted. (proposed)
FullPage: Below 900 pixels, the existing full-page route. (proposed)
Closed -> Ask: Ask about selection or this PR (proposed)
Closed -> Evidence: follow a claim reference (proposed)
Ask -> Closed: close button or Escape (proposed)
Evidence -> Closed: close button or Escape (proposed)
Ask -> FullPage: resize below 900 (proposed)
Evidence -> FullPage: resize below 900 (proposed)
FullPage -> Closed: back (proposed)
grid:
Ask    | Closed | Evidence | .
.      | FullPage | .      | .
```
note: below 900 pixels, Ask and references open FullPage directly. Closing returns focus to the opener.

## Screens

```screen home Home dashboard
title: Home
row:
  field: Filter (new) (1)
  field: Repository (new)
list: Your review sessions | Resume review | Open (read only) (changed)
list: Open pull requests | repository, number, title, author, branches, updated | Start review or Resume review (changed) (2)
text: One repository could not load its pull requests, with Retry (new) (3)
text: Repositories skipped, with a link to Setup (new)
```
1: **Over loaded items only.** Filter and repository choice persist in tab storage, so Back to dashboard restores them with scroll (FR-055).
2: **One list across repositories.** Sorted most recently updated first, with the deliberate `pr-item-<repository>-<number>` testid.
3: **One failure, not a blank page.** The other repositories' rows still show (FR-054).

```screen diff Files with the Ask panel open
text: Back to dashboard (new)
title: Review header with repository, PR title, head commit and Refresh (changed) (1)
list: Overview | Files | Questions | Sources (new)
text: Context strip, for example Description found, 1 issue missing, 3 files skipped (new)
row:
  list: File filter and changed files (changed)
  text: Diff with plus and minus marks, selection bar, keyboard line numbers (changed) (2)
  text: Ask panel with heading focused on open (new) (3)
row:
  text: Selected: path lines a–b (new side) (changed) (4)
  button: Ask about selection (changed)
```
1: **Session actions move to a menu.** Close and Delete sit behind a secondary button; Delete opens a dialog with Cancel focused.
2: **One Tab stop.** Arrow keys move, Enter or Space anchors, Shift with an arrow extends, Escape clears.
3: **Width decides the form.** Beside the diff from 1200 pixels, over it from 900, the full `/ask` page below 900.
4: **Announced politely.** The same text goes to the page's single live region (`#live-region` in `index.html`) on every change, with or without the shell.

## Constitution Check

Checked before Phase 0 and again after Phase 1. No violations, so there is no Complexity Tracking table.

| Rule | Assessment |
|---|---|
| I. Evidence before opinion | PASS. Badges make Evidence and Inference visible. Full-range highlighting makes each cited reference checkable (FR-010). The "proposed as …" downgrade note stays. |
| II. Human accountability | PASS. No write action is added (FR-043). The copy review (SC-007) and the context strip wording keep any readiness meaning out (FR-016). |
| III. Separation of records | PASS. No store schema change. Deleting a session is still one confirmed action, now behind a dialog (III.2). |
| IV. Explainability | PASS. Completeness rows keep their reasons, and the context strip links to them. Review focus stays empty (FR-027). |
| V. Missing context shown | PASS. Async regions show failed and stale states (FR-028, FR-029). One repository's failure stays in its own group (V.4, FR-054). A missing repository shows its reason (FR-057). |
| VI. Incremental integration | PASS. Discovery reuses git through the Repository manager. No new engine is built. |
| VII. No developer metrics | PASS. The dashboard shows author and updated time only, with no per-person aggregation. |
| VIII. Provider neutrality | PASS. Remote matching is a new contract method that each adapter implements (R11). Setup reads `needsBaseUrl` and the new `settingsFields` from descriptors (R14). `test/unit/platform-names.test.ts` keeps guarding `src/ui` and `src/core`. |
| IX. Repository safety (NON-NEGOTIABLE) | PASS. Discovery reads directory entries and runs only `git remote -v` through the Repository manager. It follows no symlinks and skips the app-data folder. A new safety test compares branch, HEAD, index, status and stash of every discovered repository before and after a scan (XI.3). |
| X. Local server security | PASS. CSP is unchanged: styles stay in `app.css`, icons are `lucide-preact` components bundled into the UI as inline SVG elements (see Q.1), and the dialog is native (R8, R16). PR, issue, code and AI text still renders as text nodes only, and a static check fails on `dangerouslySetInnerHTML`, `innerHTML` or `insertAdjacentHTML` anywhere in `src/ui` (FR-042, SC-008). View state is in `sessionStorage`, allowlisted, never sent and never holds credentials (X.7, R3). The sign-in return accepts only app routes (R15). New routes go through the existing guard. `POST` rescan and cancel are state-changing, so they get the Origin check (X.5). |
| XI. Test-first verification | PASS. Every task's failing test comes first. The contract suite gains `repositoryForRemote` cases that every adapter passes (XI.2). Browser tests cover FR-047's five areas, SC-001 and SC-003. |
| P. Platform constraints | PASS. Discovery builds paths with `node:path` and handles Windows junctions as symlinks (P.4). No build step changes beyond esbuild for the UI. |
| Q.1 Dependencies | PASS. No runtime dependency. Dev-only additions: `playwright` (drives Chromium for UI tests; jsdom has no layout) and `@axe-core/playwright` (WCAG checks for SC-001; a hand-written checker would be weaker). Added later, also dev-only: `lucide-preact` (icons for row and inline actions, tree-shaken into the esbuild UI bundle, so nothing ships at runtime and the CSP is unchanged; alternative considered: a hand-written `icons.tsx` of inline SVG paths, rejected because the team would then maintain the paths). |
| Q.2 Phase 1 scope | PASS. The base folder widens FR-1.1's "configured repository" to the repositories under one folder. It builds no cross-repository graph and no cross-PR analysis, which are the §8.2 exclusions. The product owner approved it in the wireframe review. |
