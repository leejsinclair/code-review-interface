# Testing approach: local, complete review examples

Use repeatable local examples first, then test the installed AI provider and
the browser separately. A passing HTTP test is not proof that the UI works,
and a fake AI response is not proof that a real model answers correctly.

## What is available today

| Layer | Local example | What it proves |
| --- | --- | --- |
| Unit | `test/unit/` | Parsing, limits, claims, configuration and other rules. |
| Adapter contracts | `test/contract/` and `test/fixtures/` | GitHub, Bitbucket Cloud, GitHub Issues and Jira recorded responses normalise to the application contracts. |
| Integration | `test/integration/` | Real Git repositories, worktrees, SQLite, recovery and AI child-process handling. |
| Complete application over HTTP | `test/end-to-end/full-app.test.ts` | The real composition root, server, store and Git work together, using recorded platform responses, an in-memory keyring and a fake AI CLI. |
| Real AI CLI | `test/live/live-cli.live.ts` | The installed Claude Code CLI respects restrictions and produces a grounded business answer. Platform responses and Git repositories still come from local examples. |
| Live platform | `test/gitlab/` with [the local GitLab](gitlab.md) | The GitLab adapters pass the same contract suites against a real GitLab, and the full review lifecycle, paging, git fetch over HTTP and token failures work there. Data is seeded per run and removed afterwards. |

The platform registry supports `github`, `bitbucket-cloud` and `gitlab`
(self-managed) for repositories, and `github-issues`, `jira-cloud` and
`gitlab-issues` for issues. GitLab needs a repository base address.

The default automated tests need neither Docker nor platform accounts. The
GitLab tests run under `npm test` only when the local GitLab is up, and are
reported as skipped otherwise. Recorded
requests are replayed in-process, not sent to their named hosts; Git fetches use
temporary local bare repositories. The fake AI CLI needs a POSIX environment
(Linux or macOS). Dependency installation needs network access unless cached.
The live AI suite can send synthetic example context to the configured AI service
and consume usage; use only approved, non-sensitive test data.

## 1. Prepare and run the existing examples

Run commands from the repository root with Node.js 24 or later and Git installed.
On a fresh checkout, install dependencies first:

```sh
npm ci
npm run typecheck
npm run build
npm run build:ui
```

### Example A: complete local review session

```sh
node --test test/end-to-end/full-app.test.ts
```

This starts the application through its real launcher, with a fake browser
opener. It lists PRs, opens PR 1, generates summaries, asks a question and
restarts on the same store. Assertions check the clone fingerprint, request
destinations, launched programs, credential exclusion, response headers,
read-only GET behaviour and log retention.

Expected result: every selected test passes, no external platform request is
made, and the temporary application data and repositories are cleaned up.
This suite does not drive a browser.

### Example B: review lifecycle and degraded dependencies

```sh
node --test \
  test/end-to-end/sessions.test.ts \
  test/end-to-end/diff.test.ts \
  test/end-to-end/summaries.test.ts \
  test/end-to-end/interrogation.test.ts \
  test/end-to-end/no-clone.test.ts \
  test/end-to-end/supersede.test.ts
```

These examples cover session reuse and PR state changes, added/modified/
renamed/deleted/binary files, scoped questions, evidence resolution, refresh,
old-answer retention, missing clones, failed summaries and superseded work.
Treat an explicit failure reason with usable remaining context as the expected
degraded state, not as a successful summary or answer.

### Example C: platform parity and sign-in

```sh
node --test \
  test/contract/source-control.contract.test.ts \
  test/contract/issue-tracker.contract.test.ts \
  test/end-to-end/signin.test.ts \
  test/end-to-end/server-guard.test.ts
```

Check both repository adapters and both trackers, including denied/missing
issues, reference normalisation, sign-in failures and the local server guard.
Contract parity does not imply that every full-session example runs on every
platform: the shared AI workbench harness currently uses GitHub plus Jira.

For an overall baseline after targeted runs:

```sh
npm test
```

