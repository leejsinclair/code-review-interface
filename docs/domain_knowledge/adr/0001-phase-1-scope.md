# 0001. Phase 1 delivers context, questioning, risk and changed-line coverage

**Status**: Accepted (2026-11-07)

**Context.** `MVP/MVP.md` set Phase 1 (the MVP) as FR-1 to FR-8 over 6 to 8 weeks. Phase 1 exists to test the concept with the smallest set of useful features, judged by what a technical lead needs: is this PR safe and well-evidenced enough to merge?

**Decision.** Phase 1 delivers FR-1 (PR context and repository safety), FR-2 (summary and interrogation), FR-3 (risk classification) and core changed-line coverage (FR-5.1, 5.2, 5.4, 5.5). FR-4, FR-5.3, FR-5.6, FR-6, FR-7 and FR-8 move to Phase 2.

**Rationale.** These features answer both "where should I look" and "is that code tested", and support every measure of the MVP validation checkpoint except requirement gaps. SonarQube import adds integration cost for evidence a technical lead can already open directly. Traceability is blocked on open Jira-access and spec-discovery questions. Readiness and decisions only pay off once most evidence sources exist. The cut protects interrogation and the evidence foundation, as constitution rule Q.3 requires.

**Considered.** FR-1 to FR-3 only: fastest, but no objective test evidence. Adding a verification list for Critical items (a slice of FR-7.4): pulls append-only decision records forward.

**Consequences.** `MVP/MVP.md` is split into phase documents, and constitution rule Q.2 is amended to the new Phase 1 scope.
