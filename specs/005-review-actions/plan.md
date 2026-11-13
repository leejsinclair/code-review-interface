# Implementation Plan: Review Actions

**Spec**: `review-actions.spec.md` | **Size**: oversized

**Scale note**: This change spans about 25 files across five areas: contracts, three platform adapters, the local store and server, and the UI. Watch the write path (constitution II.4, VIII.3, X.11): it is the first code in this product that writes to a platform, and with no confirmation step the head-commit check, the lock and the request id are the safeguards.

## Summary

The reviewer comments, approves, requests changes, replies, edits and deletes from the file view and the overview. Each action is one click that posts at once. There is no preview, no confirmation step and no local draft. The request carries the head commit the reviewer was viewing and a per-click request id; the server refuses it if the head has moved and posts a repeated id only once. Writes go through a new `SourceControlWriter` contract with its own write-only HTTP layer, method and endpoint allowlist, and one implementation per platform. Reading comments and the reviewer's own decision is new read work on `SourceControlProvider`. An append-only `write_record` in the local SQLite store records every write.

No new dependencies. Constitution II.4 and X.11 were amended to 3.0.0 to allow this.

## Constitution Check

| Rule | Assessment |
|---|---|
| II.1 platform writes limited to listed reviewer actions | PASS. The writer allowlist holds only those actions. No merge, decline or close. |
| II.2 readiness not settable, reviewer decision labelled as theirs | PASS. The decision panel is separate from `ReviewFocus` and readiness inputs (FR-013). |
| II.4 (3.0.0) person-started by one named click, commit-tied, recorded | PASS. One POST with `expectedHead`, server refuses if head moved, `write_record` row per write. |
| III.2 append-only | PASS. `write_record` has no update or delete. Session deletion cascades as for other records. |
| VII.2 actor names for audit only | PASS. Actor appears in the write record only. |
| VIII.2 no platform branching outside adapters | PASS. Platform differences become neutral capability fields. |
| VIII.3 separate writer, own allowlist, no shared client | PASS. New contract file, new fetch layer, separate registry map and deps. |
| X.5 / X.11 state-changing checks, lazy write scope, tests | PASS. Planned tests: read adapters cannot write, writer refuses an unlisted endpoint, cross-origin POST refused. |
| I evidence before opinion | PASS. No AI claims are added. Posted text is the reviewer's own. |
| IV explainability | PASS. Capability reasons are shown as stated. No new classification. |
| V.3 stale evidence marked | PASS. A decision made on an earlier commit is shown as such (`stale`, FR-008). |
| VI incremental integration | PASS. Reuses the existing provider and registry shape. |
| IX repository safety | PASS. No git access is added. |
| X.7 / X.8 credentials | PASS. Write scope goes through the credential store only. Test: T041. |
| XI test-first, recorded fixtures | PASS. Writer contract suite over recorded fixtures. GitLab may use the disposable instance (XI.4, XI.5). |

Re-checked after design: no violations against 3.0.0. One doc follow-up: ADR 0003 is still "Proposed" and `README.md` / `MVP/MVP.md` 1.3 still say the product never writes. Update them in the final phase.

## Project Structure

```text
src/contracts/
  source-control-writer.ts      NEW  SourceControlWriter, neutral anchor, WriteOutcome
  source-control.ts             +listComments, +myDecision, +reviewCapability
  shared.ts                     +error codes forbidden, conflict, rejected, rate_limited
  http.ts                       +review-action request/response types
src/adapters/
  write-http.ts                 NEW  allowlist fetch, method+body, no redirects
  registry.ts                   +SOURCE_WRITER map, writerDeps()
  {github,gitlab,bitbucket}/source-control-writer.ts   NEW
  {github,gitlab,bitbucket}/source-control.ts          +comment and decision reads
src/core/review-actions.ts      NEW  post, head check, request id, lock, reconcile, eligibility
src/store/schema.sql, review-store.ts   +write_record
src/server/routes/review-actions.ts     NEW  post, comments, decision
src/ui/
  components/comment-box.tsx, comment-thread.tsx, decision-panel.tsx  NEW
  screens/diff.tsx, overview.tsx  edited
  api.ts, labels.ts, state/       edited
test/{contract,unit,integration,ui}/   writer suite, write-http, review-actions, UI
```

**Structure Decision**: mirror the read side exactly (contract, per-platform adapter, registry entry) and keep the head check, lock and request-id logic in `src/core`, so adapters stay thin and those rules are tested once.

## How it fits together

The UI posts `{action, expectedHead, requestId}` to `/review-actions`. Core checks eligibility, takes the per-PR lock, re-reads the head through the provider and refuses with `conflict` if it differs from `expectedHead`. It writes a `pending` record, calls the writer, and writes a `posted` or `failed` record. A repeated `requestId` returns the earlier result and posts nothing. After an ambiguous failure (timeout) core reads comments or the decision back before it allows another attempt, so nothing posts twice (FR-016). The UI keeps the typed text in the open box on any failure.
