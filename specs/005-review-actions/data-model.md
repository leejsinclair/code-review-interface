# Data Model: Review Actions

One new local table (`write_record`) and four neutral contract types (`Comment`, `ReviewDecision`, `ReviewCapability`, `Anchor`). The contract types are read models returned by adapters and are not stored, except for the platform ids kept in `write_record`.

## write_record (local, append-only)

One row per step of a platform write. Constitution III.2 forbids update and delete, so a result is stored as a new row that shares an `intent_id`. The store exposes insert and read only. Rows go only when the whole session is deleted (cascade).

| Field | Type | Notes |
|---|---|---|
| id | integer PK | Row id, autoincrement |
| intent_id | text | Groups the rows of one action. Equals the client `requestId` |
| session_id | text FK | Cascade on session delete |
| state | enum | `pending`, `posted`, `failed` (see transitions) |
| action | enum | `comment`, `reply_comment`, `edit_comment`, `delete_comment`, `approve`, `request_changes`, `withdraw_decision` |
| actor | text | Signed-in account name. For audit only (VII.2), FR-015 |
| destination | json | PR ref plus one of: `{scope:'pr'}`, `{scope:'line', anchor}`, `{scope:'thread', thread_id}`, `{scope:'comment', comment_id}` |
| head_sha | text | Head commit the action applies to (FR-007, FR-008) |
| body | text, null | Exact text sent (FR-015). Null for approve without a message, delete and withdraw |
| platform_id | text, null | Comment or decision id. Set on `posted`; used to tell which comments this tool posted (R4) |
| error_code, error_message | text, null | Set on `failed`. Code is `forbidden`, `conflict`, `rejected`, `rate_limited` or `unavailable` |
| created_at | timestamp | Time of this row |

**Rules**
- A `pending` row is written before anything reaches the platform.
- Only one `pending` intent may be open per PR. This is the in-flight lock (R3).
- Exactly one terminal row (`posted` or `failed`) per `intent_id`. A repeat request with the same `requestId` finds a terminal row, returns it and posts nothing.
- Every `posted` row must have `actor`, `created_at`, `destination` and `head_sha` (SC-004).
- A retry after `failed` uses a new `requestId`.

**State transitions** (each arrow is a new row)

```text
(click) -> pending -> posted        platform accepted; platform_id recorded
                   -> failed        platform refused, or head moved (known outcome)
                   -> pending(read-back)  ambiguous failure (timeout): the read-back runs
                                    before any retry. If it finds the write, the intent
                                    ends `posted`, otherwise `failed`.
```

A `pending` row with no result (server stopped mid-write) is closed with a `failed` row (`error_code = 'abandoned'`) at the next request for that PR, so it stops holding the lock. `abandoned` is a local code.

## Comment (read model)

Returned by `SourceControlProvider.listComments(repo, pr)`. Neutral, never platform-shaped.

| Field | Type | Notes |
|---|---|---|
| id | text | Platform comment id |
| thread_id | text | Id of the thread root. Equal to `id` for a root comment |
| author | `{id, name}` | Name for display only |
| body | text | |
| created_at, edited_at | timestamp, null | |
| anchor | Anchor, null | Null means a comment on the whole PR |
| outdated | boolean | True when the anchored line is gone at the latest head (edge case) |
| postedByTool | boolean | Derived by core: the `platform_id` matches a `posted` `write_record` row, and the author is the signed-in user (R4, FR-011) |

**Rules**
- Edit and delete are offered only when `postedByTool` is true (FR-011). Otherwise there is no action.
- Replies share `thread_id` with the root. Order is by `created_at`.
- A deleted comment disappears from the read result. A `posted` `delete_comment` row is the history.

## ReviewDecision (read model)

Returned by `SourceControlProvider.myDecision(repo, pr)`: the signed-in reviewer's own current decision, or null. It is not readiness, and it must not share readiness labels, styling or inputs (FR-013).

| Field | Type | Notes |
|---|---|---|
| kind | enum | `approved`, `changes_requested` |
| message | text, null | Required for `changes_requested` (FR-004) |
| commit | text | Commit the decision was made on (FR-008) |
| decided_at | timestamp | |
| stale | boolean | True when `commit` is not the current head ("made on an earlier commit") |
| platform_id | text, null | Needed to withdraw where the platform requires one |

**Rules**
- At most one current decision per reviewer and PR. A new decision replaces the old one on the platform. Local history stays in `write_record`.
- Withdraw (FR-009) is one click like the other actions, and ends with `myDecision` returning null.
- The overview and the file view read the same value, so the two stay in step (US3).

## ReviewCapability

Returned by `reviewCapability(repo, pr)`. Per-action eligibility with a reason, in the same shape as `canOverride` (R6, R7). It is computed on the server, and the UI never works it out.

| Field | Type | Notes |
|---|---|---|
| canReview | `{allowed, reason?}` | Whole-PR gate: PR open, account is not the author, account has access, signed in (FR-018) |
| actions | map action -> `{allowed, reason?}` | Keys: `comment`, `line_comment`, `reply`, `edit_comment`, `delete_comment`, `approve`, `request_changes`, `withdraw_decision` |

**Rules**
- `reason` is required when `allowed` is false, and the UI shows it as is (FR-018).
- `canReview.allowed = false` makes every action disallowed, with the same reason.
- A platform gap, such as no request-changes on a GitLab version without it, is an `allowed: false` entry with a reason, not an error (FR-020, VIII.2).
- No action for merge, decline or close exists in the map (FR-012).
- A platform refusal, as `forbidden`, is the fallback if the capability turned out wrong.

## Anchor (neutral)

`{ path, side, startLine, endLine, commit }`. Used in `Comment` and `write_record.destination`. Each adapter translates it to its platform's fields (R6).

| Field | Type | Notes |
|---|---|---|
| path | text | File path in the PR |
| side | `'base'` or `'head'` | Old or new side of the diff |
| startLine, endLine | integer | 1-based. Equal for a single line. `endLine >= startLine` (FR-001) |
| commit | text | Commit the anchor was made on. A comment stays at this commit and is `outdated` when the line no longer exists at head |

**Validation**
- `path` must be a file changed in the PR, and the line range must lie inside the diff of that file on `side`.
- `commit` is the head the client viewed (`expectedHead`), checked by core against the current head.
- A comment on the whole PR has no anchor (null), not an anchor with empty fields.

## Relationships

```text
session 1 --- * write_record  (cascade)       write_record * --- 1 intent (intent_id)
write_record.platform_id ---> Comment.id / ReviewDecision.platform_id  (matched in core)
Comment.anchor and write_record.destination.anchor use Anchor
ReviewCapability gates every action; ReviewDecision is separate from readiness
```
