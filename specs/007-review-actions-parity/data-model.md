# Data Model: Review Actions Platform Parity

This feature adds no table and no store migration. It reshapes the neutral contract types from features 004, 005 and 006, adds two in-memory structures in `src/adapters/` (the request scope and the "approved by me" result), and adds one new intent shape to the existing `write_record` table. Every type below is a read model or a request-lifetime value unless it says "stored".

Decisions behind each shape are in `research.md` (R1 to R15). Field names match the TypeScript contracts.

## Identity (handle)

Who someone is on a platform, in one comparable form. Audit data only (constitution VII.2): compared, logged and stored as `actor`, never aggregated or ranked.

| Carrier | Field | Change |
|---|---|---|
| `CurrentUser` (`src/contracts/source-control.ts`) | `handle: string` | Unchanged. The signed-in user's handle. `displayName` stays display text |
| `PullRequestInfo` | `authorHandle: string` | NEW. The pull request author's handle. `author` stays the display text shown on Home, in the queue and in the review shell (R1) |
| `Comment.author` (`src/contracts/source-control-writer.ts`) | `handle: string` | NEW. Shape becomes `{ id, name, handle }`. `id` keeps the platform id, `name` the display name |

**What each platform puts in the handle** (FR-001):

| Platform | `CurrentUser.handle` | `authorHandle` and `author.handle` |
|---|---|---|
| Bitbucket Cloud | `account_id` | `author.account_id`, or `''` when absent |
| GitHub | `login` | `user.login` |
| GitLab | `username` | `author.username` |

**Comparison rule** (FR-002, R2): one core helper, `sameHandle(a, b)`.

- True only when both values are non-empty and equal ignoring case.
- Never compares `displayName`, `author.name`, `author.id` or `author` (display text).
- Used in all five places that decide ownership: the author guard in `run()`, `decision()`, edit/delete ownership, `readBack()` and `comments()`. The two inline `info.author === me` checks are removed.
- An empty handle (deleted author account, edge case) matches no one, so review actions stay available.

**Author guard** (FR-003): when `sameHandle(currentUser.handle, info.authorHandle)`, every `ReviewCapability` entry is `{ allowed: false, reason: <"you are the author"> }`, `CanReview.allowed` is false, and `POST /review-actions` fails with `forbidden` before any write record or platform call.

**Display after posting** (R2): `resultOf()` fills `author.name` from `currentUser().displayName` and `author.handle` from `currentUser().handle`, so a just-posted comment shows the name and is recognised as the reviewer's.

## Comment (read model, reshaped)

Returned by `SourceControlProvider.listComments(repo, pr)`. Only the changed fields are listed; the rest are as in feature 005.

| Field | Type | Notes |
|---|---|---|
| `threadId` | string | The id a reply is posted to. Every comment in a thread carries the same value, including replies nested at any depth (FR-005). On GitLab it is the discussion id, so it need not equal any comment's `id` |
| `startsThread` | boolean | NEW. True for the comment that started the thread (R3). Replaces the `id === threadId` test, which cannot work on GitLab |
| `author` | `{ id, name, handle }` | See Identity |
| `postedByTool` | boolean | Unchanged rule (R15): core sets it when `sameHandle(author.handle, me)` and `id` is the `platform_id` of a `posted` write record in this session. Adapters set false |

**How each platform fills the thread fields**:

| Platform | `threadId` | `startsThread` | Deleted comments |
|---|---|---|---|
| Bitbucket Cloud | Root id found by walking `parent` links over every comment, deleted ones included | `parent` absent | Dropped after the walk, so their replies keep the root's `threadId` |
| GitHub | Root id (`in_reply_to_id`, or own id when absent) | `in_reply_to_id` absent | GitHub returns no deleted comments; replies keep pointing at the deleted root |
| GitLab | Discussion id | First note of the discussion | GitLab keeps no trace of a deleted first note: the next note becomes first |

**Validation rules**

- Within one `threadId`, at most one comment has `startsThread: true`.
- Comments in a thread are ordered by `createdAt`.
- Edit and delete are offered only when `editable` (`ReviewCommentItem`) is true, which equals `postedByTool` (FR-004). A comment by someone else, or by the reviewer outside the tool, is never editable.
- A handle that changed between listing and editing: ownership follows the handle at the time of the check, and a platform refusal is reported as `forbidden` (edge case).

## Comment thread (derived in the UI)

Built by the pure function `threadsOf()` in `src/ui/state/use-review-comments.ts`. Not stored, not on the wire.

