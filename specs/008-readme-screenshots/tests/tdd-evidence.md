# TDD Evidence: 008-readme-screenshots

<!-- Written by tdd_check.py. Do not edit by hand: use the script's subcommands. -->

## Summary

_Generated from the tables below on 2026-11-14T08:54:10Z._

| Obligation | Requirements | Status | Tests | Latest result |
|------------|--------------|--------|-------|---------------|
| VO-001 | FR-001, US1-AS1, SC-001 | verified | test/unit/readme-features.test.ts | pass (#12) |
| VO-002 | FR-002, FR-003 | verified | test/unit/readme-features.test.ts | pass (#12) |
| VO-003 | FR-004, US1-AS3, US1-AS4, SC-005 | verified | test/unit/readme-features.test.ts | pass (#12) |
| VO-004 | FR-013 | verified | test/unit/readme-features.test.ts | pass (#12) |
| VO-005 | FR-005, FR-006, US1-AS2 | in progress | test/unit/demo-scenarios.test.ts | pass (#3) |
| VO-006 | FR-005, FR-007, US2-AS1, US2-AS2, SC-003 | verified | test/gitlab/demo.test.ts | pass (#8) |
| VO-007 | FR-008, US2-AS4, EC-01 | verified | test/gitlab/demo.test.ts | pass (#9) |
| VO-008 | US2-AS3 | verified | test/unit/demo-guards.test.ts | pass (#7) |
| VO-009 | FR-008, DC-01 | verified | test/unit/demo-guards.test.ts | pass (#7) |
| VO-010 | FR-012, US3-AS2, EC-04 | in progress | test/unit/capture-file.test.ts | pass (#13) |
| VO-011 | FR-002, US3-AS1 | in progress | test/unit/capture-file.test.ts | pass (#13) |
| VO-012 | FR-009, US3-AS3 | verified | test/unit/screenshot-isolation.test.ts | pass (#14) |
| VO-013 | FR-010, FR-011, EC-03, EC-05 | in progress | test/unit/demo-scenarios.test.ts | pass (#3) |

| Behaviour item | Scenario | Obligations | Status | Tests |
|----------------|----------|-------------|--------|-------|
| BI-001 | US1-AS1 | VO-001 | verified | test/unit/readme-features.test.ts |
| BI-002 | US1-AS2 | VO-005 | in progress | test/unit/demo-scenarios.test.ts |
| BI-003 | US1-AS3 | VO-003 | verified | test/unit/readme-features.test.ts |
| BI-004 | US1-AS4 | VO-003 | verified | test/unit/readme-features.test.ts |
| BI-005 | US2-AS1 | VO-006 | verified | test/gitlab/demo.test.ts |
| BI-006 | US2-AS2 | VO-006 | verified | test/gitlab/demo.test.ts |
| BI-007 | US2-AS3 | VO-008 | verified | test/unit/demo-guards.test.ts |
| BI-008 | US2-AS4 | VO-007 | verified | test/gitlab/demo.test.ts |
| BI-009 | US3-AS1 | VO-011 | in progress | test/unit/capture-file.test.ts |
| BI-010 | US3-AS2 | VO-010 | in progress | test/unit/capture-file.test.ts |
| BI-011 | US3-AS3 | VO-012 | verified | test/unit/screenshot-isolation.test.ts |
| BI-012 | - | VO-002 | verified | test/unit/readme-features.test.ts |
| BI-013 | - | VO-004 | verified | test/unit/readme-features.test.ts |
| BI-014 | - | VO-009 | verified | test/unit/demo-guards.test.ts |
| BI-015 | - | VO-013 | in progress | test/unit/demo-scenarios.test.ts |
| BI-016 | - | exemption SC-002 | exempt | - |
| BI-017 | - | exemption SC-004, exemption EC-02 | exempt | - |

Not verified by tests

- MV-001 manual: open
- MV-002 manual: open

Counts: verified 9, deferred 0, manual checks 2 open

**Not verified**: FR-002 (VO-011 in progress), FR-005 (VO-005 in progress), FR-006 (VO-005 in progress), US1-AS2 (VO-005 in progress), FR-012 (VO-010 in progress), US3-AS2 (VO-010 in progress), EC-04 (VO-010 in progress), US3-AS1 (VO-011 in progress), FR-010 (VO-013 in progress), FR-011 (VO-013 in progress), EC-03 (VO-013 in progress), EC-05 (VO-013 in progress), SC-002 (exempt: see plan), SC-004 (exempt: see plan), EC-02 (exempt: see plan), BI-002 (in progress), BI-009 (in progress), BI-010 (in progress), BI-015 (in progress).

**Open decisions**: none. **Exceptions**: none. **Expectation changes**: none.

**Item changes**: none.

**Pre-existing failures**: #1 test-all: failing before work began.

## Baseline

| Seq | Command | Result | Pre-existing failures |
|-----|---------|--------|-----------------------|
| 1 | test-all | fail | failing before work began |

## Test execution records

| Seq | Time | Task | Obligations | Phase | Command | Selector | Result | Valid | Classification | Files | Fingerprint | Note | Check |
|-----|------|------|-------------|-------|---------|----------|--------|-------|----------------|-------|-------------|------|-------|
| 1 | 2026-11-14T08:34:06Z | - | - | baseline | test-all | - | fail | yes | unclassified | - | - | - | d77dc3 |
| 2 | 2026-11-14T08:34:23Z | T002 | VO-005, VO-013 | red | unit | test/unit/demo-scenarios.test.ts | fail | yes | assertion | test/unit/demo-scenarios.test.ts | d4e84e | expected: demo/scenarios | 0caf1c |
| 3 | 2026-11-14T08:36:18Z | T005 | VO-005, VO-013 | green | unit | test/unit/demo-scenarios.test.ts | pass | yes | - | test/unit/demo-scenarios.test.ts | 0d4ce6 | - | 9e0e2a |
| 4 | 2026-11-14T08:36:48Z | T006 | VO-001, VO-002, VO-003, VO-004 | red | unit | test/unit/readme-features.test.ts | fail | yes | assertion | test/unit/readme-features.test.ts | d17d84 | expected: Features | 743f48 |
| 5 | 2026-11-14T08:38:34Z | T008 | VO-006, VO-007 | red | unit | test/gitlab/demo.test.ts | fail | yes | assertion | test/gitlab/demo.test.ts | 32a477 | expected: demo/clean | c43a1d |
| 6 | 2026-11-14T08:38:35Z | T009 | VO-008, VO-009 | red | unit | test/unit/demo-guards.test.ts | fail | yes | assertion | test/unit/demo-guards.test.ts | 8aa6cc | expected: demo/clean | 51cb35 |
| 7 | 2026-11-14T08:44:13Z | T011 | VO-008, VO-009 | green | unit | test/unit/demo-guards.test.ts | pass | yes | - | test/unit/demo-guards.test.ts | 8aa6cc | - | cac92a |
| 8 | 2026-11-14T08:48:06Z | T010 | VO-006 | green | unit | test/gitlab/demo.test.ts | pass | yes | - | test/gitlab/demo.test.ts | 32a477 | - | 8b5334 |
| 9 | 2026-11-14T08:52:03Z | T011 | VO-007 | green | unit | test/gitlab/demo.test.ts | pass | yes | - | test/gitlab/demo.test.ts | 32a477 | - | 0aedf1 |
| 10 | 2026-11-14T08:52:09Z | T012 | VO-010, VO-011 | red | unit | test/unit/capture-file.test.ts | fail | yes | assertion | test/unit/capture-file.test.ts | 8676dd | expected: demo/screenshots | 67cd04 |
| 11 | 2026-11-14T08:52:09Z | T013 | VO-012 | red | unit | test/unit/screenshot-isolation.test.ts | fail | yes | assertion | test/unit/screenshot-isolation.test.ts | b9239e | expected: demo/screenshots | 35837b |
| 12 | 2026-11-14T08:54:09Z | T007 | VO-001, VO-002, VO-003, VO-004 | green | unit | test/unit/readme-features.test.ts | pass | yes | - | test/unit/readme-features.test.ts | d17d84 | - | 05db2d |
| 13 | 2026-11-14T08:54:09Z | T014 | VO-010, VO-011 | green | unit | test/unit/capture-file.test.ts | pass | yes | - | test/unit/capture-file.test.ts | 89c45b | - | c6eac5 |
| 14 | 2026-11-14T08:54:10Z | T014 | VO-012 | green | unit | test/unit/screenshot-isolation.test.ts | pass | yes | - | test/unit/screenshot-isolation.test.ts | b9239e | - | 2b3e0d |

## Exceptions

| ID | Time | Task | Obligations | Kind | Rationale | Alternative verification | Needs approval | Approved by |
|----|------|------|-------------|------|-----------|--------------------------|----------------|-------------|

## Expectation changes

| ID | Time | Task | Files | Requirements | Justification | Alters behaviour | Approved by | New fingerprint |
|----|------|------|-------|--------------|---------------|------------------|-------------|-----------------|

## Decisions

| ID | Opened | Question | Tasks | Status | Answer | Decided by | Resolved |
|----|--------|----------|-------|--------|--------|------------|----------|

## Behaviour items at baseline

| Item | Verified by | Fingerprint | Seq |
|------|-------------|-------------|-----|
| BI-001 | VO-001 | 193a1a | 1 |
| BI-002 | VO-005 | 2b6662 | 1 |
| BI-003 | VO-003 | f5ebe7 | 1 |
| BI-004 | VO-003 | 8cc5fb | 1 |
| BI-005 | VO-006 | cae722 | 1 |
| BI-006 | VO-006 | 69d5de | 1 |
| BI-007 | VO-008 | 7595a8 | 1 |
| BI-008 | VO-007 | 4df0ed | 1 |
| BI-009 | VO-011 | 610ffb | 1 |
| BI-010 | VO-010 | dc2f4b | 1 |
| BI-011 | VO-012 | 4a2082 | 1 |
| BI-012 | VO-002 | 95d9c5 | 1 |
| BI-013 | VO-004 | 769006 | 1 |
| BI-014 | VO-009 | e70fd9 | 1 |
| BI-015 | VO-013 | ee69df | 1 |
| BI-016 | exemption SC-002 | a2be2e | 1 |
| BI-017 | exemption SC-004, exemption EC-02 | f1b613 | 1 |

## Behaviour item changes

| ID | Time | Item | Requirements | Justification | Alters behaviour | Approved by | New fingerprint |
|----|------|------|--------------|---------------|------------------|-------------|-----------------|
