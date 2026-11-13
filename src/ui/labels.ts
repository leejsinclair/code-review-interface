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

/** Verbatim strings from the redesign contracts section 0. U+2212, U+2013 and U+2014 are written as the contract has them. */
export const ASK_FORM_LABELS = {
  question: 'Your question',
  category: 'Category',
  answerFor: 'Answer for',
} as const;

export const ACTION_LABELS = {
  askAboutPr: 'Ask about this PR',
  askAboutSelection: 'Ask about selection',
  startReview: 'Start review',
  resumeReview: 'Resume review',
  openFullPage: 'Open full page',
  newCommitsRefresh: 'New commits — Refresh',
} as const;

export const LIVE_BANNER_TEXT = 'Live updates paused — Reconnect';

/** Home empty state: `No open pull requests in <base folder>`. */
export const homeEmptyState = (baseFolder: string): string => `No open pull requests in ${baseFolder}`;

export const DASHBOARD_LABELS = {
  backToDashboard: 'Back to dashboard',
  rescan: 'Rescan',
  yourReviewSessions: 'Your review sessions',
  openPullRequests: 'Open pull requests',
  baseFolder: 'Base folder',
  noIssueKey: 'No issue key',
  hideApproved: 'Hide pull requests I approved',
  refreshing: 'Updating…',
  refreshFailed: 'The list could not be updated, so the last known pull requests are shown.',
} as const;

export const PR_FLAG_LABELS = { approved: 'Approved', stale: 'Stale', newCommits: 'New commits' } as const;

/** Home's review queue lanes, most urgent first. */
export const QUEUE_LANE_LABELS = {
  'new-commits': 'New commits since your review',
  'in-progress': 'In progress',
  approved: 'Approved by you, waiting to merge',
} as const;

/** The short form used in the one-line summary above the lanes. */
export const QUEUE_SUMMARY_LABELS = { 'new-commits': 'with new commits', 'in-progress': 'in progress', approved: 'approved' } as const;

/** The external link to the pull request on its platform, e.g. "Open on Bitbucket". */
export const openOnPlatform = (platformName: string): string => `Open on ${platformName}`;

/** Accessible names for icon-only controls. Where a verbatim action label exists it is reused unchanged. */
export const ICON_LABELS = {
  showExplanation: 'Show explanation',
  hideExplanation: 'Hide explanation',
  showChangedFiles: 'Show changed files',
  hideChangedFiles: 'Hide changed files',
  whyThisClass: 'Why this class?',
  hideWhyThisClass: 'Hide why this class',
  retry: 'Retry',
  rescan: 'Rescan',
  openReadOnly: 'Open (read only)',
  notClassified: 'Risk not classified yet',
} as const;

export const REVIEW_NAV_LABELS = {
  overview: 'Overview',
  files: 'Files',
  questions: 'Questions',
  sources: 'Sources',
} as const;

export const ADVANCED_LIMITS_LABEL = 'Advanced limits';

export const REVIEW_FOCUS = { heading: 'Review focus' } as const;

/** Risk wording (specs/004-risk-review-focus/contracts/ui.md). The word "approved" appears nowhere here. */
export const RISK_LABELS = {
  class: { low: 'Low', normal: 'Normal', elevated: 'Elevated', critical: 'Critical' },
  mechanical: 'Mechanical (candidate for reduced review)',
  origin: { rule: 'Rule', ai: 'AI', override: 'Reviewer override', default: 'Default' },
  notFullyAnalysed: 'Not fully analysed',
  notAssessedLockfile: 'Not assessed by AI: lockfile',
  notAssessedGenerated: 'Not assessed by AI: generated file',
  aiInProgress: 'AI assessment in progress',
  aiMissing: 'AI assessment missing',
  aiIgnored: 'AI opinion ignored',
  aiDone: 'AI assessment complete',
  aiNoOpinion: 'The AI gave no opinion on this file.',
  overridden: 'Overridden',
} as const;

/** The review scope of the file list: how much of the pull request fits one careful review. Counts only. */
export const SCOPE_LABELS = {
  heading: 'Review scope',
  slider: 'Review scope: the lowest class to include',
  auto: 'Auto',
  autoTitle: 'Use the widest scope that fits the line budget',
  name: { critical: 'Critical only', elevated: 'Critical and Elevated', normal: 'Critical, Elevated and Normal', low: 'All classes' },
  outside: 'outside scope',
  notCounted: 'not counted',
  unclassified: 'Not yet classified',
  viewed: 'Viewed',
  progress: 'Viewed progress in the review scope',
} as const;

