# Feature Specification: Basket badge

**Feature Branch**: `001-basket-badge`
**Status**: Draft
**Input**: User description: "Show the number of items in the basket as a badge on the basket icon, hidden when the basket is empty and capped at 99+."

## User Scenarios & Testing

### User Story 1 - The badge shows what is in the basket (Priority: P1)

A shopper looks at the basket icon in the page header and sees at a glance how many items
the basket holds.

**Acceptance Scenarios**:

1. **Given** the basket holds three items, **When** the shopper views any page, **Then** the basket icon shows a badge reading 3.
2. **Given** the basket holds no items, **When** the shopper views any page, **Then** the basket icon shows no badge.
3. **Given** the basket holds 120 items, **When** the shopper views any page, **Then** the badge reads 99+.

---

### User Story 2 - The badge follows changes (Priority: P2)

A shopper adds and removes items and the badge keeps up without the page being reloaded.

**Acceptance Scenarios**:

1. **Given** the basket holds three items, **When** the shopper adds one more, **Then** the badge reads 4 without the page being reloaded.
2. **Given** the basket holds one item, **When** the shopper removes it, **Then** the badge disappears without the page being reloaded.

---

### Edge Cases

- **EC-01**: A basket of exactly 99 items shows 99, and a basket of 100 items shows 99+.

## Requirements

### Functional Requirements

- **FR-001**: The basket icon MUST show a badge with the number of items in the basket.
- **FR-002**: The badge MUST NOT be shown when the basket holds no items.
- **FR-003**: The badge MUST read 99+ when the basket holds more than 99 items.
- **FR-004**: The badge MUST change when an item is added or removed, without a page reload.

## Success Criteria

### Measurable Outcomes

- **SC-001**: The badge shows the new count within one second of the shopper's action.
