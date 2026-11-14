# Contract: HTTP API (deltas)

File: `src/contracts/http.ts`. Routes are unchanged from feature 005 (`specs/005-review-actions/contracts/http.md`)
and feature 006 (`specs/006-spec-context/contracts/http-api.md`). No route is added or removed, and no
route merges, declines or closes (constitution II.1). Wire comments carry no platform names (FR-018).

## POST /api/sessions/:sessionId/review-actions

Request body unchanged: `{ action: ReviewAction, expectedHead: string, requestId: string }`.

Response 200 gains `warning`:

```ts
export type ReviewActionResult = {
  comment?: Comment;
  decision?: ReviewDecision | null;
  record: ReviewActionRecord;
  /** Set when an approve or request_changes decision was made but its message was not posted (FR-010). */
  warning?: { code: 'message_not_posted'; message: string };
};
```

- `warning` present: the decision was made (`decision` reflects it); the message was not posted. The client
  keeps the message text in the box.
- Decision and message both succeed: no `warning`. The message is later listed with `postedByTool: true`
  and `editable: true`.
- Decision fails: an error response as below; no message was posted.

Errors, each `{ code, message, platformMessage? }`, pinned for every platform:

| Status | `code` | Case |
|---|---|---|
| 403 | `forbidden` | The signed-in user is the pull request's author (handle match, any platform). Nothing is sent to the platform. |
| 409 | `conflict` | The pull request moved to a newer commit than the line anchor's (message names new commits). Nothing is posted. |
| 409 | `conflict` | `withdraw_decision` when the reviewer has no decision ("nothing to withdraw"). |

Other 005 codes (`invalid_body`, `unauthorized`, `in_flight`, `rejected`, `rate_limited`, `unavailable`) are unchanged.

## GET /api/sessions/:sessionId/review-actions/comments

`ReviewCommentItem = Comment & { editable: boolean }`, where `Comment` gains `startsThread: boolean` and
`author.handle: string` (see source-control.md). `editable` is true only when `sameHandle(author.handle,
currentUser.handle)` and the comment id is in this session's posted write records (research.md R15).

## GET /api/sessions/:sessionId/review-actions/decision

Shape unchanged. On a pull request the signed-in user wrote, `canReview` is
`{ allowed: false, reason: <"you are the author" reason> }` on every platform, and every `capability`
entry is disabled with that reason. `capability.reply.allowed` is true on every platform (FR-015).

## Review queue: PullSummary and PullGroup

```ts
export type PullSummary = {
  // ...
  /** The pull request's head commit on the platform. May be abbreviated on list rows; compare by prefix (FR-019). */
  headCommit?: string;
};

export type PullGroup = {
  // ...
  /** Set when every "approved by me" check failed (adapter code `unavailable`), so approved pull requests may be listed as to review. */
  approvalsNote?: string;
};
```

When only some checks fail, the group loads, the successful pull requests carry `approvedByMe`, the
failures are logged, and `approvalsNote` is not set (FR-013).

## Spec context

```ts
export type SpecSource = {
  /** The term that matched, as written: a tracker key, or the branch name / its last segment after `/`. */
  key: string;
  used: SpecCopy;
  rule: SpecRule;
  others: SpecCopy[];
};

/** Stored and wire values unchanged. 'matching-branch-over-develop' is labelled "matching branch over base branch". */
export type SpecRule = 'own-repository-first' | 'matching-branch-over-develop' | 'most-recent-commit' | 'only-candidate';

export type SpecLookupGap =
  | { kind: 'no-key'; message: string }
  | { kind: 'read-failed'; message: string };
```

- `{ kind: 'no-enclosing-repository' }` is removed. A repository not inside an enclosing project repository
  produces no gap, warning or note (FR-034). The stored `not-inside-project` note is no longer surfaced.
- `no-key` is raised only when there is neither a tracker key nor a usable branch name.
- Matching (FR-032): with no tracker key, a folder matches when its name equals the branch name, or the branch
  name's last segment after `/`, ignoring case and whole-name only. `feature/007-review-actions-parity` matches
  `specs/007-review-actions-parity`; `007-review` does not. A tracker key, when present, matches as feature 006.
- Branches searched (FR-033): the repository's default branch, plus `develop` when it exists, plus the
  matching branches. `SpecCopy.branch` names the actual branch holding each copy.
- Own repository still ranks first over an enclosing project repository (`own-repository-first`, FR-035).
