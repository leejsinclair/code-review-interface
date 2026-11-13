# Behaviour checklist: Risk-Based Review Focus

Items a reviewer or test author checks that the verification obligations in `plan.md` do not state
as behaviour in themselves. Each is verified by the obligation named, or by hand where noted.

- [x] Classifying the same snapshot twice gives identical classes, reasons and lines (VO-003). Verified by test/unit/risk-classify.test.ts (VO-003).
- [x] A comment-only edit in an authentication or migration file is Low, and the reason says which rule was not applied (VO-006). Verified by test/unit/risk-classify.test.ts (VO-006).
- [x] An unknown language never yields comment-only (VO-007). Verified by test/unit/risk-comments.test.ts, risk-classify.test.ts (VO-007).
- [x] A reindent of a Python or YAML file is behavioural; a reindent of a TypeScript file is whitespace-only (VO-008). Verified by test/unit/risk-comments.test.ts (VO-008).
- [x] A file whose rule class is Critical is never lowered by any AI result, including an uncited or equal one (VO-018, VO-019). Verified by test/unit/risk-assess.test.ts, test/integration/risk-service.test.ts, test/end-to-end/risk.test.ts (VO-018, VO-019).
- [x] A lockfile or generated file never appears in the AI prompt (VO-016). Verified by test/unit/prompt.test.ts, test/integration/risk-service.test.ts, test/end-to-end/risk.test.ts (VO-016).
- [x] No response, record or screen carries a numeric score, a percentage or a ranking by person (VO-031, VO-032). Verified by test/unit/risk-boundaries.test.ts, risk-effective.test.ts (VO-031, VO-032).
- [x] The word "approved" appears on no risk surface (VO-030). Verified by test/unit/risk-labels.test.ts (VO-030).
- [x] An override can be created, never edited or deleted, except by deleting its whole session (VO-024). Verified by test/integration/review-store.test.ts, test/end-to-end/risk.test.ts (VO-024).
- [x] A client cannot supply the reviewer name; lowering Critical (including a stepwise lowering) with an unreadable account writes nothing (VO-022, VO-023). Verified by test/end-to-end/risk.test.ts, test/integration/risk-service.test.ts (VO-022, VO-023).
- [x] An override lapses when the file's change differs and not when only the head commit differs (VO-025, VO-026). Verified by test/integration/risk-service.test.ts, test/ui/diff.ui.ts (VO-025, VO-026).
- [x] Marks in the diff and badges in the list carry text or an accessible name, with colour removed (VO-029, MV-001). Verified by test/ui/diff.ui.ts, test/ui/sweep.ui.ts forced-colors and greyscale (VO-029). MV-001 on a real display is still to do.
- [x] The class filter and order survive navigation in the same tab and are not sent to the server (VO-028). Verified by test/unit/ui-view-state.test.ts, test/ui/overview.ui.ts (VO-028).
- [x] Next and Previous follow risk order and stop at the ends (VO-027). Verified by test/unit/ui-file-order.test.ts, test/ui/diff.ui.ts (VO-027).
- [x] The rule file cannot lower a built-in class, and an invalid file leaves built-ins in force (VO-013, VO-014). Verified by test/unit/risk-ruleset.test.ts, test/integration/risk-service.test.ts (VO-013, VO-014).
- [x] The risk surfaces degrade, never block, when the AI provider is down, the rule file is bad or the platform is unreachable (VO-020, VO-014, VO-023). Verified by test/integration/risk-service.test.ts, test/end-to-end/risk.test.ts, test/ui/overview.ui.ts (VO-020, VO-014, VO-023).


## Verification record (T081 to T083)

Run on 2026-11-10 from the working tree, one test process at a time.

| Check | Result |
|---|---|
| `npm run typecheck`, `tsc -p tsconfig.build.json --noEmit` | clean |
| `npm test` (unit, contract, integration, end-to-end) | 524 tests, 520 pass, 4 skipped, 0 fail; includes `test/unit/platform-names.test.ts` and `test/unit/read-only-http.test.ts` |
| `npm run build:ui` then every `test/ui/*.ui.ts` file, `--test-concurrency=1` | all pass, including the axe sweep of the risk surfaces at three widths in both themes, and the forced-colors and greyscale renders |
| `npm run test:gitlab` | not run: needs the local GitLab (`gitlab:up`). The shared `currentUser` cases are in the suite and the GitLab target passes `expected.currentUser`, so the first run against it covers them |
| Quickstart sections 1 to 5 | covered by the tests named in each item above; no gap found |
| MV-001 (real display, light, dark, forced colours or greyscale) | **partly done**: the user reported the interface looks ok on a real display (themes and forced colours not named). Still open: needs a person with a display. Automated emulation of forced colours and a greyscale filter passes |
| MV-002 (screen reader through Review focus, risk marks, an AI class change) | **not done**: needs a person with a screen reader. The announcements are asserted through the live region in `test/ui/diff.ui.ts` and `test/ui/overview.ui.ts` |

Notes for whoever runs the manual checks: UI test processes share `dist/ui`; run them one at a time (a second
concurrent `build:ui` can leave a half-written bundle and a test hangs).
