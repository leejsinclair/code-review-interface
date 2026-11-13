# Contract: HTTP API additions

Same rules as the existing API (`src/contracts/http.ts`, `src/server/guard.ts`): loopback only, per-launch
token, `Host` and `Origin` checks, JSON bodies, `ErrorBody` for refusals, `GET` never changes state (X.5).
Types below are added to `src/contracts/http.ts`. Values on the wire are lower case or kebab case.

```ts
type SpecDocumentKind = 'specification' | 'tdd-evidence';
type SpecDocumentStatus = 'found' | 'missing' | 'stale';
type SpecRule = 'own-repository-first' | 'matching-branch-over-develop' | 'most-recent-commit' | 'only-candidate';

type SpecCopy = {
  repository: string;            // repository id or display name, as the workspace shows it
  branch: string;
  commit: string;
  folder: string;                // e.g. "specs/006-ENG-1213-data-request"
};

type SpecSource = {
  key: string;                   // the Jira key that matched, as written on the pull request
  used: SpecCopy;
  rule: SpecRule;                // the rule that chose `used`, shown by the panel
  others: SpecCopy[];            // other copies and other matching folders (for example a develop copy)
};

type SpecDocument = {
  documentId: string;
  kind: SpecDocumentKind;
  status: SpecDocumentStatus;
  fileName?: string;             // "tdd-evidence.md" or the file ending in "spec.md"; absent when missing
  otherSpecFiles: string[];      // more files ending in "spec.md" in the folder; the one used is `fileName`
  source?: SpecSource;           // absent when missing
  sha256?: string;
  reason?: string;               // present when status is 'missing' or 'stale'
};

type SpecKeyResult = {
  key: string;
  documents: SpecDocument[];     // one 'specification' and one 'tdd-evidence', in that order
};

type SpecLookupGap =
  | { kind: 'no-key'; message: string }                     // no Jira key on the pull request
  | { kind: 'no-enclosing-repository'; message: string }    // own repository only was searched
  | { kind: 'read-failed'; message: string };              // first git error line

type SpecState = 'inferred';     // the only label on assessment statements (FR-014); never 'verified'
type CitationStatus = 'resolved' | 'unverified';

type SpecCitation =
  | { type: 'spec' | 'tdd'; documentId: string; startLine: number; endLine: number; quote?: string }
  | { type: 'code'; path: string; side: 'head' | 'base'; startLine: number; endLine: number };

type SpecStatement = {
  label: 'Inferred';
  text: string;                  // plain text only
  citations: SpecCitation[];
  citationStatus: CitationStatus;  // 'unverified' when no citation could be resolved (FR-014)
};

type ImplementationState =
  | 'Implementation and test identified'
  | 'Implementation identified'
  | 'Requires verification'
  | 'Not found';

type TestEvidence = 'test-shown' | 'no-test-shown' | 'no-evidence-available';
// 'no-evidence-available' is used when tdd-evidence.md is missing, never 'no-test-shown' (US4-AS2)

type AlignmentRow = {
  criterionId: string;           // identifier from the specification, or its wording when it has none
  criterion: string;
  state: ImplementationState;
  test: TestEvidence;
  testMismatch: boolean;         // a test is named for it but does not exercise the behaviour
  statement: SpecStatement;      // the reason for state and test, with citations
};

type SufficiencyVerdict = {
  outcome: 'sufficient' | 'incomplete' | 'cannot-judge';
  statement: SpecStatement;
  uncovered: string[];           // criterionIds with no test shown
  mismatched: SpecStatement[];   // "tests that may not test the right thing"
  notJudged?: string;            // which parts cannot be judged when evidence is missing
};

type ScopeDeviations = {
  implementedNotRequested: SpecStatement[];   // citations are changed lines
  requestedNotImplemented: SpecStatement[];   // citations are specification passages
  noneFound: boolean;                         // true when both lists are empty; the UI says so
};

type SpecAlignment = {
  runId: string;
  state: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  provider?: string; contextVersion?: string; finishedAt?: string;
  headCommit: string;            // the pull request head it was made against
  stale: boolean;
  staleReason?: string;
  reason?: string;               // why failed or not run
  leftOut: string[];             // parts left out for size
  summaries?: { specification?: string; tddEvidence?: string };   // plain text, labelled Inferred
  rows: AlignmentRow[];          // criterion order as in the specification
  verdict?: SufficiencyVerdict;
  deviations?: ScopeDeviations;
  warning?: 'unparseable-output';   // output kept as one Inference (I.3)
};

type SpecContextReport = {
  snapshotId: string; headCommit: string; revision: number;   // revision changes whenever any field below can
  status: 'searching' | 'ready' | 'none' | 'failed';          // 'none': nothing found; the gaps explain why
  searched: Array<{ repository: string; branches: string[] }>; // where it looked, shown when nothing is found
  gaps: SpecLookupGap[];
  keys: SpecKeyResult[];         // grouped by key, as written on the pull request
  stale: boolean;
  staleReason?: string;          // moved document commit, newer matching branch, or older snapshot
  alignment?: SpecAlignment;     // latest run; absent when the specification is missing (FR-015)
  canRetry: { allowed: boolean; reason?: string };
};
```

