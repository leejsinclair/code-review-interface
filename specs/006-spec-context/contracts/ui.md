# Contract: UI additions

Builds on `specs/003-ui-redesign/contracts/interfaces.md` and `specs/004-risk-review-focus/contracts/ui.md`
(shell, states, `AsyncRegion`, announcer, view state). New or changed surfaces only. Test ids follow the
existing `data-testid` convention.

## Verbatim labels (`src/ui/labels.ts`)

`SPEC_LABELS`:

- Heading `Specification`. Completeness rows `Specification` and `TDD evidence`.
- Implementation states: `Implementation and test identified`, `Implementation identified`,
  `Requires verification`, `Not found`.
- Label on every assessment statement: `Inferred`. The word `Verified` appears on no spec-context surface.
- Test column: `Test shown`, `No test shown`, `No evidence available`.
- Verdict outcomes: `Testing looks sufficient`, `Testing looks incomplete`, `Testing cannot be judged`.
- Verdict lists: `Criteria with no test shown`, `Tests that may not test the right thing`.
- Deviation lists: `Implemented but not requested`, `Requested but not implemented`;
  empty text `No deviations were found.`
- Citation status: `Source not found in the stored text` (for `unverified`).
- Gaps: `No specification was found`, `No key was found to search with`,
  `This repository is not inside a known project repository; only its own repository was searched`,
  `Could not read the specification source`.
- Staleness: `Stale`, with the reason beside it.
- Controls: `Read in full` (opens a document), `Retry assessment`.

The "Changed files" heading and its body are deleted from the overview. The words "approved" and "verified"
appear in no spec-context text (a unit test scans `labels.ts` and the component's rendered text).

## Specification panel (Overview, `spec-context.tsx`, `data-testid="spec-context"`)

Replaces the "Changed files" section. The file list is not shown on the overview; the Diff screen keeps it.
Order, top to bottom, each part omitted when empty except where stated. With several keys, parts 2 to 5 repeat
under a heading per key (`spec-key-<KEY>`).

1. Notices (`spec-notices`): gaps from `SpecContextReport.gaps`, a stale notice with its reason, an
   assessment failure with Retry. Each is a labelled status, not colour only.
2. Source (`spec-source-specification`, `spec-source-tdd`): repository, branch, commit and folder of each
   document, the rule used (`spec-rule`), and a note naming other copies (for example "develop also has a
   copy"). Several folders match: all are listed (`spec-other-copy`).
3. Summaries (`spec-summary-specification`, `spec-summary-tdd`): each labelled `Inferred`, with a
   `Read in full` button (`spec-open-specification`, `spec-open-tdd`). A missing document shows its gap text
   in place of the summary.
4. Verdict (`spec-verdict`, `data-outcome` set to the outcome), with the two lists
   (`spec-uncovered`, `spec-mismatched`).
5. Criteria table (`spec-rows`), one `spec-row` per criterion (`data-criterion-id`, `data-state`,
   `data-test`, `data-mismatch`): columns Criterion, Implementation, Test, Source. Each row is labelled
   `Inferred`. A flagged row (uncovered or mismatched) also shows a text flag, not colour only.
6. Deviations (`spec-deviations`): the two lists (`spec-dev-unrequested`, `spec-dev-unimplemented`).
   `No deviations were found.` when both are empty.
7. Left out (`spec-left-out`): parts left out for size, when any.

Citations (`spec-citation`) are buttons. A `spec` or `tdd` citation opens the document viewer scrolled to the
cited lines. A `code` citation links to the diff at those lines (`#/sessions/:id/diff?path=...`). An
`unverified` citation shows `Source not found in the stored text` and does not link.

States use `AsyncRegion`: loading (`status: 'searching'`, or alignment `pending` or `running`), failed (with
`Retry assessment`, `spec-retry`), stale (`spec-stale`). No spec-context state blocks the rest of the
overview (FR-018, SC-007). The notice line has `aria-live="polite"`; completion and staleness go through the
announcer ("Specification assessment finished", "Specification documents are stale").

## Document viewer (`spec-document`)

A read-only dialog or region with the stored text in a `<pre>` (`spec-document-text`), line numbers, and the
source line (repository, branch, commit). Focus moves in on open and returns to the opener on close; Escape
closes. No edit control exists. Cited lines are marked (`spec-cited-lines`) and scrolled into view.

## Completeness list

Two rows added by `data-testid="completeness-specification"` and `completeness-tdd-evidence`, each showing
found, missing or stale with the reason (FR-009).

## Data-testid index

`spec-context`, `spec-notices`, `spec-key-<KEY>`, `spec-source-specification`, `spec-source-tdd`, `spec-rule`,
`spec-other-copy`, `spec-summary-specification`, `spec-summary-tdd`, `spec-open-specification`,
`spec-open-tdd`, `spec-verdict`, `spec-uncovered`, `spec-mismatched`, `spec-rows`, `spec-row`,
`spec-deviations`, `spec-dev-unrequested`, `spec-dev-unimplemented`, `spec-left-out`, `spec-citation`,
`spec-stale`, `spec-retry`, `spec-document`, `spec-document-text`, `spec-cited-lines`,
`completeness-specification`, `completeness-tdd-evidence`. The overview test for FR-007 asserts the
"Changed files" heading and its file list are absent.

## View state

Which document is open and the open key are kept per tab in `SessionViewState`, never sent to the server.

## Accessibility

Every state above is exercised in the existing axe sweep (`test/ui/sweep.ui.ts`) at wide, medium and narrow
widths, in light and dark themes. The table is a real `<table>` with header cells and scopes. State, flags
and the `Inferred` label are text, legible with colour removed.
