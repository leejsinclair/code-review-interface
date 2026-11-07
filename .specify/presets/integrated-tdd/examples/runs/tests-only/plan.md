# Implementation Plan: Cart total

**Branch**: `001-cart-total` | **Spec**: [spec.md](./spec.md)

## Summary

Add `cart_total(prices)` to `shop/cart.py`.

## Technical Context

**Language/Version**: Python 3

**Testing**: the standard library's `unittest`, as the project already uses

## Verification Plan

### Verification commands

| ID | Command | Scope | Source |
|----|---------|-------|--------|
| unit | `python3 -B -m unittest {select}` | focused | README.md, "Run one test" |
| suite | `make test` | broad | Makefile, test target |

### Verification obligations

| ID | Requirements | Scenario | Expected outcome | Level | Origin |
|----|--------------|----------|------------------|-------|--------|
| VO-001 | FR-001, US1-AS1, SC-001 | A cart with prices 1.50 and 2.00 is totalled with one call | The total is 3.50 | unit | planned |
| VO-002 | FR-002, US1-AS2 | An empty cart is totalled | The total is zero and no error is raised | unit | planned |

### Verification exemptions

| Requirement | Reason | Alternative verification |
|-------------|--------|--------------------------|
| FR-003 | Documentation wording has no automated check in this project | Read at code review |
