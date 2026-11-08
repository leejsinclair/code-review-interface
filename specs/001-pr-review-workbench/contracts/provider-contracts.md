# Contract: Provider interfaces

The three provider-neutral contracts in `src/contracts/` (constitution VIII.1). Core code depends only on these; platform knowledge lives only under `src/adapters/` (VIII.2). The contract suites in `test/contract/` run every adapter against recorded fixtures (XI.2). The names `SourceControlProvider`, `IssueTracker`, `AiProvider` and the id `claude-code-cli` are pinned by the spec's Verbatim Constraints.

| Contract | Adapters (registry id) |
|---|---|
| `SourceControlProvider` | `github` (development), `bitbucket-cloud` (target) |
| `IssueTracker` | `github-issues` (development), `jira-cloud` (target) |
| `AiProvider` | `claude-code-cli` |

## Shared

```ts
type PlatformId = 'github' | 'bitbucket-cloud' | 'github-issues' | 'jira-cloud';

// Supplied by src/credentials.ts. Adds the Authorization header to a request; the adapter never sees the secret (R6).
type Authorize = (request: Request) => Request;

// Every adapter HTTP call goes through src/adapters/read-only-http.ts, which throws on any method but GET (VIII.3, FR-027).
type ReadOnlyFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

type AdapterDeps = { fetch: ReadOnlyFetch; authorize: Authorize };     // fetch is injected so tests replay recorded fixtures

class AdapterError extends Error {
  code: 'unauthorized'      // 401 or 403: that platform's sign-in is marked expired (FR-040)
      | 'not_found'
      | 'unavailable'       // network failure or 5xx
      | 'truncated';        // pagination stopped at the page cap; reported as a gap
  platform: PlatformId;
}

type SignInCheck = { ok: true; account: string } | { ok: false; reason: string };
```

## `SourceControlProvider`

```ts
type RepoRef = { platform: PlatformId; id: string };                   // id: "owner/repo" or "workspace/repo"

type PrState = 'open' | 'closed' | 'merged';

type PullRequestInfo = {
  number: number; title: string; description: string; author: string;
  sourceBranch: string; targetBranch: string;
  headCommit: string; state: PrState; updatedAt: string;
};

type CommitInfo = { sha: string; message: string; author: string; authoredAt: string };

type ChangedFileInfo = {
  path: string; previousPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  linesAdded: number; linesRemoved: number; binary: boolean;
};

// Where the PR head can be fetched from (R10). GitHub: base repo + refs/pull/<n>/head. Bitbucket Cloud: fork clone URL + source branch.
type HeadLocation = { remoteUrls: string[]; ref: string };             // one URL per scheme (ssh, https); the manager picks the clone's scheme

interface SourceControlProvider {
  readonly id: PlatformId;
  verifySignIn(): Promise<SignInCheck>;                                // read-only call: GET /user, GET /2.0/user
  cloneLocations(repo: RepoRef): string[];                             // normalised host/path forms matched against the clone's remotes
  listOpenPullRequests(repo: RepoRef): Promise<PullRequestInfo[]>;     // FR-001
  getPullRequest(repo: RepoRef, number: number): Promise<PullRequestInfo>;  // FR-002, FR-052; a deleted PR rejects with not_found
  listCommits(repo: RepoRef, number: number): Promise<CommitInfo[]>;
  listChangedFiles(repo: RepoRef, number: number): Promise<ChangedFileInfo[]>;
  getUnifiedDiff(repo: RepoRef, number: number): Promise<string>;      // used only when the head is not fetched locally (FR-038)
  headLocation(repo: RepoRef, pr: PullRequestInfo): Promise<HeadLocation>;
  targetLocation(repo: RepoRef, pr: PullRequestInfo): Promise<HeadLocation>;
}
```

No method writes. There is no approve, decline, merge or comment method on any contract (FR-027).

## `IssueTracker`

Issue reference forms (verbatim): Jira keys, `#123`, `owner/repo#123`.

```ts
type IssueRefForm = 'jira-key' | '#123' | 'owner/repo#123';

type RawIssueReference = { platform: PlatformId; key: string; form: IssueRefForm };  // key normalised, e.g. "ABC-12", "owner/repo#123"

type IssueLookup =
  | { status: 'resolved'; kind: 'issue'; title: string; descriptionText: string }   // description already plain text (FR-004)
  | { status: 'resolved'; kind: 'pull-request' }                                      // `#123` that is a PR (FR-003)
  | { status: 'unresolved'; reason: string };                                         // e.g. `no Jira access configured`

interface IssueTracker {
  readonly id: PlatformId;
  verifySignIn(): Promise<SignInCheck>;                                // GET /user, GET /rest/api/3/myself
  extractReferences(text: string): RawIssueReference[];               // Jira: only configured project keys are accepted
                                                                       // without lookup; others need lookup to confirm
  lookup(ref: RawIssueReference): Promise<IssueLookup>;                // one GET per key; never throws for a missing issue
}
```

Core runs `extractReferences` over the branch name, PR title and description, merges by `(platform, key)` keeping every origin, then calls `lookup` (R15). When `jira-cloud` has no credential, `lookup` returns `{ status: 'unresolved', reason: 'no Jira access configured' }` without a network call.

## `AiProvider`

Adapted from the MVP's assumed shape (MVP 6.1). Differences, each required by the spec or research: the request carries a prompt already built by core (`instructions` and a delimited `data` block, R14) instead of `scope`, `category`, `question`, `context` and `history`, because FR-050 forbids session history and the context version must be computed in core; `capabilities()` reports each FR-022 restriction instead of one `readOnlyEnforced` flag; the provider returns raw structured output and core validates it (R13).

```ts
type RestrictionId =
  | 'workspace-read-search-tools-only'          // FR-022 (a)
  | 'no-reads-outside-workspace'                // FR-022 (b)
  | 'no-network-tools'                          // FR-022 (c)  unenforced: interrogation and summaries unavailable
  | 'no-repository-configuration'               // FR-022 (d)  unenforced: interrogation and summaries unavailable
  | 'untrusted-input-delimited';                // FR-022 (e)  enforced by core's delimited data block

