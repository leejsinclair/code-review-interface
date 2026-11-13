# Contract: UI additions

Builds on `specs/003-ui-redesign/contracts/interfaces.md` (shell, states, `AsyncRegion`, announcer, view
state). New or changed surfaces only. Test ids follow the existing `data-testid` convention.

## Verbatim labels (`src/ui/labels.ts`)

`RISK_LABELS`: class words `Low`, `Normal`, `Elevated`, `Critical`; `Mechanical (candidate for reduced review)`;
origin words `Rule` + ID, `AI`, `Reviewer override`; `Not fully analysed`; `Not assessed by AI: lockfile`,
`Not assessed by AI: generated file`; `AI assessment in progress`; `AI assessment missing`;
`AI opinion ignored`. `REVIEW_FOCUS = { heading: 'Review focus' }`; the body "Not available yet." is deleted.
The word "approved", and any approval icon or styling, appears on no risk surface (a unit test scans
`labels.ts` and the risk components' rendered text).

## Review focus (Overview, `review-focus.tsx`, `data-testid="review-focus"`)

Order, top to bottom, each part omitted when empty except where stated:
1. Counts line: `Critical n · Elevated n · Normal n · Low n` as text (always shown, even all zero).
2. Notices (FR-027): AI in progress / missing (with reason) / partly ignored (count); rule file ignored (names
   the entry and reason); overrides in effect (count). Each is a labelled status, not colour only.
3. **Critical** list, then **Elevated** list: each row has the badge, the file name linking to its diff
   (`#/sessions/:id/diff?path=…`, first marked line when the file has lines), the reasons as a short list with
   rule IDs, and an "Overridden" note with the original class when an override applies.
4. If none is Elevated or Critical: "No file is Elevated or Critical." with the counts still above.
5. **Mechanical (candidate for reduced review)** list: lockfile, generated, comment-only, rename-only, each
   with its kind and a link that opens the diff. Never described as approved.
6. **Not fully analysed** list with each reason. These never appear as Low.
7. No files at all: "No changed files." (not "no risk").
States use `AsyncRegion`: loading, failed (with Retry), stale (an older snapshot is being viewed). The list
region has `aria-live="polite"` only for the notice line; class changes are announced through the announcer.
SC-010: the first Critical row's link goes straight to its first responsible line (one action from the
Overview, two with the reviewer opening the Overview).

## File list (`file-list.tsx`)

- Each row gains a `risk-badge` (icon + class word, `aria-label` `Risk: Critical`), plus a disclosure
  "Why?" that expands the reasons in place (`file-risk-<path>`), reusing the existing explanation disclosure.
- Controls above the list: a text filter (existing), a class filter (checkbox group, `risk-filter`, one box per
  class, none checked = all), and a sort control (`file-order`: "Diff order" default, "Risk order").
- Count text "Showing n of m files" updates with the filters. Both filters apply together; each has its own
  clear (US3-AS5). An empty result keeps the existing empty state.
- Risk order: Critical, Elevated, Normal, Low; ties by path, ascending, case-insensitive (FR-029).
- Choice kept per tab in `SessionViewState` (`fileOrder`, `riskClasses`); never sent to the server (FR-032).

## Files view (`screens/diff.tsx`, `code-view.tsx`)

- File header shows the badge, the reasons (`risk-reasons`), the override state, and the **Override class**
  button (hidden with the reason shown when `canOverride.allowed` is false, or on an older snapshot).
- Each responsible line has a gutter cell with a glyph and `aria-label="Risk mark: R-AUTH: <reason>"`
  (`AI` in place of the ID for an AI mark). Separate from selection and range highlighting; both can be present.
  A path-only rule shows a note "Matched on the path; no changed lines" and no marks.
- `Next risk mark` / `Previous risk mark` buttons move focus through marked lines in order and announce
  "Risk mark 2 of 5: R-AUTH: <reason>"; at the ends they announce there is no further mark (US2-AS4).
- Previous / Next file links (`prev-file`, `next-file`) use `arrangeFiles` with the tab's order and filter.
  At either end the link is replaced by the text "No previous file" / "No further file" (no wrap, FR-030).
- Keyboard: all of the above are native buttons and links in the tab order; no new global shortcut.

## Override dialog (`override-dialog.tsx`)

- Opens from the button; focus moves to the first field, returns to the button on close; Escape closes.
- Fields: Class (select of the other three classes), Reason (required textarea, 2,000 max, counter).
- When the chosen class is below Critical and the file's `assessedClass` is Critical (so also an Elevated-to-Low step on such a file): the dialog calls `GET …/risk/reviewer` and shows
  "Recorded as: <displayName> (<handle>)", read only. If `ok: false`, shows the reason and fix, disables Save,
  and says other overrides remain possible (US5-AS2).
- Save is `POST …/risk/overrides`. Failure shows the server's message inside the dialog; success closes it and
  announces "Class changed from X to Y". History: a "History" disclosure lists all records for the file
  (`GET …/risk/overrides?path=`), oldest first, with reason, time, original class, and the reviewer where recorded.
- A lapsed override is shown in the file header: "Override lapsed: this file's change differs. Recorded reason:
  <text>." with the recalculated class in force.
- No count, total, ranking or chart of overrides or reviewers exists anywhere (FR-025, SC-009).

## Accessibility (SC-008)

Every state above is exercised in the existing axe sweep (`test/ui/sweep.ui.ts`) at wide, medium and narrow
widths, in light and dark themes. Badges and marks are legible with colour removed (a UI test renders with
forced-colors and with a greyscale filter and asserts the text, glyph and `aria-label` are present). Class
changes while the page is open go through `announcer.ts` (polite).
