# UI contract: data-testid identifiers

The spec and plan name no `data-testid` values. All identifiers below are proposed. Components: `comment-box.tsx`, `comment-thread.tsx`, `decision-panel.tsx`. There is no confirm dialog and no draft.

| Component | `data-testid` | Notes |
|---|---|---|
| Diff line | `line-comment-button` | Starts a comment on the selected line or range (FR-001) |
| Comment box | `comment-box`, `comment-input`, `comment-submit`, `comment-cancel`, `comment-error` | `comment-submit` is labelled "Post comment" and posts at once; disabled for empty text. Text stays after an error |
| Thread | `comment-thread`, `comment`, `comment-outdated`, `comment-reply`, `comment-edit`, `comment-delete` | Edit and delete only on tool-posted own comments |
| Decision panel (overview and file view) | `decision-panel`, `decision-approve`, `decision-request-changes`, `decision-comment`, `decision-withdraw`, `decision-message`, `decision-state` | Labelled as the reviewer's own; never readiness styling. Request changes disabled until a message is typed |
| Disabled reason | `review-disabled-reason` | Shown when `canReview.allowed` is false |
| Out of date | `review-out-of-date` | Shown after a `conflict` response; nothing was posted |

Buttons name the action: Approve, Request changes, General comment, Post comment, Withdraw, Delete comment. "Reject" is never shown; the nearest action is Request changes.