type ProviderCapabilities = {
  installed: boolean;
  signedIn?: boolean;
  streaming: boolean;
  restrictionsEnforced: Record<RestrictionId, boolean>;
  unavailableReason?: string;
};

type AskRequest = {
  requestId: string;
  workspacePath: string;                        // the session's detached worktree, never the reviewer's tree
  instructions: string;                         // fixed workbench text, passed as system prompt
  data: string;                                 // `<<<PRWB-DATA nonce>>> ... <<<END nonce>>>`, passed on stdin
  output: 'answer' | 'summary';                 // selects the JSON schema below
};

type AskEvent =
  | { type: 'delta'; text: string }             // raw streamed text, not yet checked (FR-021)
  | { type: 'result'; output: unknown }         // structured output, validated by core (src/core/claims.ts)
  | { type: 'error'; code: 'not_installed' | 'not_signed_in' | 'failed' | 'cancelled'; message: string };

interface AiProvider {
  readonly id: 'claude-code-cli';
  capabilities(): Promise<ProviderCapabilities>;
  ask(req: AskRequest): AsyncIterable<AskEvent>;
  cancel(requestId: string): Promise<void>;
}
```

## AI output schemas (R13)

Passed to the provider as `--json-schema`. Core validates the result with a hand-written guard. The provider proposes `label` and `intent`; the workbench decides the final values.

### Claim

```json
{
  "type": "object",
  "required": ["text", "label", "refs"],
  "additionalProperties": false,
  "properties": {
    "text": { "type": "string" },
    "label": { "enum": ["evidence", "inference"] },
    "intent": { "enum": ["documented", "inferred"] },
    "refs": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "required": ["kind", "path", "side", "startLine", "endLine"],
            "additionalProperties": false,
            "properties": {
              "kind": { "const": "code" },
              "path": { "type": "string" },
              "side": { "enum": ["head", "base"] },
              "startLine": { "type": "integer", "minimum": 1 },
              "endLine": { "type": "integer", "minimum": 1 }
            }
          },
          {
            "type": "object",
            "required": ["kind", "platform", "key"],
            "additionalProperties": false,
            "properties": {
              "kind": { "const": "issue" },
              "platform": { "type": "string" },
              "key": { "type": "string" }
            }
          },
          {
            "type": "object",
            "required": ["kind"],
            "additionalProperties": false,
            "properties": { "kind": { "const": "pr" } }
          }
        ]
      }
    }
  }
}
```

### Answer (`output: 'answer'`)

```json
{
  "type": "object",
  "required": ["claims", "unsupportedAssumptions", "suggestedFollowUps"],
  "additionalProperties": false,
  "properties": {
    "claims": { "type": "array", "items": { "$ref": "#/$defs/claim" } },
    "unsupportedAssumptions": { "type": "array", "items": { "type": "string" } },
    "suggestedFollowUps": { "type": "array", "items": { "type": "string" } }
  }
}
```

### Summary (`output: 'summary'`)

```json
{
  "type": "object",
  "required": ["prSummary", "files", "functionalImpact", "technicalImpact"],
  "additionalProperties": false,
  "properties": {
    "prSummary": { "type": "array", "items": { "$ref": "#/$defs/claim" } },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["path", "claims"],
        "additionalProperties": false,
        "properties": {
          "path": { "type": "string" },
          "claims": { "type": "array", "items": { "$ref": "#/$defs/claim" } }
        }
      }
    },
    "functionalImpact": { "type": "array", "items": { "$ref": "#/$defs/claim" } },
    "technicalImpact": { "type": "array", "items": { "$ref": "#/$defs/claim" } }
  }
}
```

`#/$defs/claim` is the Claim schema above, embedded in each schema's `$defs`.

### Checking rules applied by core (`src/core/claims.ts`)

| Rule | Result |
|---|---|
| `code` ref: `cat-file -e <commit>:<path>` succeeds at the head commit (base commit for `side: "base"`) and `endLine` ≤ the file's line count | ref resolved |
| `issue` ref: `(platform, key)` was fetched for this session | ref resolved |
| `pr` ref: the session's PR has a non-empty description | ref resolved |
| `label: "evidence"` with no resolved ref | stored and shown as `inference`; reason recorded per ref (FR-018) |
| `intent: "documented"` with no resolved `issue` or `pr` ref | shown as `inferred` (FR-017) |
| output fails validation | one `inference` claim holding the raw text, warning `unstructured` (FR-019) |
| request cancelled, or interrupted by restart | the streamed text becomes one `inference` claim, warning `cancelled` (FR-045) |
