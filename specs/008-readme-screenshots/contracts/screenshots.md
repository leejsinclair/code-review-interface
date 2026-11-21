# Contract: Demo Seed, Clean and Screenshot Commands

The feature adds no product interface: nothing in `src/` changes, and the HTTP API and UI routes are the ones already defined in earlier features. This contract covers what the feature does expose: three npm commands, their environment, their output and exit codes, the test-only TypeScript exports, the fixed demo identifiers, and the screenshot files with the view each one captures. Tests and the README code against these names.

The spec has no Verbatim Constraints section. The identifiers below come from `plan.md` and `research.md`, and the routes and `data-testid` values come from the existing UI (`src/ui/state/routes.ts` and the components).

## 1. Commands (`package.json` scripts)

| Script | Runs | Purpose | Requirements |
|---|---|---|---|
| `npm run gitlab:demo` | `node test/demo/seed.ts` | Seed the demo on local GitLab, idempotently | FR-005, FR-006, FR-007 |
| `npm run gitlab:demo:clean` | `node test/demo/clean.ts` | Remove `prwb-demo/acme` and the demo users only | FR-008 |
| `npm run screenshots` | `node test/demo/screenshots.ts` | Capture every view into `docs/screenshots/` | FR-002, FR-009 to FR-012 |

Existing commands that stay unchanged: `npm run gitlab:up`, `npm run gitlab:bootstrap`, `npm run gitlab:clean` (removes `it-*` items only, so it never touches the demo).

### Environment

| Variable | Default | Used by |
|---|---|---|
| `GITLAB_URL` | `http://localhost:8929` | all three |
| `GITLAB_TOKEN` | `glpat-prwb-local-test-token` (root) | all three. `screenshots` uses it only to mint a short-lived `demo-reviewer` token and revokes that token at the end |

The screenshot run never reads the user's config, app data or keychain. It uses temp app data, the fake keyring, and the fake `claude` CLI on `PATH` (FR-009, FR-010).

### Output and exit codes

| Case | Output | Exit |
|---|---|---|
| GitLab down or not bootstrapped (all three) | the probe cause, then `start it with \`npm run gitlab:up\` and then \`npm run gitlab:bootstrap\`` | 1 |
| `gitlab:demo` success | one line per item: `<created\|exists> <kind> <key> — <purpose>` | 0 |
| `gitlab:demo` second run | every line says `exists` | 0 |
| `gitlab:demo:clean` success | one line per removed item (the subgroup, each demo user); a missing item reports `absent` | 0 |
| `screenshots` success | one line per file written: `docs/screenshots/<file>` | 0 |
| `screenshots`, a view not ready | the files written, then one line per failure: `<view>: <reason>`; the previous `<file>` is kept | 1 |

`<kind>` is one of `group`, `user`, `project`, `issue`, `merge_request`, `note`, `approval`.

## 2. Test-only exports (`test/demo/`)

```ts
// test/demo/seed.ts
export type DemoOptions = { group?: string; userPrefix?: string; gitlabUrl?: string };   // defaults: 'prwb-demo/acme', 'demo', GITLAB_URL
export type SeedLine = { status: 'created' | 'exists'; kind: string; key: string; purpose: string };
export function seed(options?: DemoOptions): Promise<SeedLine[]>;

// test/demo/clean.ts
export function clean(options?: DemoOptions): Promise<string[]>;      // removes options.group and the two prefixed users only

// test/demo/after-hooks.ts
export function createAfterHooks(): { after(fn: () => unknown | Promise<unknown>): void; run(): Promise<void> };
// run(): callbacks in reverse order; keeps going when one throws; always called in `finally`.

// test/demo/screenshots.ts
export function captureTo(file: string, view: DemoView, page: Page): Promise<{ ok: true } | { ok: false; reason: string }>;
// waits for view.ready (15 s via waitFor), writes `<file>.tmp`, renames over `<file>` only on success,
// deletes `<file>.tmp` on failure. Never writes a blank or partial image.
export function workbenchOptions(): WorkbenchOptions;
// the isolated setup the run passes to useBrowser: temp app data, fake keyring, fake `claude` on PATH. Exported for the isolation test.

// test/demo/scenarios.ts
export const DEMO_GROUP = 'prwb-demo/acme';
export const DEMO_USER_PREFIX = 'demo';
export const VIEWPORT = { width: 1440, height: 900 };
export const COLOR_SCHEME = 'light';
export type DemoView = {
  name: string;              // the view id in §4
  file: string;              // file name in docs/screenshots/
  project: string;           // 'storefront' | 'billing-api' (or '' for the queue)
  mergeRequest?: number;     // iid
  route: (sessionId: string) => string;  // a hash route from §4
  actions?: readonly ({ fill: string; text: string } | { click: string })[];  // run in order before waiting for `ready`
  ready: string;             // CSS selector, §4
  ai: FakeConfig;            // summary, answer and alignment text (test/helpers/fake-ai-cli.ts)
  alt: string;               // README alt text (FR-003)
};
export const views: readonly DemoView[];
```

