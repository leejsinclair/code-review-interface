// Badge (contracts/ui.md 4.4): one component for every badge kind. The kind-specific attribute sits on the
// badge itself, the glyph is aria-hidden and the visible text is never uppercased by script.

import type { SkipReason } from '../../contracts/http.ts';
import { BADGE_GLYPHS, BADGE_TEXT, type ClaimLabel, type CompletenessStatus, type Intent } from '../labels.ts';

export type PrStatus = 'open' | 'closed' | 'merged';

export type BadgeProps =
  | { kind: 'claim'; label: ClaimLabel }
  | { kind: 'intent'; intent: Intent }
  | { kind: 'completeness'; status: CompletenessStatus }
  | { kind: 'skipped'; reason: SkipReason }
  | { kind: 'unresolved'; reason?: string }
  | { kind: 'older-head'; commit: string }
  | { kind: 'read-only' }
  | { kind: 'pr-status'; status: PrStatus };

function describe(props: BadgeProps): { attrs: Record<string, string>; glyph: string; text: string } {
  switch (props.kind) {
    case 'claim':
      return { attrs: { 'data-label': props.label }, glyph: BADGE_GLYPHS.claim[props.label], text: BADGE_TEXT.claim[props.label] };
    case 'intent':
      return { attrs: { 'data-intent': props.intent }, glyph: BADGE_GLYPHS.intent[props.intent], text: BADGE_TEXT.intent[props.intent] };
    case 'completeness':
      return {
        attrs: { 'data-status': props.status },
        glyph: BADGE_GLYPHS.completeness[props.status],
        text: BADGE_TEXT.completeness[props.status],
      };
    case 'skipped':
      return { attrs: { 'data-reason': props.reason }, glyph: BADGE_GLYPHS.skipped, text: props.reason };
    case 'unresolved':
      return {
        attrs: {},
        glyph: BADGE_GLYPHS.unresolved,
        text: props.reason === undefined || props.reason === '' ? BADGE_TEXT.unresolved : `${BADGE_TEXT.unresolved}: ${props.reason}`,
      };
    case 'older-head':
      return { attrs: {}, glyph: BADGE_GLYPHS.olderHead, text: `${BADGE_TEXT.olderHead} ${props.commit.slice(0, 7)}` };
    case 'read-only':
      return { attrs: {}, glyph: BADGE_GLYPHS.readOnly, text: BADGE_TEXT.readOnly };
    case 'pr-status':
      return { attrs: { 'data-status': props.status }, glyph: BADGE_GLYPHS.prStatus, text: props.status };
  }
}

export function Badge(props: BadgeProps) {
  const { attrs, glyph, text } = describe(props);
  return (
    <span class="badge" data-kind={props.kind} {...attrs}>
      <span aria-hidden="true">{glyph}</span>
      {text}
    </span>
  );
}
