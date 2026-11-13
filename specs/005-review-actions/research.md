# Research: Review Actions

## R1. Writer shape and HTTP layer
**Decision**: New `SourceControlWriter` interface in `src/contracts/source-control-writer.ts`, a separate `write-http.ts` fetch layer with an explicit method plus endpoint-pattern allowlist per platform, and its own registry map and deps.
**Rationale**: VIII.3 and X.11 forbid a shared write-capable client. `read-only-http.ts` forces GET and stays untouched, so its refusal tests remain valid.
**Alternatives**: Loosening `createReadOnlyFetch` (breaks VIII.3). One generic writer client (no per-platform allowlist).

## R2. One click, with a head-commit check
**Decision**: One POST per action carrying `expectedHead` and `requestId`. The server re-reads the head and refuses with `conflict` if it moved. No preview, token or confirmation step. The user chose this over the preview and confirm design, and constitution II.4 and X.11 were amended (3.0.0).
**Rationale**: `expectedHead` keeps an approval from landing on code the reviewer did not see, at the cost of one comparison. The button names the action and destination.
**Alternatives**: Preview and confirm with a single-use token (the earlier design, dropped by the user). Posting against whatever head is current (approves unseen code).

## R3. No double post
**Decision**: Platforms offer no idempotency key. Use the client `requestId` (a repeat returns the earlier result), a per-PR in-flight lock, and a read-back check after ambiguous failures before another attempt.
**Rationale**: A POST timeout is ambiguous. Only a read can tell whether it landed.
**Alternatives**: Client `busy` flag only. Blind retry.

## R4. Reading comments and decisions
**Decision**: Add `listComments` and `myDecision` to `SourceControlProvider` (still read-only). Tool-posted comments are identified by platform comment ids stored in `write_record`, matched with the signed-in user.
**Rationale**: Nothing reads comments today, and the platform has no "posted by this tool" marker. Matching author plus stored id avoids tagging comment text.
**Alternatives**: Hidden marker in comment text (visible to others, editable by them). Treat all own-author comments as editable (breaks FR-011).

## R5. Neutral error codes
**Decision**: Add `forbidden`, `conflict`, `rejected`, `rate_limited` to `AdapterErrorCode`, carrying the platform message.
**Rationale**: FR-016 needs the reason. Today 409, 422 and 429 all collapse to `unavailable`. Existing tests that enumerate codes are updated.

## R6. Platform differences (FR-020)
**Decision**: Writers expose `reviewCapability(repo, pr)` returning per-action `{allowed, reason}`. An action a platform cannot do (for example request changes on a GitLab version without it, or withdraw of a request on a platform that cannot) is disabled with a stated reason. Anchor is neutral `{path, side: 'base'|'head', startLine, endLine, commit}`; adapters translate to GitHub `line`/`side`, GitLab `position`, Bitbucket `inline`.
**Rationale**: "Same behaviour" holds where the platform can do it, and is explicit where not, with no platform branching outside adapters (VIII.2).

## R7. Eligibility
**Decision**: Server-computed `canReview {allowed, reason}`, the same shape as `canOverride`: PR open, not author, account has access. Platform refusal is the fallback and maps to `forbidden`.

## R8. No drafts
**Decision**: Nothing is stored for later. Typed text stays in the open box while the page is open, and on any failure.
**Rationale**: The user removed drafts. This drops FR-017, the `review_draft` table and the sign-in-redirect persistence. A sign-in expiry shows a prompt and the text stays in the box, but a page reload loses it.

## R9. Credentials and scope
**Decision**: Request write scope only on first write action, through the existing credential flow. Document the scopes per platform in `contracts/`. A missing scope maps to `forbidden` with a sign-in prompt, and the text stays in the box.

## R10. Out of scope
The `plan-blocks.py` helper failed (its template parts are missing), so no calls, code, states or screens blocks were added. The prose above and the contracts carry the same content.