The live test `test/gitlab/demo.test.ts` calls `seed({ group: 'prwb-demo/it-demo-<stamp>', userPrefix: 'it-demo-<stamp>' })` twice, asserts every line of the second report is `exists`, then calls `clean` with the same options and asserts `prwb-it` is untouched. `test/unit/demo-guards.test.ts` passes `gitlabUrl` to prove the unreachable and non-loopback refusals without a running GitLab.

## 3. Demo identifiers (fixed keys for idempotency)

| Item | Key | Find by |
|---|---|---|
| Top-level group | `prwb-demo` (persistent; clean never deletes it) | full path |
| Demo subgroup | `prwb-demo/acme` | full path |
| Users | `demo-reviewer` ("Demo Reviewer"), `demo-author` ("Demo Author"), emails `@prwb.invalid` | username |
| Projects | `prwb-demo/acme/storefront`, `prwb-demo/acme/billing-api` | full path |
| Issue | `storefront#1`, the cart-rounding issue | exact title |
| Notes | the demo-author line comment on `src/cart/total.ts` and the demo-reviewer reply in the same discussion on `storefront!4` | exact body |
| Approval | `demo-reviewer` on `storefront!5` | approval state |

| Merge request | Source branch / title | Files | Shows |
|---|---|---|---|
| `storefront!1` | "Add session tokens and sessions table" | `src/auth/session.ts`, `db/migrations/0007_create_sessions.sql`, `src/cart/total.ts`, `src/generated/session-types.ts` | overview summary, review focus, diff with risk, ask a question |
| `storefront!2` | "Update dependencies" | `package-lock.json`, `src/generated/api-types.ts` | reduced review (in the review-focus image) |
| `storefront!3` | branch `014-discount-codes`, "Add discount codes"; no issue reference | `specs/014-discount-codes/discount-codes.spec.md`, `specs/014-discount-codes/tests/tdd-evidence.md`, `src/cart/discounts.ts`, `test/cart/discounts.test.ts` | specification alignment |
| `storefront!4` | "Fix cart total rounding", description `Closes #1` | `src/cart/total.ts` | comments and replies |
| `storefront!5` | "Tidy README badges", approved by `demo-reviewer` | `README.md` | review decision |
| `billing-api!1` | "Add invoice export" | `src/invoices/export.ts`, `src/invoices/csv.ts` | a second repository in the review queue |

Merge requests are found by source branch. Branch content is pushed only when the branch is missing. No demo name starts with `it-`.

## 4. Screenshot views and files

All images: PNG, 1440×900, light theme, in `docs/screenshots/`, linked from README by relative path (`docs/screenshots/<file>`). The page clock is pinned to the newest demo merge request's `created_at` plus one hour. Clones live under `<os tmpdir>/prwb-demo/`.

| View (`name`) | File | README feature | Merge request | Route | Ready selector |
|---|---|---|---|---|---|
| `review-queue` | `review-queue.png` | Review queue | all | `#/` | `[data-testid="pr-list"]` |
| `overview-summary` | `overview-summary.png` | Overview summary | `storefront!1` | `#/sessions/:sessionId` | `[data-testid="summaries"]` |
| `review-focus` | `review-focus.png` | Review focus | `storefront!1` | `#/sessions/:sessionId` | `[data-testid="review-focus"]` |
| `diff-risk` | `diff-risk.png` | Diff with risk | `storefront!1` | `#/sessions/:sessionId/diff?path=src%2Fauth%2Fsession.ts` | `[data-testid="file-risk"]` |
| `ask-question` | `ask-question.png` | Ask a question | `storefront!1` | `#/sessions/:sessionId/ask` | `[data-testid^="answer-for-"]`, after filling `[data-testid="question-input"]` with the demo question and clicking `[data-testid="ask-button"]` |
| `spec-alignment` | `spec-alignment.png` | Specification alignment | `storefront!3` | `#/sessions/:sessionId` | `[data-testid="spec-verdict"]` |
| `comments` | `comments.png` | Comments and replies | `storefront!4` | `#/sessions/:sessionId/diff?path=src%2Fcart%2Ftotal.ts` | `[data-testid="comment-thread"]` |
| `review-decision` | `review-decision.png` | Review decision | `storefront!5` | `#/sessions/:sessionId` | `[data-testid="decision-state"]` |

`:sessionId` is the id the workbench returns when the script starts a review session for that merge request. On GitLab the decision panel shows Request changes (`[data-testid="decision-request-changes"]`) as unavailable, and the README says so (R11).

Each view name maps to exactly one README Features entry and one file. `test/unit/demo-scenarios.test.ts` checks that every README feature has a view. `test/unit/readme-features.test.ts` checks that every `docs/screenshots/<file>` the README links exists and has non-empty alt text. Removing a feature removes its row here, its README entry and its file together.
