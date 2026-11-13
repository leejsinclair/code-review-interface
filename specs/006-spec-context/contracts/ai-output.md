# Contract: AI alignment output

A new output kind `alignment` is added to `AskOutput` in `src/contracts/ai-provider.ts`, with a new
`alignment` lane in `src/core/lanes.ts`. The schema is added to `src/adapters/claude-code-cli/schemas.ts`
as `ALIGNMENT_SCHEMA`. Its `title` is `specAlignment`, which is how the fake CLI tells the run apart.

One run per snapshot returns both summaries, one row per criterion, the verdict and the deviations (R6).

## Input

The prompt data block holds, each delimited as untrusted data (X.9, IX.3): the specification text and the
`tdd-evidence.md` text with line numbers, each with its `documentId`; the snapshot's changed lines; the
criteria are found by the AI from the specification. The documents are passed in the input, not read
through the AI's workspace. When `tdd-evidence.md` is missing the block says so and the run states which parts
cannot be judged. No run is made when the specification is missing.

## Schema

```ts
const CITATION = {
  type: 'object',
  required: ['type'],
  additionalProperties: false,
  properties: {
    type: { enum: ['spec', 'tdd', 'code'] },
    documentId: { type: 'string' },                       // for spec and tdd
    path: { type: 'string' },                             // for code
    side: { enum: ['head', 'base'] },                     // for code
    startLine: { type: 'integer', minimum: 1 },
    endLine: { type: 'integer', minimum: 1 },
    quote: { type: 'string' },                            // optional passage, for spec and tdd
  },
} as const;

const STATEMENT = {
  type: 'object',
  required: ['text', 'citations'],
  additionalProperties: false,
  properties: {
    text: { type: 'string' },
    citations: { type: 'array', items: CITATION },
  },
} as const;

export const ALIGNMENT_SCHEMA = {
  title: 'specAlignment',
  type: 'object',
  required: ['summaries', 'rows', 'verdict', 'deviations'],
  additionalProperties: false,
  properties: {
    summaries: {
      type: 'object',
      required: ['specification'],
      additionalProperties: false,
      properties: {
        specification: STATEMENT,
        tddEvidence: STATEMENT,                            // omitted when no evidence was given
      },
    },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        required: ['criterionId', 'criterion', 'state', 'test', 'testMismatch', 'reason'],
        additionalProperties: false,
        properties: {
          criterionId: { type: 'string' },
          criterion: { type: 'string' },
          state: { enum: ['Implementation and test identified', 'Implementation identified', 'Requires verification', 'Not found'] },
          test: { enum: ['test-shown', 'no-test-shown', 'no-evidence-available'] },
          testMismatch: { type: 'boolean' },
          reason: STATEMENT,
        },
      },
    },
    verdict: {
      type: 'object',
      required: ['outcome', 'statement', 'uncovered', 'mismatched'],
      additionalProperties: false,
      properties: {
        outcome: { enum: ['sufficient', 'incomplete', 'cannot-judge'] },
        statement: STATEMENT,
        uncovered: { type: 'array', items: { type: 'string' } },   // criterionIds
        mismatched: { type: 'array', items: STATEMENT },
        notJudged: { type: 'string' },
      },
    },
    deviations: {
      type: 'object',
      required: ['implementedNotRequested', 'requestedNotImplemented'],
      additionalProperties: false,
      properties: {
        implementedNotRequested: { type: 'array', items: STATEMENT },
        requestedNotImplemented: { type: 'array', items: STATEMENT },
      },
    },
    leftOut: { type: 'array', items: { type: 'string' } },       // parts left out for size
  },
} as const;
```

The model never sets a label. The server stamps every statement `Inferred` (FR-014).

## Server checks (`src/core/spec-alignment.ts`, pure)

1. **Citations.** `spec` and `tdd` citations are resolved by `documentId` and line range, or by `quote`, against
   the stored text. `code` citations are resolved against the snapshot's changed lines, as claim code is.
   A statement with no resolvable citation is kept with `citationStatus: 'unverified'` and shown as a
   lower-confidence Inference. It is not dropped (R7, V.1).
2. **State and test.** A row whose `state` is `Implementation and test identified` but whose `test` is not
   `test-shown`, or whose `testMismatch` is true, is downgraded to `Requires verification`. A row with
   `test: 'no-test-shown'` while no evidence document exists is changed to `no-evidence-available`.
3. **Verdict.** `uncovered` must list exactly the rows with `no-test-shown`; the server recomputes it and
   ignores the model's list when they differ. `outcome` is forced to `cannot-judge` when no evidence exists.
   No coverage figure or percentage is accepted or computed (FR-015).
4. **Unknown ids.** Rows with an unknown `documentId` are kept with unresolved citations. Duplicate
   `criterionId` values are kept in order and flagged.
5. **Unparseable output.** Becomes one Inference with `warning: 'unparseable-output'` through `textAsInference`
   (I.3). The documents and their stored text remain; the run shows a failure notice and can be retried.
6. **Size.** `leftOut` is the union of what the prompt builder cut and what the model reports.
7. **Text.** All strings are plain text. The UI never renders them as HTML.
