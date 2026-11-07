# Implementation Plan: Cart Total

**Branch**: `001-cart-total` | **Date**: 2026-10-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-cart-total/spec.md`

## Summary

Add `cart_total(prices)` to the shop library's cart module: return the sum of the prices, 0 for an empty cart, and raise `ValueError` (with no total returned) if any price is negative. Prices are validated before summing.

## Technical Context

**Language/Version**: Python 3

**Primary Dependencies**: None (standard library)

**Storage**: N/A

**Testing**: `unittest`, run through `make test`

**Target Platform**: Any platform with Python 3

**Project Type**: library

**Performance Goals**: N/A

**Constraints**: None beyond the spec

**Scale/Scope**: One function

## Constitution Check

The project constitution is an unfilled template and defines no gates. No violations; re-checked after design with the same result.

## Project Structure

### Documentation (this feature)

```text
specs/001-cart-total/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── cart-total.md
├── tests/
│   └── behaviour-checklist.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```text
shop/
└── cart.py              # add cart_total next to item_count

tests/
└── test_cart.py         # add cart_total tests
```

**Structure Decision**: Single project; extend the existing `shop/cart.py` and `tests/test_cart.py`.

## Complexity Tracking

No violations.

## Verification Plan

<!--
  Added by the Integrated TDD preset and filled by the plan stage as a Phase 1 output.
  The heading text, the three sub-headings and the three header rows are fixed: a check
  script reads them. Replace the example rows. This section holds no status: what is
  verified is derived from the evidence in tdd-evidence.md, never written here.
-->

### Verification commands

<!--
  The ways this project already runs its tests, taken from what the project defines
  (package scripts, a Makefile, CI configuration, contributor documentation).
  ID: short, lowercase letters, digits and hyphens. Command: in backticks, with at most
  one {select} where a test selector goes. Scope: focused (run per increment) or broad
  (run at checkpoints). Source: where the project defines the command.
  If the project has no runnable test command, leave the table empty and raise the gap.
-->

| ID | Command | Scope | Source |
|----|---------|-------|--------|
| unit-one | `python3 -B -m unittest {select}` | focused | README.md ("Run one test") |
| suite | `make test` | broad | Makefile (`test` target); README.md |

### Verification obligations

<!--
  One row per scenario that must be verified. ID: VO- and three digits, numbered in
  order of creation and never reused. Requirements: the FR-, SC- and acceptance scenario
  ids (USn-ASm, scenario m of user story n) from spec.md that the row verifies, with
  DC-nn for a design constraint and EC-nn for an edge case, each stated in the Scenario
  cell. Expected outcome: what must be observed, stated without reference to how the code
  will be written. Level: unit, integration, contract, end-to-end or other. Origin:
  planned, or discovered when added during implementation.
-->

| ID | Requirements | Scenario | Expected outcome | Level | Origin |
|----|--------------|----------|------------------|-------|--------|
| VO-001 | FR-001, SC-001, US1-AS1 | A cart with prices 5, 10 and 20 is totalled | The result is 35 | unit | planned |
| VO-002 | US1-AS2 | A cart with the single price 7 is totalled | The result is 7 | unit | planned |
| VO-003 | FR-004, US1-AS3, EC-01 | A cart with a free item priced 0 and a priced item is totalled; a cart of only 0 prices is totalled (EC-01) | The free item adds nothing, no error is raised, and an all-zero cart totals 0 | unit | planned |
| VO-004 | FR-002, SC-002, US2-AS1 | An empty cart is totalled | The result is 0 and no error is raised | unit | planned |
| VO-005 | FR-003, FR-005, US3-AS1 | A cart with prices 10 and -3 is totalled | A `ValueError` is raised and no total is returned | unit | planned |
| VO-006 | US3-AS2, EC-03 | A cart whose only price is negative is totalled | A `ValueError` is raised | unit | planned |
| VO-007 | SC-003, EC-02 | A negative price is placed first, in the middle and last in a cart whose other prices would offset it | A `ValueError` is raised in each position | unit | planned |

### Verification exemptions

<!--
  One row per requirement that will not be verified automatically, with the reason and
  how it is verified instead (or none, with why). A single row reading None in the
  Requirement column when there are no exemptions.
-->

| Requirement | Reason | Alternative verification |
|-------------|--------|--------------------------|
| None | - | - |

### Behaviour checklist

<!--
  This heading is read by the checks and must be kept: it switches the behaviour checklist
  rules on for this feature. The plan stage writes the checklist itself to
  tests/behaviour-checklist.md; keep the line below as it is.
-->

Behaviour items are in [tests/behaviour-checklist.md](tests/behaviour-checklist.md).
