// Stored-to-display label maps (contracts/ui.md "Display labels", spec Verbatim
// Constraints). Stored values never reach the screen directly; the UI looks them
// up here.
//
// The missing tracker-access reason is not defined here. Its text names the
// tracker platform, so it comes from the server (the tracker adapter) as the
// reason string on the issue row, and the UI shows that string as text.

export type ClaimLabel = 'evidence' | 'inference';
export type QuestionCategory = 'what' | 'why' | 'how' | 'whatif' | 'risk' | 'requirement';
export type CompletenessStatus = 'found' | 'missing' | 'stale';
export type Audience = 'technical' | 'business';
export type Intent = 'documented' | 'inferred';

/** Claim labels: Evidence, Inference (FR-016 to FR-018). */
export const CLAIM_LABELS: Readonly<Record<ClaimLabel, string>> = {
  evidence: 'Evidence',
  inference: 'Inference',
};

/** Question categories, in display order (FR-014). */
export const CATEGORY_LABELS: Readonly<Record<QuestionCategory, string>> = {
  what: 'What',
  why: 'Why',
  how: 'How',
  whatif: 'What-if',
  risk: 'Risk',
  requirement: 'Requirements',
};

export const CATEGORY_ORDER: readonly QuestionCategory[] = ['what', 'why', 'how', 'whatif', 'risk', 'requirement'];

/** Context completeness statuses are stored and displayed the same (FR-007). */
export const COMPLETENESS_STATUS_LABELS: Readonly<Record<CompletenessStatus, string>> = {
  found: 'found',
  missing: 'missing',
  stale: 'stale',
};

/** The heading of the audience choice (FR-048). */
export const ANSWER_FOR_LABEL = 'Answer for:';

/** Audience choices shown under "Answer for:"; Technical is the default (FR-048). */
export const AUDIENCE_LABELS: Readonly<Record<Audience, string>> = {
  technical: 'Technical',
  business: 'Business',
};

export const DEFAULT_AUDIENCE: Audience = 'technical';

/** Intent groups; documented claims are grouped apart from inferred ones (FR-017). */
export const INTENT_LABELS: Readonly<Record<Intent, string>> = {
  documented: 'Documented intent',
  inferred: 'Inferred intent',
};

export const INTENT_ORDER: readonly Intent[] = ['documented', 'inferred'];