| Field | Type | Notes |
|---|---|---|
| `threadId` | string | Shared by every comment in the thread |
| `start` | `ReviewCommentItem` or `'deleted'` | The comment with `startsThread: true`, or the "Deleted comment" placeholder when none is present (FR-006) |
| `replies` | `ReviewCommentItem[]` | Every other comment with this `threadId`, by `createdAt` |
| `canReply` | boolean | `capability.reply.allowed`. True on whole-pull-request threads on every platform (FR-015) |

**Rules**

- A conversation of any depth is exactly one thread (SC-003).
- A deleted first comment and a deleted middle reply still give one thread under one placeholder (edge case).
- On GitLab the placeholder never appears, because a deleted first note leaves no gap. The contract suite states this as the expectation value `orphanPlaceholder: false` for GitLab, not as a branch (XI.2).

## Line anchor (contract unchanged, rules tightened)

`Anchor { path, side, startLine, endLine, commit }`. `endLine === startLine` for a single line. `commit` is the head the lines were chosen on.

**Validation rules**

- Before any line comment POST, the writer reads the pull request through the read layer and refuses with `conflict` ("new commits") when the head is not `anchor.commit` (FR-007, R4). Core's existing `expectedHead` check stays in front of it.
- GitLab compares with the newest diff version only (`versions[0]`), never any older version.
- Commit ids are compared in full. A list row's `PullRequestInfo.headCommit` may be abbreviated; the read contract says so in neutral terms, and the interface compares by prefix where one side is abbreviated, so an abbreviation never causes a false refusal (FR-019).
- The posted comment covers exactly `startLine` to `endLine` on `side` (FR-008).

## Decision outcome (reshaped)

The `kind: 'decision'` variant of `WriteOutcome` gains an optional message result.

```ts
| {
    kind: 'decision';
    decision: 'approved' | 'changes_requested' | 'withdrawn';
    platformId?: string;
    createdAt: string;
    commit: string;
    message?: { posted: true; commentId: string } | { posted: false; reason: string };
  }
```

**Rules** (FR-009, FR-010, R5)

- `message` is absent when no message was given, when the message is empty, and on platforms that send decision and message together (GitHub, in one review).
- On platforms that send them separately (Bitbucket Cloud, GitLab), the decision POST comes first. The message POST runs only after the decision succeeds.
- If the decision fails, the writer throws as before and posts no message.
- If the decision succeeds and the message fails, the writer returns the made decision with `message: { posted: false, reason }`. It never throws in this case.
- On a platform that records no commit for a decision, `commit` is the current head; the decision stands on it (FR-020, stated in the writer contract in neutral terms).

**Withdraw** (FR-012, R6): `withdrawDecision` reads `reads.myDecision()` first on every platform. When it is null the writer throws `AdapterError('conflict')` and sends nothing. A second withdraw straight after a first gives the same `conflict`.

## Review action result (reshaped)

`ReviewActionResult` in `src/contracts/http.ts` gains a warning.

| Field | Type | Notes |
|---|---|---|
| `comment` | `Comment`, optional | Unchanged |
| `decision` | `ReviewDecision \| null`, optional | Unchanged. Present whenever the decision was made, even when the message failed |
| `record` | `ReviewActionRecord` | Unchanged. The decision's record |
| `warning` | `{ code: 'message_not_posted'; message: string }`, optional | NEW. Set only when the outcome had `message.posted === false` |

The decision panel shows the warning as an `ActionNotice` saying the decision was made and the message was not posted, and keeps the message text in the box (US5-AS1). An empty message gives no warning.

## Write record (stored, existing table, new intent)

The `write_record` table and its state machine are unchanged (feature 005 data model). A decision with a posted message now produces two intents instead of one (FR-011, R5).

| Intent | `intent_id` | `action` | `body` | `platform_id` on `posted` |
|---|---|---|---|---|
| Decision | `<requestId>` | `approve` or `request_changes` | The message text, as today | Decision id |
| Message | `<requestId>:message` | `comment` | The message text | `message.commentId` |

**Rules**

- The message intent is written only when the outcome has `message.posted === true`. Because the comment already exists, it is written as `pending` then `posted` in one step, with the same `actor`, `destination` (`{ scope: 'pr' }`), `head_sha` and `created_at` rules as any `posted` row.
- The decision intent reaches its terminal row before the message intent opens, so "one pending intent per pull request" still holds.
- No row is updated or deleted (III.2). No new `action` value, so `postedCommentIds()` already treats the message as a tool-posted comment, and it becomes editable (US5-AS2).
- A failed message is not recorded as a `comment` intent: nothing was posted. The decision intent is `posted`, and the warning carries the failure.

**State transitions for a decision with a message**

