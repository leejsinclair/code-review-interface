# Contract: neutral source-control read and write contracts (deltas)

Files: `src/contracts/source-control.ts`, `src/contracts/source-control-writer.ts`, `src/contracts/shared.ts`.
This feature changes no method signature. It adds fields, pins behaviour every adapter must share, and
adds two shared adapter modules. Platform names stay inside `src/adapters/` (FR-018); every comment in
these contract files is platform-neutral. Shapes below come from plan.md and research.md R1-R9.

## Identity (FR-001, FR-002, R1, R2)

```ts
// source-control.ts
export type PullRequestInfo = {
  // ...existing fields unchanged; `author` stays the display text
  /** The author's handle, in the same form as CurrentUser.handle. '' when the platform reports none (deleted account). */
  authorHandle: string;
};

// source-control-writer.ts
export interface Comment {
  // ...
  /** `id` and `name` unchanged. `handle` is in the same form as CurrentUser.handle; '' when unknown. */
  author: { id: string; name: string; handle: string };
};
```

Every adapter fills `authorHandle` and `author.handle` from the same platform field it uses for
`currentUser().handle`. The per-platform source is an adapter detail (research.md R1).

Core compares identities only through one helper in `src/core/review-actions.ts`:

```ts
/** True only when both handles are non-empty and equal ignoring case. */
export function sameHandle(a: string, b: string): boolean;
```

It is the only comparison used by the author guard in `run()`, by `decision()`, by edit/delete
ownership, by `readBack()` and by `comments()`. Display names and numeric ids are never compared.
An empty handle never matches, so a pull request whose author account is gone stays reviewable.

## Threads (FR-005, FR-006, R3)

```ts
export interface Comment {
  /** Id a reply is posted to. Every comment in a conversation of any depth carries the same value. */
  threadId: string;
  /** True for the comment that started the thread. A thread with no such comment had its first comment deleted. */
  startsThread: boolean;
  // ...
};
```

- Adapters drop deleted comments but keep their replies, with `threadId` resolved to the first comment
  even when that comment, or a middle reply, is deleted.
- A thread whose comments all have `startsThread: false` is shown by the UI under one "Deleted comment"
  placeholder (see ui.md).
- A platform that keeps no trace of a deleted first comment promotes the next comment to `startsThread: true`.
  The contract suite states this as the expectation value `orphanPlaceholder: false`, never as a branch on platform.

## Line anchors (FR-007, FR-008, R4)

`postLineComment(repo, pr, anchor, body)` behaviour, every writer:

1. Read the pull request through the read layer (`createReadOnlyFetch`, FR-016).
2. If its head commit is not `anchor.commit`, reject with `AdapterError('conflict')` and post nothing.
   Where the platform keeps several diff versions, only the newest counts.
3. Otherwise post at exactly `anchor.startLine`..`anchor.endLine` on `anchor.side`
   (`endLine === startLine` for a single line).

Commit ids are compared in full; an abbreviated id on a list row never causes a refusal (FR-019).

## Decision with a message (FR-009, FR-010, FR-011, R5)

```ts
export type WriteOutcome =
  | { kind: 'comment'; commentId: string; threadId?: string; createdAt: string; commit: string }
  | {
      kind: 'decision';
      decision: 'approved' | 'changes_requested' | 'withdrawn';
      platformId?: string;
      createdAt: string;
      commit: string;
      /** Set only when a non-empty message was sent as a separate write after the decision. */
      message?: { posted: true; commentId: string } | { posted: false; reason: string };
    };
```

- `approve(repo, pr, commit, body?)` and `requestChanges(repo, pr, commit, body)`: on a platform that sends
  the decision and its message separately, the decision is written first and the message second.
- If the decision write fails, the method rejects and no message is posted.
- If only the message write fails, the method resolves with the made decision and
  `message: { posted: false, reason }`. It never rejects for a failed message.
- A platform that sends decision and message in one write sets no `message`.
- An empty or absent message posts nothing and sets no `message`.
- Core records a posted message as a second write-record intent `<requestId>:message` with action
  `comment` and the message's `commentId`, so it is `postedByTool` and editable (FR-011). No schema change.

Documented on the contract (FR-020): on platforms that record no commit for a decision, the decision
stands on the current head.

## Withdraw (FR-012, R6)

`withdrawDecision(repo, pr)`: every writer first reads `myDecision()` through the read layer. When it is
null, the writer rejects with `AdapterError('conflict')` ("nothing to withdraw") and writes nothing.
A second withdraw straight after the first gives the same `conflict`.

## Reply to a whole-pull-request comment (FR-015, R9)

`replyToThread(repo, pr, threadId, body)` succeeds on every platform for a whole-pull-request comment.
Where the platform has no reply for such comments, the writer reads the original through the read layer
and posts a new whole-pull-request comment whose body is the original quoted (`> ` before each line), a
blank line, then the reply. That new comment starts its own thread. `ReviewCapability.reply` stays
`allowed: true` on every platform; the interface never offers a reply bound to fail.

## "Approved by me", shared (FR-013, FR-014, R7)

New module `src/adapters/approved-by-me.ts`:

```ts
/**
 * Runs `one(n)` for each number (concurrency 4), logs each failure with the pull request number and error
 * code, and returns the numbers whose check returned true. Throws AdapterError('unavailable') when every
 * check failed and `numbers` is not empty.
 */
export function approvedAcross(
  platform: PlatformId,
  numbers: readonly number[],
  one: (n: number) => Promise<boolean>,
): Promise<Set<number>>;
```

`SourceControlProvider.approvedByMe(repo, numbers): Promise<Set<number>>` keeps its shape. Each adapter
implements it as one call to `approvedAcross` with its own `one`. Core turns `unavailable` into
`PullGroup.approvalsNote` (see http-api.md).

## Combined reads within one request (FR-016, FR-017, R8)

New module `src/adapters/request-memo.ts`:

```ts
/** Runs `fn` inside a request scope (AsyncLocalStorage). Outside a scope nothing is cached. */
export function withRequestScope<T>(fn: () => Promise<T>): Promise<T>;
```

- `src/server/http.ts` wraps each request in `withRequestScope`.
- Inside a scope, `createReadOnlyFetch` (`read-only-http.ts`) serves repeated GETs of the same URL and
  credential from one in-flight promise and replays the body to each caller.
- `createWriteFetch` (`write-http.ts`) clears the scope's memo after every write, successful or not. It
  cannot read through the memo (VIII.3).
- Every read a writer needs goes through `createReadOnlyFetch` (FR-016).

## Clone recognition (FR-021, R10)

```ts
// src/adapters/registry.ts
export type SourceControlSettings = { repository: RepoRef; baseUrl?: string; sshHost?: string };
```

`cloneLocations(repo)` and `repositoryForRemote(normalisedRemote)` accept, per adapter:

| Remote host form | Recognised |
|---|---|
| `ssh.bitbucket.org` | yes (already) |
| `ssh.github.com` on port 443 (port dropped by `normaliseRemote`) | yes |
| A self-hosted SSH host given as `sshHost`, differing from the web host | yes |
| Any other host whose path happens to match | no |

## Error codes

No new `AdapterErrorCode`. This feature pins which existing code each case uses on every platform:

| Code | Case |
|---|---|
| `forbidden` | Reviewing your own pull request (author guard; refused by the server before any write) |
| `conflict` | New commits since the lines were chosen; nothing to withdraw |
| `unavailable` | Every "approved by me" check failed |
