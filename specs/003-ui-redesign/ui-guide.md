# PR Review Workbench — User Interface Guide

Status: session document (not yet in the repository). Scope: entire application, prioritised by core
workflows. Direction: preserve existing features; any new capability is labelled **[NEW]**.

## 1. Product purpose

Help people understand a pull request and verify the evidence behind every statement, **without
modifying the repository or the source-control / issue-tracking platform**. Trust and provenance are
the product: every screen must make it obvious what is evidence, what is inference, and what is missing.

## 2. Users

One shared review workflow serves all three users. **No role switcher in the first redesign**; keep the
existing **Answer for: Technical / Business** choice in Ask.

| User | Primary question | Needs from the UI |
|---|---|---|
| Developer | What changed and how does this code behave? | Fast file navigation, readable diff, precise keyboard-accessible range selection, explanations with code evidence. |
| Technical lead | What needs investigation, and what evidence is missing? | Current head/snapshot, context gaps (missing/stale/skipped), technical impact, clear provenance. Must never read "all context found" as "safe to merge". |
| Business analyst | Does behaviour match documented intent? | Linked issue + PR description, whole-PR Ask without entering a diff, Business answers, assumptions and documented-vs-inferred intent. |

## 3. Current interface (as reviewed)

Routes (hash router, [src/ui/app.tsx](/home/lee/projects/code-review-interface/src/ui/app.tsx)):
`#/` Home · `#/setup` · `#/signin` · `#/sessions/:id` Overview (+ summaries) · `/diff?path=` ·
`/code?snapshot&side&path&line` · `/issues/:platform/:key` · `/description` · `/ask?type&path&side&start&end&label`.

Strengths to preserve:
- Explicit **Evidence / Inference** claim labels, including "proposed as …" downgrade note.
- Documented intent grouped separately from inferred intent.
- Unresolved references with reasons; skipped files with reasons.
- Questions persisted per session, tied to a head commit, with "answered for an earlier head commit" marker.
- Code references distinguish base vs head side.
- Read-only notice for closed/merged PRs; Refresh shows "(new commits)".
- All PR/AI text rendered as text nodes (no HTML injection) — keep this invariant.
- Provider-unavailable warning, cancellable queued/running questions, follow-ups.

## 4. Prioritised critique

P0 = trust/accessibility defect; P1 = core workflow; P2 = polish.

