# HTTP contract: review actions

Base: `/api/sessions/:sessionId` (same guard and conventions as `risk.ts`). Paths and field shapes are proposed; the spec pins none. Bodies reject unknown fields. Every POST is a state-changing request (X.5). There is no preview, confirm or drafts route (user decision, constitution 3.0.0).

| Method | Path | Purpose |
|---|---|---|
| POST | `/review-actions` | Perform one action at once |
| GET | `/review-actions/comments` | List comments (`listComments`), each with `editable` |
| GET | `/review-actions/decision` | The reviewer's own decision (`myDecision`) plus `canReview` and `capability` |

No route merges, declines or closes (FR-012).

## Action

```ts
type ReviewAction =
  | { kind: 'comment'; destination: 'pull_request' | 'line' | 'reply' | 'edit' | 'delete';
      body?: string; anchor?: Anchor; threadId?: string; commentId?: string }
  | { kind: 'approve'; body?: string }          // optional message (FR-003)
  | { kind: 'request_changes'; body: string }   // message required (FR-004)
  | { kind: 'withdraw_decision' };              // FR-009
```

`Anchor = { path, side: 'base'|'head', startLine, endLine, commit }` (see writer.md).

## POST /review-actions

Request: `{ action: ReviewAction, expectedHead: string, requestId: string }`. `expectedHead` is the head commit the reviewer was viewing. `requestId` is a new uuid per click; a repeat returns the earlier result and posts nothing.

Response 200:
```ts
{ comment?: Comment; decision?: ReviewDecision | null;
  record: { id: string; postedAt: string; headSha: string } }
```

Errors, each `{ code, message, platformMessage? }`. The text typed in the box is never cleared by the client on error.
- 400 `invalid_body`: empty or whitespace-only text, missing message on `request_changes`.
- 401 `unauthorized`.
- 403 `forbidden`: not the author, no access (`canReview.reason`), or missing write scope.
- 409 `conflict`: head moved since the reviewer's view ("out of date"), or the pull request is not open (message "pull request is not open"). Applies to every action, including withdraw, edit, delete and reply. Nothing is posted.
- 409 `in_flight`: another write on this PR is running.
- 422 `rejected`; 429 `rate_limited`; 502 `unavailable`.

After an ambiguous failure (timeout) the server reads back before it allows another attempt (FR-016, SC-007).

## Eligibility

`canReview: { allowed: boolean; reason?: string }` (same shape as `canOverride`): PR open, signed-in account is not the author, account has access. `capability: Record<'comment'|'line_comment'|'reply'|'edit_comment'|'delete_comment'|'approve'|'request_changes'|'withdraw_decision', { allowed: boolean; reason?: string }>`.
