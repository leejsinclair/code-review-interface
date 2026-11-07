# Implementation Plan: Basket badge

**Branch**: `001-basket-badge` | **Spec**: [spec.md](spec.md)

## Summary

Show the basket's item count as a badge on the header's basket icon. The badge is a small
presentational component fed by the basket store, so a change to the store updates it in
place.

## Verification Plan

### Verification commands

| ID | Command | Scope | Source |
|----|---------|-------|--------|
| e2e-focused | `npm run test:e2e -- --grep {select}` | focused | package.json `test:e2e` script |
| ui | `npm test` | broad | package.json `test` script |

### Verification obligations

| ID | Requirements | Scenario | Expected outcome | Level | Origin |
|----|--------------|----------|------------------|-------|--------|
| VO-001 | FR-001, US1-AS1 | A basket of three items is viewed | The badge reads 3 | end-to-end | planned |
| VO-002 | FR-002, US1-AS2 | An empty basket is viewed | No badge is shown | end-to-end | planned |
| VO-003 | FR-003, US1-AS3, EC-01 | Baskets of 120, 100 and 99 items are viewed | The badge reads 99+ for 120 and 100, and 99 for 99 | end-to-end | planned |
| VO-004 | FR-004, US2-AS1, SC-001 | An item is added to a basket of three | The badge reads 4 within one second, with no page load | end-to-end | planned |
| VO-005 | FR-004, US2-AS2 | The only item is removed | The badge disappears, with no page load | end-to-end | planned |

### Verification exemptions

| Requirement | Reason | Alternative verification |
|-------------|--------------|--------------------------|
| None | - | - |

### Behaviour checklist

Behaviour items are in [tests/behaviour-checklist.md](tests/behaviour-checklist.md).

## Project Structure

Single web project: the header component and the basket store, each with its own tests.
