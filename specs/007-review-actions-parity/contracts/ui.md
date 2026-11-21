# Contract: UI identifiers and labels (deltas)

Existing `data-testid` values from feature 005 (`specs/005-review-actions/contracts/ui.md`) and feature 006
(`specs/006-spec-context/contracts/ui.md`) are unchanged. The spec names no new identifiers; the new ones
below are proposed. No route is added.

## data-testid

| Component | `data-testid` | Status | Notes |
|---|---|---|---|
| `comment-thread.tsx` | `comment-thread`, `comment`, `comment-outdated`, `comment-reply`, `comment-edit`, `comment-delete` | existing | `comment-edit` / `comment-delete` render only when `editable` (FR-004). `comment-reply` renders on whole-pull-request threads on every platform (FR-015) |
| `comment-thread.tsx` | `comment-deleted-placeholder` | new | Muted "Deleted comment" row shown first in a thread with no `startsThread` comment; replies follow in the same `comment-thread` (FR-006) |
| `decision-panel.tsx` | `decision-panel`, `decision-approve`, `decision-request-changes`, `decision-comment`, `decision-withdraw`, `decision-message`, `decision-state` | existing | `decision-message` keeps its text when the result has a `warning` |
| `decision-panel.tsx` (`ActionNotice`) | `decision-message-not-posted` | new | Warning shown when `ReviewActionResult.warning.code === 'message_not_posted'`: decision made, message not posted (FR-010) |
| Disabled reason | `review-disabled-reason` | existing | Shows the "you are the author" reason on an own pull request, on every platform (FR-003) |
| Out of date | `review-out-of-date` | existing | Shown after a `conflict` for new commits; nothing was posted (FR-007) |
| `spec-context.tsx` | `spec-rule` | existing | Text from the rule label map; `matching-branch-over-develop` reads "matching branch over base branch" |
| `spec-context.tsx` | `spec-other-copy` | existing | Reads "`<branch>` also has a copy", naming the copy's actual branch |
| `spec-context.tsx` | `spec-notices` | existing | Never contains a "not inside a known project repository" gap (FR-034) |

## Labels (`src/ui/labels.ts`)

| Key | Change | Text |
|---|---|---|
| `REVIEW_LABELS.deletedComment` | add | "Deleted comment" |
| `REVIEW_LABELS.messageNotPosted` | add | States that the decision was made and the message was not posted |
| `SPEC_LABELS` rule labels | add | One label per `SpecRule`; `matching-branch-over-develop` → "matching branch over base branch" |
| `SPEC_LABELS.gapNotInProject` | remove | — |
| `QUEUE_LANE_LABELS.approved` | unchanged | "Approved by you, waiting to merge", now on the own-approval allowlist (FR-023) |

## Safety tests

- `test/unit/ui-safety.test.ts`: `OWN_APPROVAL_STRINGS` gains `'Approved by you, waiting to merge'` (FR-023).
  Every other interface string stays banned from saying ready, safe or approved.
- `test/unit/ui-safety.test.ts`: exempts exactly `components/markdown-preview.tsx` from the HTML-injection scan,
  by name, citing FR-024. Every other UI file stays under the ban. `test/ui/markdown-preview.ui.ts` proves the
  sanitising strips scripts, event handlers (`onerror`) and `javascript:` links.
- `test/unit/ui-view-state.test.ts`: the stored view state allowlist includes the collapsed lanes setting (FR-025).

## Removed files (FR-026)

`src/ui/components/panel-host.tsx`, `src/ui/components/evidence-panel.tsx`.
