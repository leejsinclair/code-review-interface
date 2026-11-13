# Contract: HTTP API additions

Same rules as the existing API (`src/contracts/http.ts`, `src/server/guard.ts`): loopback only, per-launch
token, `Host` and `Origin` checks, JSON bodies, `ErrorBody` for refusals, `GET` never changes state (X.5).
Types below are added to `src/contracts/http.ts`. Class names on the wire are lower case.

```ts
type RiskClass = 'low' | 'normal' | 'elevated' | 'critical';
type RiskOrigin = 'rule' | 'ai' | 'override' | 'default';
type LineRange = { side: 'head' | 'base'; startLine: number; endLine: number };

type RiskReason = {
  origin: 'rule' | 'ai' | 'default';
  ruleId?: string;               // present when origin is 'rule'; never for 'ai' or 'default'
  class: RiskClass;              // the class this reason alone sets
  applied: boolean;              // false: a sensitive rule that was not applied (comment-only)
  matchedOn: 'path' | 'lines' | 'path+lines' | 'ai';
  text: string;                  // plain text only
  lines: LineRange[];            // empty when matchedOn is 'path'
};

type OverrideRecord = {
  id: string; path: string; class: RiskClass; replacedClass: RiskClass; calculatedClass: RiskClass;
  reason: string; createdAt: string; snapshotId: string;
  reviewer?: { handle: string; displayName: string };   // present only when it took a Critical-calculated file below Critical
};

type RiskFile = {
  path: string;
  ruleClass: RiskClass;
  assessedClass: RiskClass;             // after a valid AI raise
  effectiveClass: RiskClass;            // after an override that applies
  effectiveOrigin: RiskOrigin;          // what produced effectiveClass
  mechanical: boolean;                  // candidate for reduced review (labelled by the UI; never "approved")
  mechanicalKind?: 'lockfile' | 'generated' | 'comment-only' | 'rename-only';
  notFullyAnalysed?: string;            // reason
  reasons: RiskReason[];                // rule reasons first, then the AI's applied reason, in display order
  ai: { state: 'applied' | 'not-higher' | 'no-resolvable-line' | 'unknown-file' | 'no-opinion' | 'not-assessed' | 'pending' | 'unavailable';
        notAssessedReason?: string;     // 'lockfile' | 'generated file' | 'binary' | ... when state is 'not-assessed'
        proposedClass?: RiskClass; reasons?: string[]; lines?: Array<LineRange & { resolved: boolean }> };
  override?: { record: OverrideRecord; applies: boolean };  // latest record; applies=false means lapsed
};

type RiskReport = {
  snapshotId: string; headCommit: string; revision: number;       // revision changes whenever any field below can
  ruleset: { version: string; ruleFile: 'absent' | 'used' | 'partly-ignored' | 'ignored'; notice: Array<{ entry: string; reason: string }> };
  ai: { state: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'none';
        provider?: string; contextVersion?: string; finishedAt?: string;
        reason?: string;                                              // why missing or failed
        ignoredCount: number;                                         // items with applied=false and a reason
        olderHead?: boolean };                                        // the run belongs to an older snapshot
  counts: Record<RiskClass, number> & { mechanical: number; notFullyAnalysed: number };  // counts, never a score
  files: RiskFile[];                                                  // in diff order
  canOverride: { allowed: boolean; reason?: string };                 // latest snapshot and session actionable
};
```

## `GET /api/sessions/:sessionId/snapshots/:snapshotId/risk` → `RiskReport`

- Every changed file of the snapshot appears exactly once with `effectiveClass` and at least one reason (FR-001).
- `404 not_found` for an unknown session or snapshot. Old snapshots are readable; `canOverride.allowed` is false
  for them (FR-024, US5-AS7).
- No files changed or all skipped: `files: []` and the counts are zero; the UI states that, and does not
  render it as "no risk" (edge case).
- No numeric score, percentage or rank field exists anywhere in the type (FR-002).

## `GET /api/sessions/:sessionId/risk/reviewer` → `{ ok: true; handle; displayName } | { ok: false; reason; fix }`

Calls `currentUser()` for the session's platform. Used by the override form to show who will be recorded.
`fix` is a short sentence ("Sign in to the platform again"). Not cached. Never a `500` for a platform error:
`ok: false` with the reason.

## `POST /api/sessions/:sessionId/risk/overrides`

Body: `{ snapshotId: string; path: string; class: RiskClass; reason: string }`. Extra fields (including any
`reviewer`) are refused with `400 unknown_field`.

| Condition | Result |
|---|---|
| `snapshotId` is not the session's latest, or the session is closed or read-only | `409 read_only`, message names the cause (FR-024) |
| `path` is not a changed file of that snapshot | `404 not_found` |
| `reason` empty after trim, or over 2,000 characters | `400 invalid_request`, message names `reason` (US5-AS2) |
| `class` equals the current effective class | `400 invalid_request` ("already <class>") |
| takes a file whose calculated class is **Critical** below Critical (including a later step such as Elevated to Low): server calls `currentUser()` | on success the record stores handle and name; on failure the existing codes: `409 signin_required` when the credential is missing or refused (message: "Sign in to the platform again"), `502 platform_error` when the platform is unreachable; **no record is written** (FR-020) |
| any other override | no platform call; record stored without reviewer |
| success | `201` with the `OverrideRecord`; publishes SSE `risk` |

The handler is the only writer of `class_override`. There is no `PUT`, `PATCH` or `DELETE` route (FR-021).

## `GET /api/sessions/:sessionId/risk/overrides?path=<path>` → `{ records: OverrideRecord[] }`

Full history of one file, oldest first (US5-AS4). `path` is required; there is no query without it, so there
is no listing by reviewer or across files (FR-025, FR-040).

## SSE event `risk`

`{ snapshotId: string; revision: number; changedPaths: string[]; cause: 'classified' | 'ai' | 'override' }`.
The client re-reads the report when `snapshotId` is the one it shows, and announces each path whose
`effectiveClass` changed (FR-033). It carries no class, so the stream never leaks data the `GET` guards.

## Security notes

- Every new route sits behind the existing guard; the POST also satisfies X.5.
- The rule file is read from the application data directory by the server; the browser never names a path.
- The `risk` reads never include file contents beyond the already-served `patch` line numbers.
