# 0003. Reviewer actions on the platform, and the workbench features brought forward

**Status**: Proposed (2026-11-10). Becomes Accepted when the constitution amendment 2.0.0 is reviewed.

**Context.** The same team built a VS Code extension for Bitbucket reviews (`vscode-extension-bbreview`) with a different approach: it helps a reviewer *work through* a pull request, not only understand it. It orders files by risk, tracks which files are reviewed, runs AI review passes that produce findings, finds the specification, manages the reviewer's queue, shows SonarQube results and posts comments and decisions. Much of its logic is plain TypeScript, so it can be ported. Constitution 1.2.0 stops that in two places: II.1 and VIII.3 forbid every platform write, and Q.2 holds Phase 1 to FR-1 to FR-3 and FR-5.

**Decision.**

1. **Reviewer actions are allowed, narrowly (II.1, II.4, VIII.3, X.11, XI.5).** The product may post and reply to comments, edit or delete its own comments, approve, request changes, and withdraw. It still never merges, declines, or changes code, branches or issues. Every write is started by a person, sent by one deliberate click on a control that names the action, never chosen or batched by AI, tied to the head commit the reviewer viewed (refused if it moved), and recorded append-only. Amended by constitution 3.0.0: the separate preview step was dropped. Writes go only through a new `SourceControlWriter` contract with its own allowlist. Read adapters stay read-only and share no write-capable client with it.
2. **The reviewer's own approval may be shown (II.2).** It is read from the platform and labelled as theirs. It is not the product's readiness verdict, which is still never shown as approved.
3. **The queue may be ordered by pull request attributes (VII.1).** Age, size, risk class and whether the reviewer was asked are allowed, with visible reasons. "Time waiting on a person" is not, so the extension's waiting-time priority factor is dropped.
4. **Scope grows by named features (Q.2).** Seven features, in this order:
   - 004 risk-based review focus (FR-3, already Phase 1)
   - 005 review progress
   - 006 AI review passes and finding triage
   - 007 specification context and traceability (FR-4.1 to 4.5)
   - 008 reviewer workload on Home
   - 009 SonarQube evidence (FR-6)
   - 010 reviewer actions on the platform.

**Rationale.** The extension's features match requirements the MVP already names (FR-3, FR-4, FR-6, FR-7), so the extension is a head start, not a new direction. The one real conflict is writing, and it is the part a reviewer most needs: a review ends in a comment or a decision. Keeping that in a separate, allowlisted, confirmed, human-started path preserves what II.1 protected, which is that the product does not act on its own.

**Considered.**
- *Stay read-only:* drafts are stored locally and the reviewer copies them to the platform. No constitution change, but the last step of every review leaves the tool.
- *Skip writes entirely:* the smallest change, but it drops the extension's comment, suggestion and decision features.
- *Port the extension's numeric risk score:* rejected. MVP section 7.1 rules out a composite score, so the same rules set the four classes instead.
- *Port cross-repo impact and the SonarQube scanner run:* rejected. VI.1 and MVP section 8.2 rule out a dependency-graph engine and running other tools. Impact stays in Phase 3.

**Consequences.**
- Constitution 2.0.0 (MAJOR) adds II.4, X.11 and XI.5 and rewrites II.1, VIII.3 and the others named above.
- Each feature gets its own spec, plan and tasks. 010 cannot start until this ADR is accepted.
- Credentials gain a write scope that is asked for only when the reviewer first uses a write action.
- `README.md` and `MVP/MVP.md` section 1.3 now describe the reviewer actions (feature 005 built them).
- Not carried over: the VS Code views and bindings, the numeric score, cross-repo impact, the scanner run, and the integrations tree (Setup already has a connection checklist).

**Write scopes (feature 005).** Asked for only on the first write action. A credential records `scope: 'write'` when the reviewer signs in with it; without that, a write is refused with `forbidden` and a prompt to sign in again. The scopes below come from each platform's documentation and are **not yet verified** against a live platform: the recorded fixtures under `test/fixtures/*/review-actions/` are hand-authored from the API docs, not recorded.

| Platform | Scope needed |
|---|---|
| GitHub | Fine-grained token with Pull requests: read and write, or a classic token with `repo` (`public_repo` for public repositories) |
| GitLab | `api` (`read_api` cannot write notes or approve) |
| Bitbucket Cloud | `write:pullrequest:bitbucket` with `read:pullrequest:bitbucket`, or an app password with Pull requests: Write |

Known platform gaps, shown as a disabled action with its reason and never as a platform branch in core: GitLab has no request-changes through its REST API in this build; Bitbucket inline comments carry one line, not a range.