| # | Pri | Finding (verified in source) | Correction |
|---|---|---|---|
| 1 | P0 | Diff rows render `class="diff-add|diff-remove|diff-context [selected]"` ([diff.tsx](/home/lee/projects/code-review-interface/src/ui/screens/diff.tsx)) but CSS targets `.diff-line[data-type]` and `[aria-selected="true"]` ([app.css](/home/lee/projects/code-review-interface/src/ui/app.css)). Additions, removals and the selection are visually indistinguishable. | Single source of truth: `class="diff-line" data-type="add" aria-selected`. Add `+`/`−` gutter glyphs and a left selection bar so meaning is not colour-only. |
| 2 | P0 | Range selection is click-only on `<tr>`; not keyboard operable, no focus indicator. | Line-number cells become `<button>`s (or a grid with roving tabindex). Enter/Space = anchor/extend, Shift+Arrow extends, Esc clears. Announce the scope via `aria-live`. |
| 3 | P0 | Claim badges render `class="chip chip-evidence"`; CSS styles `.chip[data-label=…]`. Context-status chips have no `data-status` (it is on the `<li>`). Badges appear neutral. ([claims.tsx](/home/lee/projects/code-review-interface/src/ui/components/claims.tsx), [overview.tsx](/home/lee/projects/code-review-interface/src/ui/screens/overview.tsx)) | One `<Badge kind=… value=…>` component that emits the attributes the CSS expects; text label always present; AA contrast in light and dark. |
| 4 | P0 | Code view highlights only `line === startLine`; a 45–50 citation marks one line ([code.tsx](/home/lee/projects/code-review-interface/src/ui/screens/code.tsx), `refHref` drops `endLine`). Code cells have no `white-space: pre`. | Pass `start`/`end` in the route; highlight full range; preserve whitespace; horizontal scroll inside the code region, not the page. |
| 5 | P0 | Question `<textarea>` has no label; radio groups have no `<fieldset>/<legend>`; errors not associated ([ask.tsx](/home/lee/projects/code-review-interface/src/ui/screens/ask.tsx)). | Visible "Your question" label, fieldsets with legends "Category" and "Answer for", `aria-describedby` for errors, `role="alert"` on submit failure. |
| 6 | P1 | No persistent review navigation: Diff/Ask/Code/Issue/Description pages lose PR identity; Overview has no "Ask about this PR" action; only Code has a back link. | Persistent review shell (see §5). |
| 7 | P1 | `<main key={hash}>` remounts every screen on navigation: drafts, Answer-for choice, scroll and selected scope are lost (e.g. Business resets to Technical after viewing evidence). | Lift session-scoped UI state (draft, category, answer-for, selected scope, scroll per route) into a session store above routes. |
| 8 | P1 | Overview renders all per-file summaries before Changed files; long PRs bury file navigation. | Overview = PR summary + context + file list; per-file explanation disclosed on demand / in the file view. |
| 9 | P1 | Errors swallowed: `listSessions().catch(() => undefined)`, `getProvider` failure ignored, suggestions failure becomes empty; SSE disconnect not shown. | Distinguish loading / empty / failed / unknown / stale for every async region; inline retry; "Live updates paused — Reconnect" banner. |
| 10 | P1 | Delete confirmation replaces the button with another identically styled button; no Cancel; Close and Delete have equal prominence. | Session actions in an overflow/secondary group; Delete opens a confirmation dialog with explicit consequences, Cancel (default focus) and a `danger` confirm. |
| 11 | P1 | Setup shows tracker site/project keys regardless of platform; limits are raw bytes/lines/chars; "Continue" doesn't explain connection prerequisites ([setup.tsx](/home/lee/projects/code-review-interface/src/ui/screens/setup.tsx)). | Progressive fields per platform, human units (KB, lines), "Advanced limits" disclosure, connection checklist (repo reachable, clone path valid, signed in) after save. |
| 12 | P2 | Home: PR rows are full-width buttons with no Start vs Resume distinction; "session" chip ambiguous; no empty states; header misuses `class="page-header"` on an `<h1>` ([home.tsx](/home/lee/projects/code-review-interface/src/ui/screens/home.tsx)). | Table/list with explicit "Start review" / "Resume" action, empty states with guidance, client-side filter of loaded items. |
| 13 | P2 | No skip link; global header shows Setup/Sign-in as primary nav but no repository identity or connection state. | App header: product link, repo identity, connection status, settings menu, skip-to-content. |

Not verified: narrow-viewport behaviour (only 1800×1250 dark mode observed) and real AI answer quality
(fake AI used). The next session must verify both.

## 5. Information architecture

### 5.1 App header (all pages)
Skip link · Product name → Home · Repository identity (platform + repo id) · Connection status
(signed in / sign-in required / provider unavailable) · Settings menu (Setup, Sign-in).

### 5.2 Review shell (all `#/sessions/:id/*` routes)
- **Review header** (sticky): `#number title`, author, `source → target`, PR status badge, current head
  short SHA + snapshot time, Refresh / "New commits — Refresh", read-only notice, secondary
  session-actions menu (Close, Delete).
- **Review navigation** (tabs, `aria-current`): Overview · Files · Questions (count, running indicator) ·
  Sources (Description, Issues).
