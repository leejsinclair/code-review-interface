# Quickstart: validating Risk-Based Review Focus

Run from the repository root. Node 24 or later. No new setup beyond the existing project.

## 1. Automated checks

```bash
npm run typecheck
npm test                                   # unit, contract, integration, end-to-end (fixtures, fake AI provider)
npm run test:ui                            # Playwright UI tests incl. accessibility sweep (needs `npm run build:ui`)
node --test test/unit/risk-*.test.ts       # the risk classifier and rule-file units on their own
```

Expected: all pass. The risk tests use the recorded fixtures under `test/fixtures/` and the fake provider
in `test/fixtures/fake-claude/`; none needs the network. `npm run test:gitlab` (optional, local GitLab) runs
the shared source-control suite, which now includes `currentUser`.

## 2. Reference pull request (US1, US2, SC-001, SC-002, SC-010)

Fixture `test/fixtures/risk/risk-reference.json` (added by this feature; kept out of `test/fixtures/github/` because the recorded-fetch replayer reads every file there as a recorded request) describes one PR whose files are: a
database migration, an authentication file with a behavioural change, an authentication file with only a
comment edit, a lockfile, a generated file, a README, an ordinary source file, and a rename.

1. Start the workbench with the fixture transport (the end-to-end harness does this), open the session.
2. Overview, Review focus: the migration is Critical (`R-MIGRATION`), the authentication file is Critical
   (`R-AUTH`), the comment-only edit is listed as Mechanical (candidate for reduced review) with
   `R-COMMENT-ONLY` and the reason says `R-AUTH` was not applied, the lockfile and generated file are
   Mechanical, the README is Normal, the rename is Low with `R-RENAME-ONLY`.
3. Open the first Critical file from Review focus: the Files view shows the responsible lines marked, each with
   an accessible name naming the rule.

## 3. AI raise-only (US4, SC-004)

With the fake provider scripted to (a) raise a Normal file with a cited line, (b) lower a Critical file,
(c) raise a file with no resolvable line: after the run, (a) is Elevated with origin AI and the rule class
still shown, (b) and (c) keep their rule class and show an ignored opinion with the reason. Make the
provider unavailable: rule classes show and Review focus says the AI assessment is missing and why.

## 4. Overrides (US5, SC-007)

1. Override the README from Normal to Elevated with a reason: the effective class changes, the original shows.
2. Try to lower the migration to Normal with no reason: refused naming the reason. With a reason: the dialog
   shows the signed-in account; save stores it. With the platform account unreadable (fixture returns 401):
   refused, "Sign in to the platform again", no record written.
3. Refresh with a new head that leaves the README unchanged: the override still applies. Refresh again with a
   change to the README: the override shows as lapsed with its recorded reason.
4. Delete the session: its overrides are gone with it. Confirm no other path removes a record (the append-only
   store test).

## 5. Rule file (US6)

Create `<appDataDir>/risk-rules.json` as in `contracts/rule-file.md` with one valid `extend`, one `add`, and
one entry that lowers a built-in class. Refresh: the valid entries apply, the lowering entry is named in
Review focus as ignored, the snapshot's ruleset version changes. Make the file invalid JSON: built-ins apply
and Review focus names the ignored file.

## 6. Manual checks (not automated)

See the Manual verification table in `plan.md`: reading order with a screen reader, and the visual
legibility of badges and marks with colour removed on a real display.
