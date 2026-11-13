// Risk classes and their order (data-model.md). The rank is a code constant used only to compare two classes:
// it is never stored, sent or shown as a number (FR-002).

import type { RiskClass } from '../../contracts/http.ts';

export type { RiskClass };

/** The four classes, most scrutiny first. */
export const RISK_CLASSES: readonly RiskClass[] = ['critical', 'elevated', 'normal', 'low'];

const RANK: Readonly<Record<RiskClass, number>> = { low: 0, normal: 1, elevated: 2, critical: 3 };

/** True when `a` demands more scrutiny than `b`. */
export const isHigher = (a: RiskClass, b: RiskClass): boolean => RANK[a] > RANK[b];

/** The class with more scrutiny. */
export const maxClass = (a: RiskClass, b: RiskClass): RiskClass => (isHigher(b, a) ? b : a);

export const isRiskClass = (value: unknown): value is RiskClass =>
  value === 'low' || value === 'normal' || value === 'elevated' || value === 'critical';
