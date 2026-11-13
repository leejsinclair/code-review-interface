# Contract: the rule file

Location: `<appDataDir>/risk-rules.json` (the directory `src/appdata.ts` resolves). Read on every
classification. Edited outside the app. A missing file is normal.

```jsonc
{
  "version": 1,
  "entries": [
    // extend a built-in: add patterns, optionally raise (never lower) its class
    { "extend": "R-FINANCE", "paths": ["billing/**", "**/invoicing/**"], "lineTerms": ["ledger"], "class": "critical" },
    // add a rule with a new ID
    { "add": "X-PII", "family": "authorisation", "class": "elevated", "label": "Personal data handling",
      "paths": ["**/customer/**"], "lineTerms": ["ssn", "date_of_birth"] }
  ]
}
```

## Rules for entries

| Field | Rule |
|---|---|
| `extend` | an existing built-in ID from `R-AUTH`, `R-AUTHZ`, `R-DELETE`, `R-FINANCE`, `R-MIGRATION`, `R-CONFIG`. Not a mechanical ID. |
| `add` | `X-` then 1 to 30 of `A-Z`, `0-9`, `-`; unique within the file; never a built-in ID |
| `family` | required for `add`: `authentication`, `authorisation`, `deletion`, `financial`, `migration`, `configuration` |
| `class` | `elevated` or `critical` for `add` (must be at least Elevated); for `extend`, equal to or higher than the built-in's class. Lower is **rejected** (FR-035, IV.2) |
| `label` | optional text, 1 to 80 characters, shown as the reason text; shown as text only |
| `paths` | up to 100 globs of at most 200 characters; `*` within a segment, `**` across segments, `?`; case-insensitive; matched against the new path and, for renames, the old path |
| `lineTerms` | up to 100 strings of 2 to 100 characters; case-insensitive; matched against behavioural changed lines only |
| unknown field | the whole entry is rejected |

## Outcome

- Valid entry: applied, with its rule ID (`extend` keeps the built-in's ID, so the reason shows `R-FINANCE`).
- Rejected entry: skipped, listed in `ruleset.notice` as `{ entry: "<index>: <id or '(no id)'>", reason }`.
- Not JSON, not an object, `version` not 1, or `entries` not an array: the whole file is ignored,
  `ruleFile: 'ignored'`, built-ins apply, notice carries the reason.
- The ruleset version is `builtin-<N>` plus, when any entry was accepted, `+<12 hex of sha256 of the accepted
  entries, canonicalised>`. The snapshot's `risk_ruleset` row records it (FR-037).
- Mechanical rules (`R-LOCKFILE`, `R-GENERATED`, `R-COMMENT-ONLY`, `R-RENAME-ONLY`) cannot be extended or
  removed by the file: the file can only add scrutiny.
