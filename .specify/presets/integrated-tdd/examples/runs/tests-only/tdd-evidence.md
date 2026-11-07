# TDD Evidence: 001-cart-total

<!-- Written by tdd_check.py. Do not edit by hand: use the script's subcommands. -->

## Summary

_Generated from the tables below on 2026-10-10T12:50:03Z._

| Obligation | Requirements | Status | Tests | Latest result |
|------------|--------------|--------|-------|---------------|
| VO-001 | FR-001, US1-AS1, SC-001 | in progress | tests.test_cart.CartTotalTests.test_totals_two_prices | pass (#3) |
| VO-002 | FR-002, US1-AS2 | in progress | tests.test_cart.CartTotalTests.test_empty_cart_totals_zero | pass (#5) |

**Not verified**: FR-001 (VO-001 in progress), US1-AS1 (VO-001 in progress), SC-001 (VO-001 in progress), FR-002 (VO-002 in progress), US1-AS2 (VO-002 in progress), FR-003 (exempt: see plan).

**Open decisions**: none. **Exceptions**: none. **Expectation changes**: none.

**Pre-existing failures**: none.

## Baseline

| Seq | Command | Result | Pre-existing failures |
|-----|---------|--------|-----------------------|
| 1 | suite | pass | - |

## Test execution records

| Seq | Time | Task | Obligations | Phase | Command | Selector | Result | Valid | Classification | Files | Fingerprint | Note | Check |
|-----|------|------|-------------|-------|---------|----------|--------|-------|----------------|-------|-------------|------|-------|
| 1 | 2026-10-10T12:50:02Z | - | - | baseline | suite | - | pass | yes | - | - | - | - | 09ba33 |
| 2 | 2026-10-10T12:50:03Z | T001 | VO-001 | green | unit | tests.test_cart.CartTotalTests.test_totals_two_prices | pass | yes | - | - | - | - | b37b82 |
| 3 | 2026-10-10T12:50:03Z | T002 | VO-001 | green | unit | tests.test_cart.CartTotalTests.test_totals_two_prices | pass | yes | - | - | - | - | 654f88 |
| 4 | 2026-10-10T12:50:03Z | T003 | VO-002 | green | unit | tests.test_cart.CartTotalTests.test_empty_cart_totals_zero | pass | yes | - | - | - | - | aff68e |
| 5 | 2026-10-10T12:50:03Z | T004 | VO-002 | green | unit | tests.test_cart.CartTotalTests.test_empty_cart_totals_zero | pass | yes | - | - | - | - | 1b8a14 |

## Exceptions

| ID | Time | Task | Obligations | Kind | Rationale | Alternative verification | Needs approval | Approved by |
|----|------|------|-------------|------|-----------|--------------------------|----------------|-------------|

## Expectation changes

| ID | Time | Task | Files | Requirements | Justification | Alters behaviour | Approved by | New fingerprint |
|----|------|------|-------|--------------|---------------|------------------|-------------|-----------------|

## Decisions

| ID | Opened | Question | Tasks | Status | Answer | Decided by | Resolved |
|----|--------|----------|-------|--------|--------|------------|----------|