`CompletenessRow` gains two members. Status and reason are derived on read from the latest lookup.

```ts
  | { source: 'specification'; status: CompletenessStatus; reason?: string }
  | { source: 'tdd-evidence'; status: CompletenessStatus; reason?: string }
```

## `GET /api/sessions/:sessionId/snapshots/:snapshotId/spec-context` returns `SpecContextReport`

- `404 not_found` for an unknown session or snapshot. Old snapshots are readable and are marked stale.
- Never `500` for a git or provider failure: the failure is a `gaps` entry or `alignment.state: 'failed'`
  (FR-018, SC-007).
- No coverage figure, score or percentage exists anywhere in the type (FR-015).
- `alignment` is absent when no specification document was found. When only `tdd-evidence` is missing, rows are
  still listed and every `test` is `no-evidence-available`.
- Several matching folders: all appear in `source.others`; `used` and `rule` name the one used (US4-AS6).

## `GET /api/sessions/:sessionId/snapshots/:snapshotId/spec-context/documents/:documentId` returns text

- `Content-Type: text/plain; charset=utf-8`, `X-Content-Type-Options: nosniff`. The stored text exactly as read,
  never rendered as HTML (FR-008).
- `404 not_found` for an unknown document, or one that does not belong to that snapshot's lookup.
- A `missing` document has no text, so it has no id to fetch.
- Citations open a line range of this text; the client slices it by `startLine` and `endLine`.

## `POST /api/sessions/:sessionId/snapshots/:snapshotId/spec-context/retry`

Body: `{}`. Extra fields are refused with `400 unknown_field`. Queues a new alignment run on the stored
documents, or a new lookup when none was stored. A new run adds a record and removes none (FR-016).

| Condition | Result |
|---|---|
| `snapshotId` is not the session's latest, or the session is closed or read-only | `409 read_only`, message names the cause |
| the latest run is `pending` or `running` | `409 conflict`, message "An assessment is already running" |
| no specification document is stored and no lookup is possible | `400 invalid_request`, message names the gap |
| success | `202` with `{ runId: string }`; publishes SSE `spec-context` |

## SSE event `spec-context`

`{ snapshotId: string; revision: number; cause: 'lookup' | 'documents' | 'alignment' | 'stale' }`.
The client re-reads the report when `snapshotId` is the one it shows. It carries no document text, so the
stream never leaks data the `GET` guards. Added to the event list of `GET /api/sessions/:sessionId/events`.

## Security notes

- Every new route sits behind the existing guard; the `POST` also satisfies X.5.
- The browser never names a repository, branch, path or ref. The server chooses them.
- Document text is Evidence: no route writes or edits it. Only the lookup and the alignment lane write.