## 2. A full, copyable local scenario

This standalone example reuses the existing harness instead of inventing a
second fixture system. Run it after the build commands above. It creates a
dirty reviewer clone and a PR changing lines 40-60 of `src/app.js` and removing
`sub` from `src/util.js`. It supplies known structured AI output, checks a
resolved code citation, pushes a new head, refreshes and verifies persistence.

```sh
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { startWorkbench, waitFor } from './test/helpers/fake-ai-cli.ts';

const cleanups = [];
const hook = { after(fn) { cleanups.push(fn); } };
const code = {
  kind: 'code', path: 'src/app.js', side: 'head',
  startLine: 45, endLine: 50,
};
const claim = {
  text: 'The selected values are multiplied by ten.',
  label: 'evidence', refs: [code],
};
const summary = {
  prSummary: [claim],
  files: [
    { path: 'src/app.js', claims: [claim] },
    {
      path: 'src/util.js',
      claims: [{ text: 'The sub helper is removed.', label: 'evidence',
        refs: [{ kind: 'code', path: 'src/util.js', side: 'base',
          startLine: 5, endLine: 7 }] }],
    },
  ],
  functionalImpact: [],
  technicalImpact: [],
};
const answer = {
  claims: [claim], unsupportedAssumptions: [], suggestedFollowUps: [],
};

try {
  const bench = await startWorkbench(hook, {
    composed: true,
    dirty: true,
    fake: { scenario: 'structured', summary, answer },
  });
  const before = await bench.sandbox.fingerprint();
  const request = async (method, path, body, status = 200) => {
    const res = await bench.client.request(method, path,
      body === undefined ? {} : { body });
    assert.equal(res.status, status, `${method} ${path}: ${res.text}`);
    return res.json;
  };
  const completed = async (path, select) => waitFor(async () => {
    const item = select(await request('GET', path));
    if (!item || !['completed', 'failed', 'cancelled'].includes(item.state))
      return false;
    assert.equal(item.state, 'completed', JSON.stringify(item));
    return item;
  }, path);

  const detail = await bench.startSession();
  const session = `/api/sessions/${detail.sessionId}`;
  const first = detail.snapshots[0];
  const summaryPath = (id) => `${session}/snapshots/${id}/summaries`;
  await completed(summaryPath(first.snapshotId), (items) => items[0]);

  const asked = await request('POST', `${session}/questions`, {
    scope: { type: 'range', path: 'src/app.js', side: 'head',
      startLine: 40, endLine: 60 },
    category: 'why', text: 'Why are these values scaled?',
  }, 202);
  const findQuestion = (items) =>
    items.find((item) => item.questionId === asked.questionId);
  const done = await completed(`${session}/questions`, findQuestion);
  assert.equal(done.answer.claims[0].label, 'evidence');
  assert.equal(done.answer.claims[0].refs[0].resolved, true);

  const newHead = await bench.pushHead({ 'docs/notes.md': '# Review notes\n' });
  const refreshed = await request('POST', `${session}/refresh`);
  const second = refreshed.snapshots.at(-1);
  assert.notEqual(second.snapshotId, first.snapshotId);
  assert.equal(second.headCommit, newHead);
  await completed(summaryPath(second.snapshotId), (items) => items[0]);
  const old = findQuestion(await request('GET', `${session}/questions`));
  assert.equal(old.headCommit, first.headCommit);
  assert.equal(old.isLatestSnapshot, false);

  await bench.restart();
  const retained = findQuestion(await request('GET', `${session}/questions`));
  assert.equal(retained.state, 'completed');
  assert.deepEqual(retained.answer, done.answer);
  assert.deepEqual(await bench.sandbox.fingerprint(), before);
  bench.recorded.assertAllRecorded();
  console.log('PASS: review, citation, refresh, persistence and clone safety');
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup();
}
NODE
```

