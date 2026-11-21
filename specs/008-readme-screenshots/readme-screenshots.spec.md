# Feature Specification: README Screenshots from a Seeded GitLab Demo

**Feature Branch**: `008-readme-screenshots`
**Created**: 2026-11-14
**Status**: Draft

**Grilled on**: 2026-11-14

**Input**: "take screen shots and update readme with features. Use gitlab to setup a variety of illustrated examples"

## Clarifications

### Session 2026-11-14

- Q: Should the feature ship repeatable seed and screenshot commands, or a one-off capture? → A: Repeatable commands, committed to the repository.
- Q: Where does the AI text in screenshots come from? → A: A scripted stand-in with hand-written demo text, reusing the test suite's fake AI provider.
- Q: How much of the README should change? → A: Add a Features section near the top and fix contradicted statements in place; existing sections keep their order.
- Q (analysis): One merge request for issue link and spec, or two? → A: Two. Spec context matches a GitLab issue key against no spec folder name, so the spec-linked merge request relies on the branch-name fallback and carries no issue reference (research R5).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what the workbench does before installing it (Priority: P1)

A developer lands on the README. Before reading setup instructions they see a Features section: each feature has a one- or two-sentence description and a screenshot of that feature working on a realistic pull request. The screenshots show the real product, not mock-ups, and the text matches what the product does today.

**Why this priority**: This is the outcome the request asks for. The rest exists to produce it reliably.

**Independent Test**: Open the README on the repository host. Every feature listed has an image that loads and shows the named feature. Every claim in the README agrees with current behaviour.

**Acceptance Scenarios**:

1. **Given** the README, **When** a reader scrolls to Features, **Then** they find one entry per headline feature (review queue, overview summary, review focus, diff with risk, ask a question, specification alignment, comments and replies, review decision), each with a screenshot.
2. **Given** a screenshot in the README, **When** the reader opens it, **Then** it shows a demo pull request whose content makes the feature obvious (for example, a Critical file next to a lockfile-only change).
3. **Given** the README's statements about platform writes, **When** compared with the product, **Then** they agree: reviewer actions are described as the one exception to read-only, and no section still says the workbench never comments or approves.
4. **Given** the sign-in and platform tables, **When** compared with the product, **Then** GitLab is listed alongside GitHub, Bitbucket Cloud and Jira.

---

### User Story 2 - Seed a varied demo on local GitLab with one command (Priority: P2)

A maintainer runs one command against the local GitLab test instance. It creates demo projects, issues and merge requests that between them exercise every feature in the README: a merge request touching authentication and a database migration, one changing only a lockfile and generated files, one linked to an issue and carrying a feature spec with acceptance criteria, one with an existing comment thread, and one already approved. Running it again leaves the same demo, not a duplicate.

**Why this priority**: Without varied, realistic examples the screenshots show empty or trivial screens.

**Independent Test**: Against a fresh local GitLab, run the seed command twice. The second run reports no changes and the instance holds exactly the demo set.

**Acceptance Scenarios**:

1. **Given** a running local GitLab, **When** the seed command runs, **Then** the demo projects, issues and merge requests exist and each is listed with its purpose.
2. **Given** the demo already seeded, **When** the seed command runs again, **Then** nothing is duplicated.
3. **Given** GitLab is not running, **When** the seed command runs, **Then** it stops with a message naming the command that starts GitLab.
4. **Given** the demo is no longer wanted, **When** the maintainer runs the clean command, **Then** only the demo projects and demo users are removed, not the integration-test projects.

---

### User Story 3 - Regenerate every screenshot with one command (Priority: P3)

After a UI change, a maintainer runs one command. It starts the workbench against the seeded GitLab demo, drives the browser to each feature view, and writes the screenshots to the folder the README links to, overwriting the old ones. AI output in the screenshots comes from a fixed, scripted provider, so a rerun with no UI change produces the same pictures.

**Why this priority**: Screenshots go stale. Cheap regeneration keeps the README honest.

