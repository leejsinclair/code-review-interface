# Wireframe approval: 003-ui-redesign

**Status**: Approved
**Approver**: product owner (Lee Sinclair)
**Date approved**: 2026-11-09

Plan does not start until Status reads **Approved** (FR-003, SC-009). Any change requested below is folded into `../ui-redesign.spec.md` first.

## How to review

Open `index.html` in a browser. Pick a screen on the left; it shows at 1440, 1000 and 400 pixels wide. Switch Light / Dark to check both themes. Red numbers are the keyboard focus order; yellow notes explain behaviour; green **[NEW]** tags mark new capabilities. Turn notes off to see the screen alone.

## Coverage (FR-001, FR-002, FR-004)

| Screen or state | File | Seen |
|---|---|---|
| Home as the PR dashboard across repositories, one repository failing | `home.html` | [ ] |
| Overview | `overview.html` | [ ] |
| Files/Diff with a selection and the Ask panel open, keyboard path | `diff.html` | [ ] |
| Questions with the Evidence panel open, focus return | `questions.html` | [ ] |
| Code full page with a range | `code.html` | [ ] |
| Description | `description.html` | [ ] |
| Issue | `issue.html` | [ ] |
| Setup: hosted platform (GitHub), base folder, repositories found | `setup-github.html` | [ ] |
| Setup: self-hosted platform, with base-folder and address errors | `setup-selfhosted.html` | [ ] |
| Setup: issue tracker with declared fields, connection checklist | `setup-tracker.html` | [ ] |
| Setup: Bitbucket Cloud with Jira Cloud, repositories found, checklist waiting on sign-ins | `setup-bitbucket.html` | [ ] |
| Sign-in | `signin.html` | [ ] |
| Sign-in: Bitbucket Cloud and Jira Cloud, rejected token | `signin-bitbucket.html` | [ ] |
| Delete confirmation dialog | `delete-dialog.html` | [ ] |
| State gallery: loading, empty, failed, stale, live updates paused, AI provider unavailable, read-only PR, older head, discovery in progress, no repositories found, repository no longer found | `states.html` | [ ] |

## Proposals in the wireframes that the spec does not pin

Approve, change or reject each. Rejected or changed items are folded into the spec before plan.

1. **Page heading.** The PR title sits in the review header; each page's single `h1` names the page (Overview, the file path, Questions, Description). **→ Approved.**
2. **Review focus region.** Shown as an empty region with a visible "Review focus" heading. Alternative: reserve the space with no visible heading until a lens exists. **→ Changed: show the "Review focus" heading with the line "Not available yet."** Folded into FR-027 and `overview.html`.
3. **Ask button in the shell.** "Ask about this PR" sits in the review navigation on every tab except Files, where the scope bar's "Ask about selection" replaces it. **→ Approved.**
4. **Sources tab.** Lands on Description, with a sub-navigation listing every linked issue, including missing ones. **→ Approved.**
5. **Diff keyboard model.** The diff is one Tab stop (roving focus); ↑/↓ move within a side, ←/→ switch old/new side. **→ Approved.**
6. **Narrow file navigation.** Below 900 pixels the file list is reached through "All changed files" on Overview; there is no drawer. **→ Changed: add "‹ Previous file" and "Next file ›" beside "All changed files" above the diff.** Folded into FR-024 and `diff.html`.
7. **Code "Back" link.** Uses browser history; a cold deep link falls back to Overview. **→ Approved.**
8. **Sign-in return.** The originating page travels as a return parameter; only the app's own routes are accepted. **→ Approved.**
9. **Disabled Ask.** Uses `aria-disabled` so it stays focusable and its reason can be reached by keyboard. **→ Approved.**
10. **Home "Resume review" in both lists.** A PR with a session appears under "Your review sessions" and again under "Open pull requests" with Resume review. **→ Approved.**
11. **Checks that cannot run yet.** The connection checklist shows "? not checked yet" with what the check waits for (for example a sign-in), never ✓. **→ Approved.**
12. **Separate Atlassian sign-ins.** Bitbucket Cloud and Jira Cloud each get their own email and API token form and their own state, even though both use an Atlassian account. **→ Approved.**
13. **Back to dashboard.** Every review page has "‹ Back to dashboard" above the PR title, and the meta line names the repository. **→ Approved.**
14. **Skipped repositories in Setup only.** The dashboard shows a count with a link to Setup; the reasons are listed in Setup. **→ Approved.**
15. **Duplicates shown once.** A repository cloned in two folders is listed once, using the first folder found; the other is listed as a duplicate. **→ Changed: use the clone nearest the base folder, ties broken alphabetically by path, so the choice is stable between scans.** Folded into FR-051 and the Setup pages.
16. **Fork clones.** A clone whose remotes name two repositories on the platform (your fork and the original) lists both; the fork usually has no open PRs. **→ Approved.**
17. **Dashboard order.** Open PRs from every repository in one list, most recently updated first, with a repository column, rather than grouped by repository. **→ Approved.**
18. **Old sessions without a folder.** A session whose repository has left the base folder stays on the dashboard as "Open (read only)". **→ Approved.**

## Decision

- [ ] Approved as drawn
- [x] Approved with the changes below
- [ ] Changes needed before approval

Changes requested:

Also show bitbucket connection mockups.
→ Added `setup-bitbucket.html` and `signin-bitbucket.html`; spec Story 1 lists them.

Base folder with a dashboard of PRs across nested repositories (requested in chat).
→ Folded in: spec Story 12 and FR-048 to FR-058; dashboard on `home.html`; base folder and "Repositories found" on the Setup pages; "Back to dashboard" on every review page; discovery states in the gallery. Proposals 13 to 18.