The fake answer is intentionally deterministic and is not model-quality
evidence. The harness changes PATH and application-data environment variables
inside this process only. Run it as its own process, not inside a shared
application server. Its temporary data is removed on normal completion,
including assertion failure; it is not a persistent demonstration workspace.

## 3. Browser acceptance approach

There is no dedicated browser test runner in the package scripts. Add browser
coverage as a separate layer; do not relabel the HTTP suites as UI tests.

For fully local browser coverage, reuse recorded responses, a Git sandbox,
fake credentials and the fake CLI, but provide a browser-owned launch-token
exchange. The current `startWorkbench` test helper authenticates its HTTP
client first, consuming the one-time token: the printed launch URL cannot
simply be reused in a browser. A browser fixture launcher is additional work,
not a command available today.

Until that launcher exists, manually exercise the built application with a
disposable repository on a supported platform and synthetic PR/issue content:

```sh
npm run build && npm run build:ui
npx .
```

This manual route is **not offline** and uses the normal application data
directory and OS keychain. Do not replace an existing reviewer configuration
without preserving it; prefer a dedicated OS test account.

| Action | Expected visible result |
| --- | --- |
| Open the fresh launch URL | Session established, token removed from address bar; replay refused. |
| Save Setup and sign in | Valid configuration accepted; invalid input has a useful error. |
| Open the example PR twice | One review session, PR/commit/issue context and completeness reasons visible. |
| Open each changed-file kind | Correct paths, counts and base/head lines; no text hunks for binary content. |
| Read summaries | PR, per-file, functional and technical sections; Evidence/Inference labels and source links. |
| Ask PR, file and range questions | Scope/category retained; selectable range uses displayed diff lines. |
| Follow evidence links | Correct file side/line, issue or PR description; unresolved references explained. |
| Switch Technical/Business | Audience retained; real business answers describe user impact, not code identifiers. |
| Push a new head and refresh | New snapshot and summaries; previous answers stay tied to the old head. |
| Stop and relaunch | Stored sessions/answers survive; owned temporary workspaces are removed. |
| Close/delete a session | Correct confirmation and resulting list; no other session or reviewer files changed. |

Also check keyboard navigation, narrow-screen layout, loading/error states and
streamed updates. Keep screenshots and browser errors as evidence, but exclude
tokens, cookies and sensitive source text.

## 4. Real-provider and GitLab checks

Run the real-provider suite only with an installed, signed-in Claude Code CLI:

```sh
npm run test:live
```

It must fail rather than skip when the CLI is unavailable. It checks ignored
PR hooks/instructions, a grounded business answer, an outside-file canary and
a local URL canary. Do not substitute production secrets for the canaries.
Report unavailable CLI/authentication separately from an application assertion
failure; neither is a pass.

Run the GitLab live suite against [the local GitLab](gitlab.md):

```sh
npm run gitlab:up
npm run gitlab:bootstrap
npm run test:gitlab
npm run gitlab:down
```

Each test file seeds its own run (`it-<suite>-<timestamp>`) through the
test-only seeder, runs the shared provider contracts and review lifecycle
against it, and deletes only that run's data. `test:gitlab` fails when GitLab
is down or not bootstrapped; plain `npm test` reports the GitLab tests as
skipped. Never count skipped coverage as verified. Leftovers from a crashed run
are listed, not deleted: remove them with `npm run gitlab:clean`. Tests never
run `gitlab:reset`, which deletes all instance data.

## 5. Completion and evidence

Record the commit tested, Node/OS, commands, selected scenarios, results and
environment blockers. For each example, retain its expected and actual state,
snapshot/head identifiers and any explicit failure reason. Redact credentials
and launch/session tokens from reports.

A testing pass means:

- Relevant targeted suites pass, with no unexpected unrecorded requests.
- The complete local scenario passes and the reviewer clone is unchanged.
- Browser checks are recorded separately, or clearly marked unverified.
- Live-provider and GitLab checks are labelled passed, failed or skipped;
  their absence is never presented as a successful full-stack run.
- No test-owned server, child process, worktree or disposable project remains.
