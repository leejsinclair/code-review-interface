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
