# Guide findings checklist (T086)

Each finding in `ui-guide.md` section 4 is tied to the check that resolves it. All browser tests are in `test/ui/` and run with `npm run test:ui`.

| # | Finding | Resolved by |
|---|---|---|
| 1 | Diff rows indistinguishable | `diff.ui.ts` (marks, `data-type`, `aria-selected`); `sweep.ui.ts` (axe) |
| 2 | Range selection click-only | `diff.ui.ts` (Enter, Shift+Arrow, Escape, live region); `journey.ui.ts` (keyboard only) |
| 3 | Badges render neutral | `references.ui.ts` (badge text and `data-label`); `ui-badge` unit test; `sweep.ui.ts` (contrast in both themes) |
| 4 | Code view marks one line | `references.ui.ts` (six lines for 45 to 50, link carries start and end, long lines, range past the end) |
| 5 | Unlabelled form | `ask.ui.ts` (label, fieldsets, `aria-describedby`, `role="alert"`) |
| 6 | No review navigation | `shell.ui.ts` (header, nav, context strip, Ask about this PR); `panels.ui.ts` |
| 7 | State lost on navigation | `shell.ui.ts` (header survives tab changes); `journey.ui.ts` (draft, choice and scope survive reload and back) |
| 8 | Overview buries files | `overview.ui.ts` (order, explanations on request) |
| 9 | Swallowed errors | `states.ui.ts` (loading, failed with Retry, dropped stream banner and Reconnect); `ask.ui.ts`; `home.ui.ts` |
| 10 | Delete confirmation | `session-actions.ui.ts` (Escape and Cancel delete nothing, confirm deletes and goes Home) |
| 11 | Setup shows wrong fields and units | `setup.ui.ts` (descriptor-driven fields, KB and lines, checklist, empty-folder result) |
| 12 | Home rows | `home.ui.ts` (Start and Resume, filters, empty states, one h1) |
| 13 | No skip link or identity | `shell.ui.ts` (skip link, workspace identity, connection state, settings menu) |

Section 3 strengths, and where each still appears:

| Strength | Where |
|---|---|
| Evidence and Inference labels, downgrade | `claims.tsx`; `references.ui.ts` (an unverifiable citation is labelled inference) |
| Documented and inferred intent grouped | `claims.tsx` (`INTENT_ORDER`) |
| Unresolved references and skipped files with reasons | `claims.tsx` (unresolved badge); `diff.tsx` (`skipped-file-*`); `diff.ui.ts` |
| Questions tied to a head commit, older-head marker | `ask.tsx` (older-head badge) |
| Base and head sides distinguished | `code.tsx`; `diff.tsx` (old and new line labels) |
| Read-only notice, Refresh | `review-shell.tsx`; `shell.ui.ts` (closed and merged are read-only) |
| All PR and AI text as text nodes | `ui-safety.test.ts`; `panels.ui.ts` (markup shown literally) |
| Provider-unavailable warning, cancel, follow-ups | `ask-composer.tsx`; `ask.ui.ts` |

## Copy review (SC-007, FR-016)

Done by the implementing agent on 2026-11-10, reading every string in `src/ui/labels.ts` and the string literals in `src/ui/screens/` and `src/ui/components/`. A person should repeat it before release.

- Searched for ready, safe, approve, good, merge, correct, sound, passes. The only hits are code identifiers and the word "complete" for a finished answer or scan, never a verdict on the pull request.
- Completeness rows say `found`, `missing` or `stale`. They describe whether context could be fetched, not whether the change is acceptable. The Overview heading names them context, not checks.
- "Review focus: Not available yet." makes no claim.
- Evidence and Inference describe how well a statement is backed by cited code, not whether the code is right.
- Badges for PR status say open, closed or merged, which is the platform's state.
- Nothing implies approval, a pass, or that review can stop.
