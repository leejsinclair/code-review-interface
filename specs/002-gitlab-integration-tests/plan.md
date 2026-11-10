# Implementation Plan: GitLab Platform and Live Integration Tests

**Branch**: `002-gitlab-integration-tests` | **Date**: 2026-11-08 | **Spec**: [gitlab-integration-tests.spec.md](gitlab-integration-tests.spec.md)
**Inputs**: the feature spec, constitution 1.2.0, ADR 0002 (same-origin redirects only), `testing/gitlab.md`, the plan for 001

**Scale note.** About 25 files change across five areas: two new adapters, the read-only HTTP layer, configuration and the setup screen, the shared contract suites, and a new test-only seeder with three live suites. Watch three things. First, the redirect change in `read-only-http.ts` touches every platform. Second, the tightened address rule now also applies to the existing tracker `site` setting. Third, the seeder is the first code in the repository that writes to a platform: it must stay under `test/`, refuse non-loopback addresses, and delete only what its own run created.

## Summary

The workbench gains two adapters, `gitlab` for source control and `gitlab-issues` for issues, built on the GitHub adapters' pattern and reached through the existing registry and read-only layer. Self-hosted platforms need a base address. The repository config gets a neutral `baseUrl` setting, the tracker keeps its `site` setting, and both pass through one validator that allows https, or http on a loopback host only. The registry now passes settings to source-control factories as well as trackers. The read-only layer follows a redirect only when it stays on the same origin.

The live tests are new, and all of their code lives under `test/`. A neutral `PlatformSeeder` interface has one implementation, `GitlabSeeder`. It calls GitLab's REST API with the root token through plain `fetch`, pushes over git from its own author clone, and for each run creates a non-administrator reviewer user and token. The existing contract suites move into exported runners that take expected values as data. The fixture tests feed them constants and the live tests feed them seeded values. The lifecycle harness `startWorkbench` gains a live mode. A probe of `/api/v4/version` skips the live files under `npm test` and fails them under `test:gitlab`. There are no new runtime dependencies.

## Project Structure

```text
package.json                         + scripts test:gitlab, gitlab:clean
src/
  config.ts                          + RepositoryConfig.baseUrl; validateBaseUrl(), isLoopbackHost() shared by baseUrl and site
  contracts/http.ts                  + baseUrl on Config / ConfigBody wire types
  contracts/shared.ts                + AdapterDescriptor.needsBaseUrl
  contracts/issue-tracker.ts         + IssueRefForm '!123' | 'owner/repo!123'
  adapters/
    read-only-http.ts                redirect: 'manual', same-origin follow (max 5 hops), cross-origin -> unavailable
    registry.ts                      SourceControlSettings; create(deps, settings); register gitlab and gitlab-issues
    gitlab/
      api.ts                         base-address joining (keeps sub-path), project-path encoding, paging
      source-control.ts              GITLAB_ID, GITLAB_DESCRIPTOR, createGitlabSourceControl
      issues.ts                      GITLAB_ISSUES_ID, GITLAB_ISSUES_DESCRIPTOR, createGitlabIssuesTracker
  server/routes/context.ts           pass SourceControlSettings into createSourceControl and verifySignIn
  ui/screens/setup.tsx               repository base-address field when the chosen platform needs one
test/
  contract/
    source-control.suite.ts          exported runSourceControlContract(target) (moved from the .test.ts)
    issue-tracker.suite.ts           exported runIssueTrackerContract(target)
    source-control.contract.test.ts  fixture targets for github and bitbucket-cloud
    issue-tracker.contract.test.ts   fixture targets for github-issues and jira-cloud
  seeder/
    platform-seeder.ts               neutral PlatformSeeder interface and SeededRun types
    gitlab-seeder.ts                 GitLab implementation (root token, plain fetch, git CLI)
    run-name.ts                      it-<suite>-<timestamp>, ownership test, leftover listing
  gitlab/
    env.ts                           GITLAB_URL / GITLAB_TOKEN, readiness probe, skip-or-fail gate
    required.env                     PRWB_GITLAB_REQUIRED=1 (loaded by test:gitlab through --env-file)
    contract.test.ts                 US1: both contract suites live, changed-file kinds, cleanup
    lifecycle.test.ts                US2: full review journey and restart
    coverage.test.ts                 US3: paging, truncation, git fetch, invalid and revoked tokens, rename
    recording.test.ts                US4: record, scrub, replay
    clean.ts                         gitlab:clean entry point
  helpers/
    fake-ai-cli.ts                   startWorkbench live mode (real fetch, given config, credentials and clone)
    git-sandbox.ts                   liveClone(): HTTP clone with a test-only credential store in a temp HOME
    recorded-fetch.ts                + recordingFetch() and scrubbing
    logged-fetch.ts                  wraps real fetch with the LoggedRequest log the suites assert on
  unit/
    config.test.ts                   address rule cases
    read-only-http.test.ts           same-origin follow, cross-origin refusal without the credential
    gitlab-references.test.ts        #, !, qualified and nested references
    platform-names.test.ts           + 'gitlab' in FORBIDDEN
testing/README.md, testing/gitlab.md GitLab as a supported platform; live suite; gitlab:clean replaces reset advice
```