**Independent Test**: Run the command twice with no code change. Same set of file names; the images show the same content.

**Acceptance Scenarios**:

1. **Given** the seeded demo, **When** the screenshot command runs, **Then** one image per README feature is written and the command lists each file.
2. **Given** a view fails to reach its expected state, **When** the command runs, **Then** it names the view, keeps the existing image, and exits with failure.
3. **Given** the command finishes, **When** the maintainer checks their real config and keychain, **Then** nothing was changed: the run used its own data directory and credentials.

---

### Edge Cases

- **EC-01** The demo GitLab already holds integration-test projects: seed and clean touch only projects in the demo group.
- **EC-02** A screenshot would show a token, local path or personal name: the demo uses throwaway names and the local test token, and paths in the UI show the demo folder only.
- **EC-03** The browser window size changes between runs: the command fixes the viewport so images stay comparable.
- **EC-04** A feature is removed or renamed later: its README entry and image go together; the command fails on a view it cannot find rather than writing a blank image.
- **EC-05** Light and dark mode: screenshots use one theme (light) so the README reads consistently.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The README MUST have a Features section near the top, with one entry per headline feature, each with a short description and a screenshot.
- **FR-002**: Each screenshot MUST be a capture of the running product against the GitLab demo, stored in the repository and linked by a relative path.
- **FR-003**: Each screenshot MUST have alt text describing what it shows.
- **FR-004**: The README MUST be corrected wherever it contradicts current behaviour, including the read-only statements and the list of supported platforms. Its existing sections MUST keep their order; corrections are made in place.
- **FR-005**: A seed command MUST create, on the local GitLab instance, a demo group with projects, issues and merge requests covering every README feature.
- **FR-006**: The seed MUST include at least: a Critical-risk merge request (authentication and a migration) that also carries a mechanical change, a reduced-review merge request (lockfile and generated files only), a merge request on a feature branch whose spec folder holds a feature spec with acceptance criteria and TDD evidence, a merge request that references an issue, a merge request with an existing discussion, and an approved merge request.
- **FR-007**: The seed command MUST be idempotent: a second run creates nothing new.
- **FR-008**: A clean command MUST remove only the demo group, its contents and the demo users.
- **FR-009**: A screenshot command MUST start the workbench in an isolated data directory with GitLab credentials from the environment, never the user's config or keychain.
- **FR-010**: The screenshot command MUST use a scripted AI provider so summaries, answers and spec alignment are fixed text.
- **FR-011**: The screenshot command MUST use a fixed viewport and light theme.
- **FR-012**: The screenshot command MUST fail, name the view, and keep the previous image when a view does not reach its expected state.
- **FR-013**: The README's Development section MUST say how to seed the demo and regenerate the screenshots.

### Key Entities

- **Demo scenario**: one merge request in the demo group, the feature it illustrates, and the content that makes that feature visible.
- **Feature entry**: a README heading, its description, and the screenshot file it links.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every headline feature in the README (at least 8) has a screenshot that loads on the repository host.
- **SC-002**: From a fresh local GitLab, seeding and regenerating all screenshots takes two commands and under 5 minutes after GitLab is up.
- **SC-003**: A second seed run creates zero new projects, issues or merge requests.
- **SC-004**: No screenshot shows a real token, real person's name, or path outside the demo folder (checked by review of each image).
- **SC-005**: A reviewer comparing the README with the product finds zero contradicted statements.

## Assumptions

- The existing local GitLab container (`npm run gitlab:up`, `gitlab:bootstrap`) is the demo host; no public GitLab is used.
- GitLab issues are the issue tracker for the demo, so the whole demo runs on one platform.
- The scripted AI provider reuses the fake provider the test suite already has, with demo-specific answers.
- Screenshots are PNG, light theme, one fixed desktop viewport; no animated GIFs.
- Images live in `docs/screenshots/`.
- The repository's own spec and handover docs are out of scope; only README.md changes in prose.