export const FILE_NAV_LABELS = {
  previous: '‹ Previous file',
  next: 'Next file ›',
  all: 'All changed files',
  noPrevious: 'No previous file',
  noNext: 'No further file',
} as const;

export const NEW_CAPABILITY_LABEL = '[NEW]';

/** Scope bar text: `Selected: <path> lines a–b (new side)`. */
export const scopeBarText = (path: string, start: number, end: number, side: 'new' | 'old'): string =>
  `Selected: ${path} lines ${start}–${end} (${side} side)`;

/** Badge texts and glyphs (contracts 4.4). */
export const BADGE_TEXT = {
  claim: CLAIM_LABELS,
  intent: INTENT_LABELS,
  completeness: COMPLETENESS_STATUS_LABELS,
  unresolved: 'Unresolved',
  olderHead: 'Older head',
  readOnly: 'Read-only',
} as const;

export const BADGE_GLYPHS = {
  claim: { evidence: '✓', inference: '≈' },
  intent: { documented: '✎', inferred: '≈' },
  completeness: { found: '✓', missing: '✕', stale: '⟳' },
  skipped: '⊘',
  unresolved: '?',
  olderHead: '⟲',
  readOnly: '🔒︎',
  prStatus: '●',
} as const;

/** Review-action labels (feature 005, contracts/ui.md). Buttons name the action; "Reject" is never shown. */
export const REVIEW_LABELS = {
  approve: 'Approve',
  announceApproved: 'Approved',
  requestChanges: 'Request changes',
  generalComment: 'General comment',
  postComment: 'Post comment',
  cancel: 'Cancel',
  withdraw: 'Withdraw',
  reply: 'Reply',
  edit: 'Edit',
  deleteComment: 'Delete comment',
  panelHeading: 'Your review',
  panelNote: 'This is your own decision on the platform. It is not the readiness of the pull request.',
  messageLabel: 'Message',
  noDecision: 'You have made no decision yet.',
  outOfDate: 'This pull request has new commits since you opened it. Reload to review the latest head. Nothing was posted.',
  outdated: 'Outdated',
  staleDecision: 'made on an earlier commit',
} as const;

/** The reviewer's OWN recorded decision on the platform, never a verdict of this tool (constitution II.2). */
const OWN_DECISION = { approved: 'You approved', changes_requested: 'You requested changes' } as const;
export const decisionText = (kind: 'approved' | 'changes_requested', commit: string, when: string): string =>
  `${OWN_DECISION[kind]} on ${commit.slice(0, 8)}, ${when}`;

/** Spec-context labels (feature 006, contracts/ui.md). Every assessment statement is "Inferred"; nothing here is "verified" or "approved". */
export const SPEC_LABELS = {
  heading: 'Specification',
  completenessSpecification: 'Specification',
  completenessTdd: 'TDD evidence',
  implementedAndTested: 'Implementation and test identified',
  implemented: 'Implementation identified',
  requiresVerification: 'Requires verification',
  notFound: 'Not found',
  inferred: 'Inferred',
  testShown: 'Test shown',
  noTestShown: 'No test shown',
  noEvidence: 'No evidence available',
  verdictSufficient: 'Testing looks sufficient',
  verdictIncomplete: 'Testing looks incomplete',
  verdictCannotJudge: 'Testing cannot be judged',
  uncovered: 'Criteria with no test shown',
  mismatched: 'Tests that may not test the right thing',
  unrequested: 'Implemented but not requested',
  unimplemented: 'Requested but not implemented',
  noDeviations: 'No deviations were found.',
  citationUnverified: 'Source not found in the stored text',
  gapNoSpec: 'No specification was found',
  gapNoKey: 'No key was found to search with',
  gapNotInProject: 'This repository is not inside a known project repository; only its own repository was searched',
  gapSourceUnreadable: 'Could not read the specification source',
  stale: 'Stale',
  readInFull: 'Read in full',
  viewPreview: 'Preview',
  viewRaw: 'Raw Markdown',
  retry: 'Retry assessment',
  loadFailed: 'Could not load the specification context.',
} as const;
