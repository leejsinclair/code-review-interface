// Risk badge (contracts/ui.md): an icon plus the class word, with an accessible name, so the class never
// depends on colour (FR-028, FR-031). Shapes differ per class as well as glyphs.

import { ArrowDown, CircleAlert, Minus, TriangleAlert } from 'lucide-preact';
import type { RiskClass } from '../../contracts/http.ts';
import { RISK_LABELS } from '../labels.ts';

const ICONS = { critical: CircleAlert, elevated: TriangleAlert, normal: Minus, low: ArrowDown } as const;

export function RiskBadge(props: { riskClass: RiskClass }) {
  const { riskClass } = props;
  const Icon = ICONS[riskClass];
  const word = RISK_LABELS.class[riskClass];
  return (
    <span class="badge risk-badge" data-kind="risk" data-risk={riskClass} data-testid="risk-badge" aria-label={`Risk: ${word}`} role="img">
      <Icon size={14} aria-hidden="true" focusable="false" />
      <span aria-hidden="true">{word}</span>
    </span>
  );
}
