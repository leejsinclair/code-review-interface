# Behaviour Checklist: 008-readme-screenshots

**Specification**: [spec.md](../spec.md) | **Verification Plan**: [plan.md](../plan.md#verification-plan) | **Tasks**: [tasks.md](../tasks.md)

## US1-AS1

> **Given** the README, **When** a reader scrolls to Features, **Then** they find one entry per headline feature (review queue, overview summary, review focus, diff with risk, ask a question, specification alignment, comments and replies, review decision), each with a screenshot.

- **BI-001** Expresses: FR-001, US1-AS1, SC-001. Verified by: VO-001.
  - **Given** the README
  - **When** a reader scrolls to Features, which comes before the setup sections
  - **Then** they find eight entries: review queue, overview summary, review focus, diff with risk, ask a question, specification alignment, comments and replies, review decision
  - **And** each entry has a short description and a screenshot

## US1-AS2

> **Given** a screenshot in the README, **When** the reader opens it, **Then** it shows a demo pull request whose content makes the feature obvious (for example, a Critical file next to a lockfile-only change).

- **BI-002** Expresses: US1-AS2, FR-006. Verified by: VO-005.
  - **Given** the seeded demo
  - **When** its merge requests are inspected
  - **Then** the Critical-risk one holds an authentication file and a migration next to an ordinary file and a mechanical file
  - **And** each other feature has a merge request whose content shows it: lockfile and generated files only, a feature spec with acceptance criteria and TDD evidence, an issue reference, a comment with a reply, an approval

## US1-AS3

> **Given** the README's statements about platform writes, **When** compared with the product, **Then** they agree: reviewer actions are described as the one exception to read-only, and no section still says the workbench never comments or approves.

- **BI-003** Expresses: FR-004, US1-AS3, SC-005. Verified by: VO-003.
  - **Given** the README's statements about platform writes
  - **When** compared with the product
  - **Then** reviewer actions are described as the one exception to read-only
  - **And** no section says the workbench never comments or approves
  - **And** the review decision entry says Request changes shows as unavailable on GitLab
  - **And** the existing sections keep their order

## US1-AS4

> **Given** the sign-in and platform tables, **When** compared with the product, **Then** GitLab is listed alongside GitHub, Bitbucket Cloud and Jira.

- **BI-004** Expresses: FR-004, US1-AS4. Verified by: VO-003.
  - **Given** the sign-in and platform tables
  - **When** compared with the product
  - **Then** GitLab and GitLab Issues are listed alongside GitHub, Bitbucket Cloud and Jira

## US2-AS1

> **Given** a running local GitLab, **When** the seed command runs, **Then** the demo projects, issues and merge requests exist and each is listed with its purpose.

- **BI-005** Expresses: FR-005, US2-AS1. Verified by: VO-006.
  - **Given** a running local GitLab
  - **When** the seed command runs
  - **Then** the demo projects, issue and merge requests exist
  - **And** the command lists each item, and each merge request with its purpose

## US2-AS2

> **Given** the demo already seeded, **When** the seed command runs again, **Then** nothing is duplicated.

- **BI-006** Expresses: FR-007, US2-AS2, SC-003. Verified by: VO-006.
  - **Given** the demo already seeded
  - **When** the seed command runs again
  - **Then** nothing is duplicated: every item is reported as already existing and none is created

## US2-AS3

> **Given** GitLab is not running, **When** the seed command runs, **Then** it stops with a message naming the command that starts GitLab.

- **BI-007** Expresses: US2-AS3. Verified by: VO-008.
  - **Given** GitLab is not running
  - **When** the seed or clean command runs
  - **Then** it stops with a message naming the command that starts GitLab
  - **And** nothing is written

## US2-AS4

> **Given** the demo is no longer wanted, **When** the maintainer runs the clean command, **Then** only the demo projects and demo users are removed, not the integration-test projects.

- **BI-008** Expresses: FR-008, US2-AS4, EC-01. Verified by: VO-007.
  - **Given** the demo is no longer wanted and integration-test projects exist on the instance
  - **When** the maintainer runs the clean command
  - **Then** the demo group, its projects and the two demo users are removed
  - **And** the integration-test projects remain

## US3-AS1

> **Given** the seeded demo, **When** the screenshot command runs, **Then** one image per README feature is written and the command lists each file.

- **BI-009** Expresses: FR-002, US3-AS1. Verified by: VO-011.
  - **Given** the seeded demo and a view that reaches its expected state
  - **When** the screenshot command captures it
  - **Then** its image is written under the name the README links
  - **And** the command lists the file

## US3-AS2

> **Given** a view fails to reach its expected state, **When** the command runs, **Then** it names the view, keeps the existing image, and exits with failure.

- **BI-010** Expresses: FR-012, US3-AS2, EC-04. Verified by: VO-010.
  - **Given** a view fails to reach its expected state
  - **When** the command runs
  - **Then** it names the view and the reason
  - **And** keeps the existing image unchanged, with no blank or partial image left
  - **And** exits with failure

## US3-AS3

> **Given** the command finishes, **When** the maintainer checks their real config and keychain, **Then** nothing was changed: the run used its own data directory and credentials.

- **BI-011** Expresses: FR-009, US3-AS3. Verified by: VO-012.
  - **Given** the command finishes
  - **When** the maintainer checks their real config and keychain
  - **Then** nothing was changed: the run used a data directory in the temp folder and a stand-in keychain
  - **And** the environment it changed is restored

## Other behaviours

- **BI-012** Expresses: FR-002, FR-003. Verified by: VO-002.
  - **Given** the README Features section
  - **When** each image link is followed
  - **Then** it is a relative path to a PNG stored in the repository
  - **And** it carries alt text describing what it shows

- **BI-013** Expresses: FR-013. Verified by: VO-004.
  - **Given** the README's Development section
  - **When** a maintainer reads it
  - **Then** it says how to seed the demo, clean it and regenerate the screenshots

- **BI-014** Expresses: FR-008. Verified by: VO-009.
  - **Given** a non-loopback GitLab address, or a group outside the demo parent group
  - **When** the seed or clean command runs
  - **Then** it is refused before anything is sent

- **BI-015** Expresses: FR-010, FR-011, EC-03, EC-05. Verified by: VO-013.
  - **Given** the screenshot command's settings
  - **When** any view is captured
  - **Then** it uses a 1440×900 viewport, the light theme and fixed AI text, so reruns give the same pictures

- **BI-016** Expresses: SC-002. Verified by: exemption SC-002.
  - **Given** a freshly reset local GitLab
  - **When** the seed and screenshot commands run
  - **Then** both finish in under 5 minutes

- **BI-017** Expresses: SC-004, EC-02. Verified by: exemption SC-004, exemption EC-02.
  - **Given** the written screenshots
  - **When** each is reviewed
  - **Then** none shows a real token, a real person's name or a path outside the demo folder