- **Context strip**: compact completeness summary (e.g. "Description ✓ · 2 issues ✓ · 1 issue missing ·
  3 files skipped") linking to details. Wording must say "context available", never "ready" or "safe".
- **Ask affordance**: "Ask about this PR" always available; in Files it becomes "Ask about selection".

### 5.3 Layout
- ≥1200px: three regions — file list (left, collapsible), main (diff/overview), contextual panel (right)
  for Ask and Evidence.
- 900–1199px: file list collapses to a drawer; contextual panel overlays.
- <900px: single column; contextual panels become full pages (existing routes remain the full-page
  alternatives, so deep links keep working).

### 5.4 Contextual panels (agreed approach)
- **Ask panel**: opens beside the diff with the current scope pre-filled; full page at `/ask`.
- **Evidence panel (superseded)**: removed. Clicking a claim reference now opens the Files view with the
  cited range selected and scrolled into view, or the code page when the diff cannot show it (spec FR-019,
  FR-021). Issue and description references open their full pages.

## 6. Screen specifications

### Home (`#/`)
Two sections: **Your review sessions** (first when any exist) and **Open pull requests**.
Each PR row: number, title, author, branches, updated time, action `Start review` or `Resume review`.
States: loading skeleton; empty ("No open pull requests in <repo>"); failed with Retry; per-row starting
spinner (disable only that row). Filter box over loaded items. [NEW: filter]

### Overview (`#/sessions/:id`)
Order: PR summary (short, labelled claims) → Context completeness (expandable rows with reasons) →
Changed files (status, +/−, skipped reason) → Referenced PRs. Per-file summaries move to the file view
or a disclosure per row. Primary action: **Ask about this PR**.

### Files / Diff (`/diff?path=`)
File list with status icons and filter; diff with sticky hunk headers, old/new line numbers, `+/−`
glyphs, wrap toggle; selection model per §4 #2; scope bar showing "Selected: path lines a–b (new side)"
with label input, Clear, and **Ask about selection**. Binary/no-change/skipped states explicit.

### Ask / Questions (`/ask`)
Composer: scope chip (changeable to "whole PR"), Category fieldset, **Answer for: Technical / Business**
fieldset (default Technical, persisted per session), suggested questions as chips, labelled textarea,
Ask button (disabled reason shown), provider-unavailable warning blocking with explanation.
Thread list newest first; each item: category + audience badges, scope, state (queued / running with
live text / answered / failed / cancelled), older-head marker, claims grouped (documented intent,
inferred intent, other), assumptions, follow-ups, provenance (context version, restrictions not enforced).
Filter by state/audience. [NEW: filter]

### Code (`/code`)
Header: path, side (Head/Base) badge, commit; full range highlight; preserved whitespace; "Back to
<origin>" using history, not a fixed Overview link; commit-missing reason shown as a state, not an error.

### Description / Issue
Rendered as plain text with headings preserved where safe; source badge (platform, key, fetched time);
status if missing/stale.

### Setup (`#/setup`)
Sections: Source control (platform, repo id, clone path, base URL only for self-hosted) · Issue tracker
(fields shown only for the chosen platform) · Advanced limits (collapsed, human units, defaults shown).
Server validation errors mapped to fields (`aria-invalid`, `aria-describedby`) plus a summary at top.
After save: connection checklist with next step. Re-check current providers (GitLab work is in progress
in the working tree) before finalising field lists.

### Sign-in (`#/signin`)
Explain why sign-in is needed, which platform, what access is read-only; return to the originating route
after success.

## 7. Design system

- **Tokens** already exist in `app.css` (light + `prefers-color-scheme: dark`); keep and extend: spacing
  scale (4/8/12/16/24/32), radius, focus ring (`2px` outline, ≥3:1 contrast), z-layers.
- **Semantic badges**: Evidence, Inference, Documented intent, Inferred intent, Found, Missing, Stale,
  Skipped, Unresolved, Older head, Read-only, PR status. Always icon/text + colour.
- **Components**: AppHeader, ReviewShell, ReviewHeader, ReviewTabs, ContextStrip, FileList, DiffView,
  ScopeBar, AskComposer, QuestionThread, ClaimList, RefLink, EvidencePanel, CodeView, AsyncRegion
  (loading/empty/error/stale), ConfirmDialog, FormField, Notice/Banner, Badge.
- **Typography**: monospace only for code, paths, SHAs; `white-space: pre` in code cells.
- **Language**: plain English; "Evidence" = cited from the PR/issue/code; "Inference" = AI reasoning
  without a direct citation. Never imply approval/merge readiness.

## 8. Accessibility (WCAG 2.2 AA)
Skip link; landmarks (`header`, `nav`, `main`, `aside`); one `h1` per page; every control labelled;
keyboard parity for diff selection and panels; focus moved to panel heading on open and restored on
close; `aria-live="polite"` for streaming answers and scope changes (throttled); no colour-only meaning;
reduced-motion respected; target size ≥24px.

## 9. Safety invariants (must not regress)
- Read-only: no UI action writes to the repo or platforms.
- All untrusted text rendered as text nodes; no `dangerouslySetInnerHTML`, no markdown-to-HTML without
  sanitisation.
- Evidence/Inference labels and unresolved reasons always visible.
- Answers tied to their head commit; older-head marker visible.

## 10. Future capabilities (capability-gated; do not build in first redesign)
Specs mention risk, coverage, readiness and role lenses. Reserve space in the Overview (a "Review focus"
region) and keep them behind explicit capability flags. **[NEW]** items must be labelled as such in the
wireframes.
