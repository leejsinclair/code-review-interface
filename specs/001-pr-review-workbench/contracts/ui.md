# Contract: Browser UI

The Preact UI (`src/ui/`) is a single page served at `/`, using hash routes so the server needs no fallback route. It talks only to the API in [http-api.md](http-api.md). Every piece of PR, issue, code and AI text is rendered as a text node, never as HTML (R7). Manual checks in the Verification Plan and any later UI tests address elements by the `data-testid` values below.

## Routes

| Route | Screen | Wireframe |
|---|---|---|
| `#/setup` | Configure repository, clone path, issue tracker and limits (FR-039). Shown first when `GET /api/config` returns `null` | |
| `#/signin` | One sign-in form per configured platform (FR-040); shown when any API call returns `signin_required` | |
| `#/` | Open PRs of the configured repository (FR-001) and existing review sessions with PR status (FR-041) | W1 |
| `#/sessions/:sessionId` | Review session overview: completeness, summaries, changed files (plan screen `overview`) | W2 |
| `#/sessions/:sessionId/diff?path=<path>` | One changed file's diff for the latest snapshot, with range selection (FR-033, FR-034) | W3 |
| `#/sessions/:sessionId/code?snapshot=<snapshotId>&side=head\|base&path=<path>&line=<n>` | A file at the snapshot's head or base commit, scrolled to the cited line (FR-035) | |
| `#/sessions/:sessionId/issues/:platform/:key` | An issue's stored title and plain-text description | |
| `#/sessions/:sessionId/description` | The PR description, the target of a `pr` ref | |
| `#/sessions/:sessionId/ask` | Interrogation panel for the current scope (plan screen `interrogation`) | W4 |

## Display labels

Stored values map to display labels exactly as the spec's Verbatim Constraints pin them:

| Stored | Display |
|---|---|
| `evidence`, `inference` | `Evidence`, `Inference` |
| `what`, `why`, `how`, `whatif`, `risk`, `requirement` | `What`, `Why`, `How`, `What-if`, `Risk`, `Requirements` |
| `found`, `missing`, `stale` | `found`, `missing`, `stale` |
| `technical`, `business` | `Technical`, `Business`, under the label `Answer for:` |
| `documented`, `inferred` | `Documented intent`, `Inferred intent` (grouped apart, FR-017) |

The missing-Jira reason is displayed as `no Jira access configured`.

## Test identifiers

| `data-testid` | Element |
|---|---|
| `pr-list`, `pr-item-<number>` | open PR list and one PR in it |
| `session-list`, `session-item-<sessionId>`, `session-status` | session list, one session, its PR status (`open`, `closed`, `merged`) |
| `refresh-button` | Refresh; absent on a read-only session, which shows `read-only-notice` instead |
| `close-session-button`, `delete-session-button`, `delete-session-confirm` | close, delete, confirm delete |
| `context-version` | context version chip (session header, every answer, every summary) |
| `completeness-row-pr`, `completeness-row-repository`, `completeness-row-issue` | completeness rows; each has `data-status` = `found`, `missing` or `stale` |
| `completeness-issue-<platform>-<key>` | one issue under the issue row, with `data-status` and its reason text |
| `skipped-file-<path>` | a file left out of prompts, with `data-reason` = the skip reason |
| `pr-summary`, `file-summary-<path>`, `functional-impact`, `technical-impact` | summary sections |
| `changed-file-<path>` | changed file row; opens the diff |
| `diff-line-head-<n>`, `diff-line-base-<n>` | selectable diff line on the new or old side |
| `scope-indicator` | current scope (`pr`, `file` or `range` with path, side, lines and label) |
| `scope-label-input` | optional range label ("method" name) |
| `category-<what\|why\|how\|whatif\|risk\|requirement>` | category choice |
| `answer-for-technical`, `answer-for-business` | "Answer for" choice; Technical selected by default |
| `suggested-question` | each fixed suggested question |
| `question-input`, `ask-button` | question text and Ask |
| `question-<questionId>` | one question, with `data-state` = `queued`, `in_progress`, `completed` or `cancelled` and `data-head-commit` |
| `older-snapshot-marker` | marks a question or summary produced for an earlier snapshot, showing its head commit (FR-051) |
| `cancel-question-<questionId>` | cancel a queued or running question |
| `answer-raw-text` | streamed text, marked in progress and not yet checked |
| `claim` | one claim, with `data-label` = `evidence` or `inference` and, when present, `data-intent` = `documented` or `inferred` |
| `claim-ref` | one reference, with `data-kind` = `code`, `issue` or `pr`; opens its target |
| `answer-warning` | `unstructured` or `cancelled` warning |
| `unsupported-assumptions`, `suggested-follow-up` | assumptions list; each follow-up (starts a new question with the same scope and `followsQuestionId`) |
| `answer-provenance` | provider id, time, context version |
| `restrictions-not-enforced` | names each FR-022 restriction not enforced; absent when all are enforced |
| `provider-unavailable` | reason interrogation and summaries are unavailable |
| `signin-form-<platform>` | sign-in form; the Bitbucket Cloud form offers email and API token only |
