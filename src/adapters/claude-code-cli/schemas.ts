// Output JSON schemas passed to the CLI as `--json-schema` (contracts/provider-contracts.md "AI
// output schemas", research R13). Core validates the result with its own hand-written guard
// (src/core/claims.ts); these only steer the CLI. Each embeds the claim schema in its `$defs`.

const CLAIM = {
  type: 'object',
  required: ['text', 'label', 'refs'],
  additionalProperties: false,
  properties: {
    text: { type: 'string' },
    label: { enum: ['evidence', 'inference'] },
    intent: { enum: ['documented', 'inferred'] },
    refs: {
      type: 'array',
      items: {
        oneOf: [
          {
            type: 'object',
            required: ['kind', 'path', 'side', 'startLine', 'endLine'],
            additionalProperties: false,
            properties: {
              kind: { const: 'code' },
              path: { type: 'string' },
              side: { enum: ['head', 'base'] },
              startLine: { type: 'integer', minimum: 1 },
              endLine: { type: 'integer', minimum: 1 },
            },
          },
          {
            type: 'object',
            required: ['kind', 'platform', 'key'],
            additionalProperties: false,
            properties: {
              kind: { const: 'issue' },
              platform: { type: 'string' },
              key: { type: 'string' },
            },
          },
          {
            type: 'object',
            required: ['kind'],
            additionalProperties: false,
            properties: { kind: { const: 'pr' } },
          },
        ],
      },
    },
  },
} as const;

const CLAIMS = { type: 'array', items: { $ref: '#/$defs/claim' } } as const;

export const ANSWER_SCHEMA = {
  type: 'object',
  required: ['claims', 'unsupportedAssumptions', 'suggestedFollowUps'],
  additionalProperties: false,
  properties: {
    claims: CLAIMS,
    unsupportedAssumptions: { type: 'array', items: { type: 'string' } },
    suggestedFollowUps: { type: 'array', items: { type: 'string' } },
  },
  $defs: { claim: CLAIM },
} as const;

export const SUMMARY_SCHEMA = {
  type: 'object',
  required: ['prSummary', 'files', 'functionalImpact', 'technicalImpact'],
  additionalProperties: false,
  properties: {
    prSummary: CLAIMS,
    files: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'claims'],
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          claims: CLAIMS,
        },
      },
    },
    functionalImpact: CLAIMS,
    technicalImpact: CLAIMS,
  },
  $defs: { claim: CLAIM },
} as const;

/**
 * The risk assessment (feature 004): per file, a class the model proposes (never `low`: the workbench takes
 * only a raise), its reasons, and the changed lines it cites. The title is how the fake CLI tells the run apart.
 */
export const RISK_SCHEMA = {
  title: 'riskAssessment',
  type: 'object',
  required: ['files'],
  additionalProperties: false,
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'class', 'reasons', 'lines'],
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          class: { enum: ['normal', 'elevated', 'critical'] },
          reasons: { type: 'array', items: { type: 'string' } },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              required: ['side', 'startLine', 'endLine'],
              additionalProperties: false,
              properties: {
                side: { enum: ['head', 'base'] },
                startLine: { type: 'integer', minimum: 1 },
                endLine: { type: 'integer', minimum: 1 },
              },
            },
          },
        },
      },
    },
  },
} as const;

// feature 006 (contracts/ai-output.md): the spec-alignment run. The title is how the fake CLI tells the run apart.
// The model never sets a label; the server stamps every statement Inference.
const ALIGNMENT_CITATION = {
  type: 'object',
  required: ['type'],
  additionalProperties: false,
  properties: {
    type: { enum: ['spec', 'tdd', 'code'] },
    documentId: { type: 'string' },
    path: { type: 'string' },
    side: { enum: ['head', 'base'] },
    startLine: { type: 'integer', minimum: 1 },
    endLine: { type: 'integer', minimum: 1 },
    quote: { type: 'string' },
  },
} as const;

const ALIGNMENT_STATEMENT = {
  type: 'object',
  required: ['text', 'citations'],
  additionalProperties: false,
  properties: {
    text: { type: 'string' },
    citations: { type: 'array', items: ALIGNMENT_CITATION },
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
        specification: ALIGNMENT_STATEMENT,
        tddEvidence: ALIGNMENT_STATEMENT,
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
          reason: ALIGNMENT_STATEMENT,
        },
      },
    },
    verdict: {
      type: 'object',
      required: ['outcome', 'statement', 'uncovered', 'mismatched'],
      additionalProperties: false,
      properties: {
        outcome: { enum: ['sufficient', 'incomplete', 'cannot-judge'] },
        statement: ALIGNMENT_STATEMENT,
        uncovered: { type: 'array', items: { type: 'string' } },
        mismatched: { type: 'array', items: ALIGNMENT_STATEMENT },
        notJudged: { type: 'string' },
      },
    },
    deviations: {
      type: 'object',
      required: ['implementedNotRequested', 'requestedNotImplemented'],
      additionalProperties: false,
      properties: {
        implementedNotRequested: { type: 'array', items: ALIGNMENT_STATEMENT },
        requestedNotImplemented: { type: 'array', items: ALIGNMENT_STATEMENT },
      },
    },
    leftOut: { type: 'array', items: { type: 'string' } },
  },
} as const;
