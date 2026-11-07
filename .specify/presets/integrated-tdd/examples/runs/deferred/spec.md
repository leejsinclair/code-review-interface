# Feature Specification: Cart total

## User Scenarios & Testing

### User Story 1 - A shopper sees the cart total (Priority: P1)

A shopper opens the cart and sees what the order will cost.

**Acceptance Scenarios**:

1. **Given** an empty cart, **When** it is totalled, **Then** the total is zero.
2. **Given** a cart with two items, **When** it is totalled, **Then** the total is their sum.

---

### Edge Cases

- **EC-01**: A price of zero is allowed.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST total an empty cart as zero.
- **FR-002**: The system MUST total a cart as the sum of its item prices.
- **FR-003**: The cart page MUST follow the shop's visual layout.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A shopper sees the total within one second.
