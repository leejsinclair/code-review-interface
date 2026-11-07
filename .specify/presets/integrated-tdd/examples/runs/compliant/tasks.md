---

description: "Task list for Cart Total"
---

# Tasks: Cart Total

**Input**: Design documents from `/specs/001-cart-total/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/cart-total.md, tests/behaviour-checklist.md

**Tests**: Required. Every obligation in the plan's Verification Plan has a test task placed before the task that delivers its behaviour.

**Organization**: Tasks are grouped by user story. All code lives in `shop/cart.py` and `tests/test_cart.py`, so tasks touching the same file are not marked [P].

## Format: `[ID] [P?] [Story] [Label] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- **[Label]**: `[VO-nnn]` or `[NT: reason]` (see "Verification labels" at the end)

## Path Conventions

- Source: `shop/cart.py` (add `cart_total` next to `item_count`)
- Tests: `tests/test_cart.py` (`unittest`)
- Focused run: `python3 -B -m unittest {select}` (e.g. `python3 -B -m unittest tests.test_cart`); broad run: `make test`

## Phase 1: Setup

**Purpose**: Confirm the baseline before changing anything

- [X] T001 [NT: baseline check, no behaviour added] Run `make test` from the repository root and confirm the existing tests in `tests/test_cart.py` pass; read `shop/cart.py` to see how `item_count` is written and follow its style

---

## Phase 2: Foundational

No foundational tasks: the feature is one function in an existing module with no storage, dependencies or shared infrastructure.

---

## Phase 3: User Story 1 - Total a cart of items (Priority: P1) 🎯 MVP

**Goal**: `cart_total(prices)` returns the sum of the prices.

**Independent Test**: Call `cart_total([5, 10, 20])` and confirm 35; a single price 7 gives 7; a 0 price adds nothing.

- [X] T002 [US1] [VO-001] Write the failing test in `tests/test_cart.py`: `cart_total([5, 10, 20])` equals 35 (import `cart_total` from `shop.cart`); run `python3 -B -m unittest tests.test_cart` and confirm it fails because `cart_total` does not exist
- [X] T003 [US1] [VO-001] Implement `cart_total(prices)` in `shop/cart.py` next to `item_count`, returning the sum of the prices and leaving the input unmodified (contract: contracts/cart-total.md); confirm the T002 test passes
- [X] T004 [US1] [VO-002] Write the test in `tests/test_cart.py`: `cart_total([7])` equals 7
- [X] T005 [US1] [VO-002] Run the T004 test; if it fails, correct `cart_total` in `shop/cart.py` so a single price is returned as the total
- [X] T006 [US1] [VO-003] Write the test in `tests/test_cart.py`: `cart_total([0, 12])` equals 12 with no error raised, and `cart_total([0, 0, 0])` equals 0 with no error raised (price 0 is valid, FR-004)
- [X] T007 [US1] [VO-003] Run the T006 test; if it fails, correct `cart_total` in `shop/cart.py` so a price of 0 is accepted and adds nothing

**Checkpoint**: User Story 1 works on its own; `make test` passes.

---

## Phase 4: User Story 2 - Empty cart totals zero (Priority: P2)

**Goal**: An empty cart totals 0 without error.

**Independent Test**: Call `cart_total([])` and confirm 0.

- [X] T008 [US2] [VO-004] Write the test in `tests/test_cart.py`: `cart_total([])` equals 0 and raises no error
- [X] T009 [US2] [VO-004] Run the T008 test; if it fails, correct `cart_total` in `shop/cart.py` so an empty cart returns 0 (FR-002)

**Checkpoint**: User Stories 1 and 2 both pass.

---

## Phase 5: User Story 3 - Reject negative prices (Priority: P2)

**Goal**: A cart containing any negative price raises `ValueError` and returns no total.

**Independent Test**: Call `cart_total([10, -3])` and confirm `ValueError`.

- [X] T010 [US3] [VO-005] Write the failing test in `tests/test_cart.py`: `cart_total([10, -3])` raises `ValueError` (use `assertRaises`; no total is returned); confirm it fails
- [X] T011 [US3] [VO-005] In `cart_total` in `shop/cart.py`, validate the prices before summing and raise `ValueError` if any price is negative, so no partial or offset total is ever returned (FR-003, FR-005); confirm the T010 test passes
- [X] T012 [US3] [VO-006] Write the test in `tests/test_cart.py`: `cart_total([-1])` raises `ValueError`
- [X] T013 [US3] [VO-006] Run the T012 test; if it fails, correct the validation in `cart_total` in `shop/cart.py` so a cart with a single negative price is rejected
- [X] T014 [US3] [VO-007] Write the test in `tests/test_cart.py`: with offsetting prices, `cart_total([-5, 10, 20])`, `cart_total([10, -5, 20])` and `cart_total([10, 20, -5])` each raise `ValueError` (use `subTest` per position)
- [X] T015 [US3] [VO-007] Run the T014 test; if it fails, correct the validation in `cart_total` in `shop/cart.py` so every position is checked, not only the first or last

**Checkpoint**: All user stories pass independently.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T016 [NT: documentation only] Add a one-line description of `cart_total` to `README.md` if the README lists the library's functions
- [X] T017 [NT: final regression run, no new behaviour] Run `make test` and confirm all tests pass; walk through `specs/001-cart-total/quickstart.md`

---

## Dependencies & Execution Order

- Phase 1 first. No Foundational phase.
- US1 (Phase 3) creates `cart_total`; US2 and US3 extend it and depend on T003.
- US2 and US3 are independent of each other once US1 is done.
- Within a story, each test task comes before its behaviour task.
- Polish depends on all stories.

### Parallel Opportunities

None worth exploiting: every code task edits `shop/cart.py` or `tests/test_cart.py`. US2 and US3 could be worked in parallel by separate people, but they would conflict in those two files.

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001, then T002–T007.
2. **Stop and validate**: `make test` passes; `cart_total` sums prices.

### Incremental Delivery

1. Add US1 → test → MVP.
2. Add US2 → test.
3. Add US3 → test.

## Notes

- Write each test and see it fail (or, for T004/T006/T008/T012/T014, see whether the existing implementation already passes) before changing `shop/cart.py`.
- Commit after each task or logical group.

## Verification labels

Every task carries a verification label, placed after the story label and before the
description. The rest of the task line is unchanged.

| Label | Meaning |
|-------|---------|
| `[VO-nnn]` | The task satisfies this obligation from the plan's Verification Plan. Repeat the label for several obligations |
| `[NT: reason]` | The task has no behaviour to verify. The reason is required |

```markdown
- [X] T011 [P] [US1] [VO-001] Write the failing test for an empty cart total in tests/test_cart.py
- [X] T012 [US1] [VO-001] Implement the cart total in src/cart.py
- [X] T013 [US1] [NT: README wording only] Document the cart total in README.md
```

A task's kind follows from its labels and its position in this file:

| Kind | Rule |
|------|------|
| `no-test` | Carries `[NT: reason]` and no `[VO-nnn]` |
| `test` | The first task in the file to name a given obligation |
| `behaviour` | Any later task naming that obligation |

- Test tasks are required for every task that delivers behaviour. They are not optional.
- When the feature has a behaviour checklist, each obligation a test task names must be
  named by a behaviour item, so that the test traces to a planned behaviour.
- Every obligation needs a `test` task and at least one `behaviour` task, so it is named
  by at least two tasks.
- The first task to name an obligation is its test task whatever its description says, so
  the test task must be written first: the task that writes the failing test comes before
  the task that implements the behaviour.
- A task naming several obligations is a `test` task only when it is the first to name
  all of them.