**Structure Decision**: product code changes stay inside `src/adapters/`, plus the neutral config, contract and setup-screen edits the base address needs. Everything that writes to GitLab sits under `test/seeder/` and `test/gitlab/`.

## Call paths

**Adapter construction.** `server/routes/context.ts` `environment()` and `verify` → `registry.createSourceControl(platform, deps, { repository, baseUrl })` → `createGitlabSourceControl(deps, settings)` → `gitlab/api.ts` builds `<baseUrl>/api/v4/projects/<encoded path>/…` → `deps.fetch` (read-only layer) → network.

**Redirect.** `read-only-http.ts` sends a GET with `redirect: 'manual'`. On a 3xx it resolves `Location` against the request URL. Same origin: it repeats the GET with the same headers, for at most 5 hops. Different origin: `AdapterError('unavailable')`, and no request is sent.

**Head fetch.** `core/sessions.ts` → `getHeadLocation` returns `refs/merge-requests/<iid>/head` with the base project's `http_url_to_repo` and `ssh_url_to_repo` → `repo/manager.ts` picks the URL whose scheme matches the clone → `git fetch` into `refs/prwb/…`. Git gets the credential from the reviewer's own git configuration. The live test points `HOME` at a temp directory holding a credential store for the run's reviewer token.

**Live test.** The test file → `env.ts` gate (skip or fail) → `GitlabSeeder.begin(suite)` creates the reviewer user, token and projects → the test seeds data through neutral operations → it runs the suite against adapters built with the reviewer token and `logged-fetch` → `t.after` calls `seeder.cleanup()`, which removes only its own run's projects and user in two steps and prints anything left behind.

## Screens

The setup screen (`src/ui/screens/setup.tsx`, `data-testid="setup"`) shows a **Repository base address** input, `data-testid="setup-base-url"`, when the chosen source-control platform's descriptor has `needsBaseUrl: true`. It sits next to the existing "Tracker site" field. A refused address shows the validator's message in the existing `data-testid="setup-error"` alert. Nothing else on screen changes.

## Constitution Check

| Principle | Assessment |
|---|---|
| I. Evidence before opinion | PASS. Not touched. |
| II.1 Product never changes a platform | PASS. Adapters only issue GETs through the read-only layer. SC-005 is asserted from `logged-fetch` across every live run. |
| II.2, II.3 | PASS. Not touched. |
| III. Separation of records | PASS. The store is not changed. The lifecycle test checks that answers survive state changes. |
| IV. Explainability | PASS. Not touched. |
| V.1, V.4 Gaps, not failures | PASS. Missing, confidential and forbidden issues are unresolved with a reason, and a deleted MR shows as deleted (FR-010, FR-015). |
| VI. Incremental integration | PASS. Uses GitLab's API and git. Nothing is re-created. |
| VII. No developer metrics | PASS. Not touched. |
| VIII.1 Neutral contracts | PASS. GitLab sits behind `SourceControlProvider` and `IssueTracker`. The only contract change is two added `IssueRefForm` values. |
| VIII.2 No platform names outside adapters | PASS. The new setting is named `baseUrl` and the descriptor flag `needsBaseUrl`. `gitlab` is added to the platform-name check (FR-020). |
| VIII.3 Read-only integrations | PASS. Same-origin redirects are followed with GET only (ADR 0002). |
| IX Repository safety (NON-NEGOTIABLE) | PASS. The fetch path is unchanged and still writes only `refs/prwb/*`. Seeder pushes go to a separate author clone. Every live repository operation compares the reviewer clone's fingerprint (FR-034). |
| X.1–X.6 | PASS. Not touched. |
| X.7, X.8 Credentials | PASS. The product reads the GitLab token only through `credentials.ts`. The recorder scrubs tokens and headers, and a test greps recorded files for the token. The local instance's root token is a throwaway credential under the X.7 exception. The reviewer user's token is created per run and deleted with it. |
| X.9, X.10 | PASS. Not touched. |
| XI.1 Test-first | PASS. tasks.md orders every test before its code. |
| XI.2 Contract suites | PASS. One suite per contract, run by every adapter. GitLab runs it live, as XI.2 allows. |
| XI.3 Safety tests | PASS. Adds the cross-origin redirect test (X.7) and per-operation fingerprints. |
| XI.4 Test-only writes | PASS. The seeder is under `test/`, refuses non-loopback addresses, never uses adapters or the read-only layer, and touches only data named for its run. |
| P.1–P.5 | PASS. `test:gitlab` uses `node --env-file`, and `gitlab:clean` is a Node script. Neither needs a shell. |
| Q.1 Dependencies | PASS. None added. |
| Q.2 Scope | PASS. The platform adapters and the fetch of a linked issue are Phase 1 capabilities. GitLab is allowed by VIII.1 as amended. |

Re-checked after Phase 1 design: no change. No violations, so no Complexity Tracking table.
