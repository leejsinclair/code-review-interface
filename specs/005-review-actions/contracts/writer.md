# Writer contract

Files: `src/contracts/source-control-writer.ts` (new), additions to `source-control.ts`, `shared.ts` and `http.ts`. Names below come from plan.md and research.md; field-level shapes are proposed.

## SourceControlWriter

```ts
export interface Anchor {
  path: string;
  side: 'base' | 'head';
  startLine: number;
  endLine: number;      // equals startLine for a single line
  commit: string;       // head commit the comment is made on
}

export type WriteOutcome =
  | { kind: 'comment'; commentId: string; threadId?: string; createdAt: string; commit: string }
  | { kind: 'decision'; decision: 'approved' | 'changes_requested' | 'withdrawn'; platformId?: string; createdAt: string; commit: string };

export interface ActionCapability { allowed: boolean; reason?: string }
export interface ReviewCapability {
  comment: ActionCapability; line_comment: ActionCapability; reply: ActionCapability;
  edit_comment: ActionCapability; delete_comment: ActionCapability;
  approve: ActionCapability; request_changes: ActionCapability; withdraw_decision: ActionCapability;
}

export interface SourceControlWriter {
  postComment(repo: RepoRef, pr: PullRequestRef, body: string): Promise<WriteOutcome>;
  postLineComment(repo: RepoRef, pr: PullRequestRef, anchor: Anchor, body: string): Promise<WriteOutcome>;
  replyToThread(repo: RepoRef, pr: PullRequestRef, threadId: string, body: string): Promise<WriteOutcome>;
  editComment(repo: RepoRef, pr: PullRequestRef, commentId: string, body: string): Promise<WriteOutcome>;
  deleteComment(repo: RepoRef, pr: PullRequestRef, commentId: string): Promise<void>;
  approve(repo: RepoRef, pr: PullRequestRef, commit: string, body?: string): Promise<WriteOutcome>;
  requestChanges(repo: RepoRef, pr: PullRequestRef, commit: string, body: string): Promise<WriteOutcome>;
  withdrawDecision(repo: RepoRef, pr: PullRequestRef): Promise<WriteOutcome>;
}
```

No method merges, declines or closes (constitution II.1, FR-012). Adapters translate `Anchor` to GitHub `line`/`side`, GitLab `position`, Bitbucket `inline`. An action a platform cannot do returns `allowed: false` with a reason from `reviewCapability`.

## Read additions on SourceControlProvider (still read-only)

```ts
listComments(repo, pr): Promise<Comment[]>;     // includes threadId, anchor, outdated
myDecision(repo, pr): Promise<ReviewDecision | null>; // commit, message, time
reviewCapability(repo, pr): Promise<ReviewCapability>; // read-only; the one definition
```
`ReviewCapability` is defined above and is not a method of `SourceControlWriter`.
A comment is editable or deletable only when its platform id is in `write_record` and its author is the signed-in user (R4, FR-011).

## Error codes

`AdapterErrorCode` gains four codes next to `unauthorized`, `not_found`, `unavailable`, `truncated`. `ADAPTER_ERROR_CODES` is updated and each carries the platform message.

| Code | Platform signal | Meaning |
|---|---|---|
| `forbidden` | 403, missing write scope | Not allowed or scope missing; prompt sign-in, keep text in the box |
| `conflict` | 409 | State changed (head moved, pull request not open) |
| `rejected` | 422 | Platform refused the content or anchor |
| `rate_limited` | 429 | Retry later |

## write-http.ts

Separate from `read-only-http.ts` (unchanged). Per-platform method plus endpoint-pattern allowlist; any other method or endpoint is refused before the network. No redirects. Registry gets a separate `SOURCE_WRITER` map and `writerDeps()`.

## Write scopes per platform

Requested lazily on the first write action through the existing credential flow (R9). The plan does not name exact scopes. The values below are proposed from current platform documentation and must be verified against each recorded fixture.

| Platform | Write scope (proposed) | Notes |
|---|---|---|
| GitHub | Fine-grained token: Pull requests: read and write. Classic token: `repo` (or `public_repo`) | Covers comments, reviews, dismiss/withdraw |
| GitLab | `api` | `read_api` is not enough to write notes or approve |
| Bitbucket | `write:pullrequest:bitbucket` (with `read:pullrequest:bitbucket`) | App password: Pull requests: Write |
