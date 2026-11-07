# Feature Specification: Cart Total

**Feature Branch**: `001-cart-total`

**Created**: 2026-10-16

**Status**: Draft

**Input**: User description: "Add a cart total to the shop library. cart_total(prices) returns the sum of the item prices in a cart. An empty cart totals zero. A negative price is rejected with a ValueError."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Total a cart of items (Priority: P1)

A developer using the shop library supplies the prices of the items in a cart and gets back the total amount owed.

**Why this priority**: This is the core capability; without it the feature has no value.

**Independent Test**: Call `cart_total` with a list of prices and confirm the result equals their sum.

**Acceptance Scenarios**:

1. **Given** a cart with prices 5, 10 and 20, **When** the total is requested, **Then** the result is 35.
2. **Given** a cart with a single price of 7, **When** the total is requested, **Then** the result is 7.
3. **Given** a cart containing a free item priced 0 alongside a priced item, **When** the total is requested, **Then** the free item adds nothing to the total.

---

### User Story 2 - Empty cart totals zero (Priority: P2)

A developer totals a cart with no items and gets zero rather than an error.

**Why this priority**: Empty carts are common and must be handled predictably.

**Independent Test**: Call `cart_total` with an empty list and confirm the result is zero.

**Acceptance Scenarios**:

1. **Given** an empty cart, **When** the total is requested, **Then** the result is 0.

---

### User Story 3 - Reject negative prices (Priority: P2)

A developer who passes a cart containing a negative price is told the input is invalid, so bad data cannot silently reduce a total.

**Why this priority**: Protects total correctness from invalid data.

**Independent Test**: Call `cart_total` with a list containing a negative price and confirm a `ValueError` is raised.

**Acceptance Scenarios**:

1. **Given** a cart with prices 10 and -3, **When** the total is requested, **Then** a `ValueError` is raised and no total is returned.
2. **Given** a cart whose only price is negative, **When** the total is requested, **Then** a `ValueError` is raised.

---

### Edge Cases

- A cart where every price is 0 totals 0 (zero is a valid price, not negative).
- A negative price anywhere in the cart (first, middle, last) is rejected, even if other prices would offset it.
- A cart with a single negative price is rejected.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The shop library MUST provide `cart_total(prices)` that returns the sum of the item prices in the cart.
- **FR-002**: `cart_total` MUST return 0 for an empty cart.
- **FR-003**: `cart_total` MUST raise a `ValueError` if any price in the cart is negative.
- **FR-004**: `cart_total` MUST treat a price of 0 as valid.
- **FR-005**: `cart_total` MUST NOT return a partial or offset total when it rejects a cart.

### Key Entities

- **Cart**: A collection of item prices; may be empty.
- **Price**: A non-negative numeric amount for one item in a cart.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every valid cart, the returned total equals the sum of its prices in 100% of test cases.
- **SC-002**: An empty cart returns zero in 100% of test cases.
- **SC-003**: Every cart containing a negative price is rejected with a `ValueError` in 100% of test cases, regardless of the negative price's position.

## Assumptions

- `prices` is a collection of numeric values; validation of non-numeric input is out of scope.
- Currency, rounding, discounts, taxes and quantities are out of scope; each entry is one item's price.
- `cart_total` lives alongside the existing cart functionality in the shop library (e.g. `item_count`).
