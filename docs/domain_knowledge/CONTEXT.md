# PR Review Workbench: Domain Context

The canonical terms of the PR Review Workbench. Specs, plans and code use these words with these meanings.

## Canonical terms

### Delivery

- **Phase 1**: the minimum viable product (MVP), the first delivery that tests the concept. "MVP" and "Phase 1" name the same scope.
- **Phase 2**: everything planned after Phase 1 has been validated.

### Review records

- **Review session**: the review of one pull request in one repository; the record that every other record of that review belongs to. _Avoid_: review (alone), PR session.
- **PR snapshot**: the fixed state of a pull request at one head commit. _Avoid_: version, revision.
- **Base commit**: the merge-base of a snapshot's target branch and head commit; lines the PR removed are read from it.
- **Session close**: the end of a review session's active use, by an explicit user action or by server shutdown. The session record is kept; only its isolated workspace is removed. _Avoid_: delete, end session.
- **Isolated workspace**: a read-only copy of the code, owned by the workbench, in which all analysis runs; never the reviewer's working copy. _Avoid_: private copy, sandbox.
- **Context completeness**: the list of context sources for a review session, each found, missing or stale.
- **Evidence**: a fact taken from a tool or platform (issue, coverage report, static-analysis result, specification), tied to the commit it describes. The PR and repository rows of context completeness are derived from the session, not Evidence. _Avoid_: data, input.
- **Assessment**: an output of the rules or the AI that interprets evidence. Every assessment cites evidence.
- **Finding**: an assessment that asks for a reviewer's attention, with its origin (rule, AI or tool) and the evidence it rests on. _Avoid_: issue (that word means an issue-tracker item), problem.
- **Disposition**: a reviewer's recorded decision on a finding: acknowledge, verify, dismiss or override. Append-only. _Avoid_: resolution, approval.

### Interrogation

- **Interrogation**: asking the AI a question about a scope of the PR (whole PR, file or line range) and getting an answer made of claims. A "method" scope is a line range with an optional label. _Avoid_: questioning, chat, Q&A.
- **Claim**: one assertion in an answer or summary, labelled **Evidence** (supported by at least one resolvable reference) or **Inference** (AI reasoning). _Avoid_: statement.
- **Resolvable reference**: a file path that exists in the snapshot's head commit (or its base commit, for a removed line) with every cited line inside the file, or an issue key fetched for the review session. _Avoid_: link, citation.
- **Context version**: the snapshot's head commit plus a fingerprint of the context sent to the AI provider; recorded and shown with every answer. _Avoid_: context v1/v2 counter, prompt version.
- **Unsupported assumption**: something an answer relies on that neither the code nor the documented intent supports; shown apart from the claims.
- **Documented intent**: what the PR description or linked issue says the change is for. Contrasted with **inferred intent**, which the AI deduces from the code.

### Risk and readiness

- **Risk class**: one of Low, Normal, Elevated or Critical, given to a changed file or range with its reasons and responsible lines. _Avoid_: risk score, severity.
- **Mandatory-scrutiny rule**: a fixed rule that sets a floor on a risk class before AI assessment; AI may raise the class, never lower it.
- **Readiness**: the derived recommendation on whether the evidence supports human approval; never set by a user and never an approval. _Avoid_: status, approval.
- **Lens**: a role-oriented view (Developer, Technical lead, BA) over the same data; not a permission. _Avoid_: role, persona.

## Domain boundaries

- The workbench observes platforms and never acts on them: it does not approve, merge, comment or change anything.
- Evidence, assessment and disposition are separate records and are never merged.
- The AI provider takes no configuration, hooks or instructions from the repository content under review; that content is input to analyse, never instruction.

## Related documents

- [MVP specification](../../MVP/MVP.md): the product and technical specification the terms come from.
- [Decision records](adr/): architecture and scope decisions, starting with [0001 Phase 1 scope](adr/0001-phase-1-scope.md).
