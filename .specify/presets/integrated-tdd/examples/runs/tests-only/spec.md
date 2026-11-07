# Feature Specification: Cart total

**Feature Branch**: `001-cart-total`

## User Scenarios & Testing

### User Story 1 - A shopper sees the cart total (Priority: P1)

A shopper opens the cart and sees what the order will cost.

**Acceptance Scenarios**:

1. **Given** a cart with prices 1.50 and 2.00, **When** it is totalled, **Then** the total is 3.50.
2. **Given** an empty cart, **When** it is totalled, **Then** the total is zero and no error is raised.

### Edge Cases

- A price of zero is valid and adds nothing.

## Requirements

### Functional Requirements

- **FR-001**: The library MUST return the sum of the item prices in a cart.
- **FR-002**: The library MUST total an empty cart as zero.
- **FR-003**: The README MUST say how to total a cart.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A developer totals a cart with one call.