```text
decision intent:  pending -> posted (decision made)
                          -> failed (decision refused; no message attempted)
message intent:   (only after decision posted and message.posted) pending -> posted
warning:          (decision posted and message.posted === false) -> ReviewActionResult.warning
```

## "Approved by me" result (shared)

`src/adapters/approved-by-me.ts` exports `approvedAcross(platform, numbers, one)`. The read contract keeps `approvedByMe(repo, numbers): Promise<Set<number>>` (R7, FR-014).

| Input or output | Type | Notes |
|---|---|---|
| `numbers` | `readonly number[]` | Pull requests to check |
| `one` | `(n: number) => Promise<boolean>` | The adapter's per-PR check |
| result | `Set<number>` | The pull requests whose check succeeded and found the reviewer's approval |

**Rules** (FR-013)

- Checks run through `mapLimited` with a limit of 4.
- Each failure is logged with the pull request number and error code, and does not stop the others.
- When `numbers` is not empty and every check failed, the helper throws `AdapterError('unavailable')`. Core turns this into the existing `PullGroup.approvalsNote` ("the check failed"), never "nothing approved".
- An empty `numbers` returns an empty set.

## Request scope and GET memo (in memory)

`src/adapters/request-memo.ts` (R8, FR-016, FR-017). Lives for one server request, inside Node's `AsyncLocalStorage`.

| Field | Type | Notes |
|---|---|---|
| `entries` | `Map<key, Promise<RecordedResponse>>` | Key is the GET URL plus the credential identity. The value is the single in-flight read; its body is replayed to each caller |

**Rules**

- Only `createReadOnlyFetch` reads from or fills the memo, and only for GET. The write layer can clear it but never reads through it (VIII.3).
- Every read a writer needs goes through `createReadOnlyFetch` (FR-016), so a writer's head check reuses core's read.
- Outside a scope nothing is cached.
- A failed read is not kept: the entry is removed so a later read in the same request retries.

**State transitions**

```text
(request arrives) -> open (empty)
open -> open      GET hit: shared promise returned; GET miss: entry added
open -> open(empty)   any write through createWriteFetch, successful or not, clears every entry
open -> closed    request finishes; the scope and its entries are dropped
```

Effect: opening the review queue on Bitbucket reads each pull request at most once per request (SC-010).

## Source-control settings and clone matching

| Carrier | Field | Notes |
|---|---|---|
| `WorkspaceConfig` (`src/config.ts`) | `sshHost?: string` | NEW, optional. A self-hosted SSH host that differs from `baseUrl`'s host. Validated as a bare host name (no scheme, no path) |
| `SourceControlSettings` (`src/adapters/registry.ts`) | `sshHost?: string` | NEW. Passed from config to the GitLab adapter |

**Clone locations** (FR-021, R10):

| Platform | Accepted remote hosts |
|---|---|
| Bitbucket Cloud | `bitbucket.org`, `ssh.bitbucket.org` (two `cloneLocations`; the read suite's expectation is updated) |
| GitHub | `github.com`, `ssh.github.com` (port 443 is dropped by `normaliseRemote`) |
| GitLab | The `baseUrl` host, and `sshHost` when set |

A remote on any other host is never claimed, even when its path matches.

## Environment credential

`envCredential(platform)` in `src/adapters/env-credentials.ts` (FR-022, R11). Used only when no other credential is available.

| Platform | Variables, in order | Result |
|---|---|---|
| GitHub | `GITHUB_TOKEN`, then `GH_TOKEN` | `{ secret, scheme: 'bearer', scope: 'write' }` |
| GitLab | `GITLAB_TOKEN` | `{ secret, scheme: 'bearer', scope: 'write' }` |

An empty or unset variable is treated as absent.

## Spec context: search terms, branches and sources

Feature 006's types, reshaped for the same-repository case (FR-032 to FR-036, R12). No store migration.

### Search term (in memory)

| Field | Type | Notes |
|---|---|---|
| `kind` | `'key' \| 'branch'` | A tracker key, or a branch-name term |
| `value` | string | The key as written, or the branch name / its last segment after `/` |

**Rules**

- When the pull request carries tracker keys, the terms are those keys and they match folders as feature 006 describes (FR-035).
- When it carries none, the terms are the source branch name and its last segment after `/`, de-duplicated ignoring case (FR-032).
- A branch term matches a spec folder only when the whole folder name equals it, ignoring case. `feature/007-review-actions-parity` matches `specs/007-review-actions-parity`; `007-review` does not.
- `SpecSource.key`, `SpecKeyResult.key`, `SpecLookupRecord.keys` and `SpecSourceRecord.key` carry the term value, so a branch term is shown where a key used to be.
- Because a source branch always yields a term, the `no-key` outcome and gap now arise only when there is no term at all.

### Remote heads (in memory)

`listRemoteHeads` runs `ls-remote --symref <url> HEAD refs/heads/*` and returns:

| Field | Type | Notes |
|---|---|---|
| `heads` | `Array<{ branch, commit }>` | As today |
| `defaultBranch` | `string \| null` | NEW. From the `HEAD` symref; null when the remote does not report one |

**Branches considered** (FR-033): the default branch, `develop` when it exists, and the matching branches (names matching a key, or the source branch itself for branch terms). Duplicates are considered once.

### Choosing a copy

- `chooseCopy(matcher, candidates)` takes a branch matcher in place of a key. Ranking is unchanged: own repository first, then matching branch over base branch, then most recent commit.
- The stored and wire rule value `matching-branch-over-develop` (stored `matching-branch` / `develop`) is kept. Only its label changes, to "matching branch over base branch".
- The panel names other copies from `SpecSource.others[].branch`: "`<branch>` also has a copy", never a fixed "develop". The stored `develop_copy_exists` column keeps its meaning; the label no longer reads from it.
- A folder present in both the own and the enclosing repository: the own repository wins (unchanged).

### Gaps

| Type | Change |
|---|---|
| `SpecLookupGap` | The `no-enclosing-repository` kind is removed (FR-034). `no-key` and `read-failed` stay |
| `SpecLookupRecord.enclosingNote` | Unchanged, still stored as `'found' \| 'not-inside-project' \| null`. `not-inside-project` no longer raises any gap, warning or note |

## Smaller shapes carried by this feature

- **View state** (FR-025): the stored dashboard view-state allowlist includes `collapsedLanes`.
- **UI labels** (FR-023): "Approved by you, waiting to merge" joins the allowed own-approval labels. New labels: `deletedComment`, `messageNotPosted`, the reworded spec rule label. `gapNotInProject` is removed.
- **Recorded fixtures** (FR-029, FR-030, R14): `recordingFetch` gains `aliases: Record<string, string>`, a real-to-placeholder map applied to URLs, headers and bodies. Placeholders are `alice-dev` (reviewer), `bob-dev` (author) and `test-workspace`. Recording runs through the real UI with the `test/record/capture.ts` preload, so every write is a person's click (II.4). Each fixture README names the recording role and date. In every fixture set the signed-in handle differs from `authorHandle`.

## Requirement trace

| FR | Entity or rule | First failing test |
|---|---|---|
| FR-001, FR-002 | Identity, `sameHandle` | `test/unit/review-actions.test.ts` with distinct id, name and handle; read contract suites |
| FR-003 | Author guard | Writer and route contract suites, own-PR scenario per platform |
| FR-004 | Comment `postedByTool` / `editable` | Read contract suite, ownership scenario |
| FR-005, FR-006 | Comment `threadId`, `startsThread`; Comment thread | Read contract suite, nested and orphaned replies; `threadsOf()` unit test |
| FR-007, FR-008, FR-019 | Line anchor | Writer contract suite, new-commits refusal and single/range anchors |
| FR-009, FR-010, FR-011 | Decision outcome, review action result, write record | Writer contract suite, failing message; `review-actions.test.ts` message record |
| FR-012 | Withdraw | Writer contract suite, nothing to withdraw |
| FR-020 | Decision commit | Documentation on the writer contract; no test, it states existing behaviour |
| FR-013, FR-014 | "Approved by me" result | `approved-by-me` unit test; read contract suite, fails everywhere |
| FR-015 | Comment thread `canReply`; GitHub quoting reply | Writer contract suite, reply to a whole-PR comment |
| FR-016, FR-017 | Request scope and GET memo | `request-memo` unit test; Bitbucket queue read count |
| FR-018 | No platform names outside adapters | UI and contract neutrality scan |
| FR-021 | Settings `sshHost`, clone locations | Read contract suite, clone locations |
| FR-022 | Environment credential | `env-credentials` unit test |
| FR-023, FR-024 | UI labels; Markdown preview exemption | `test/unit/ui-safety.test.ts`, `test/ui/markdown-preview.ui.ts` |
| FR-025 | View state | `test/unit/ui-view-state.test.ts` |
| FR-028 to FR-031 | Recorded fixtures, live GitLab writer | Contract suites as data; `npm run test:gitlab` |
| FR-032 to FR-036 | Search term, remote heads, choosing a copy, gaps | `test/unit/spec-match.test.ts`; `test/end-to-end/spec-context.test.ts` same-repository case |
