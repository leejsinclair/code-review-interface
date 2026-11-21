# Contract: configuration, environment, git and verification commands

## Configuration (FR-021, R10)

```ts
// src/config.ts
export type WorkspaceConfig = { baseFolder: string; platform: PlatformId; baseUrl?: string; sshHost?: string };
```

`workspace.sshHost` is optional: a self-hosted platform's SSH host when it differs from its web host. It is
passed to adapters as `SourceControlSettings.sshHost`. It accepts a bare host name; an invalid value is a
`ConfigError('invalid_request', 'workspace.sshHost', ...)`. The field name is platform-neutral.

## Environment variables (FR-022, R11)

`envCredential(platform, env)` in `src/adapters/env-credentials.ts`, used only when no other credential is available:

| Platform | Variables, in order | Returned credential |
|---|---|---|
| GitHub | `GITHUB_TOKEN`, then `GH_TOKEN` | `{ secret, scheme: 'bearer', scope: 'write' }` |
| GitLab | `GITLAB_TOKEN` | `{ secret, scheme: 'bearer', scope: 'write' }` |

Existing Bitbucket and Jira variables are unchanged.

## SSH hosts recognised (FR-021)

`ssh.bitbucket.org`, `ssh.github.com` (port 443), and the configured `workspace.sshHost`.

## Git allowlist change (FR-033, R12)

`GIT_COMMANDS.listRemoteHeads` in `src/repo/git.ts`:

```ts
  /** Lists a remote's branch heads and its default branch. Network read; writes nothing. */
  listRemoteHeads: { args: ['ls-remote', '--symref', '{url}', 'HEAD', 'refs/heads/*'] },
```

Output: `ref: refs/heads/<default>\tHEAD`, then `<commit>\tHEAD` and `<commit>\trefs/heads/<name>` lines.
The repository manager returns the heads plus the default branch name. The command stays a network read
that writes nothing, and the repo-safety test covers it (IX).

## Fixture recorder (FR-030, R14)

`test/record/capture.ts`: a `node --import` preload, outside every test glob (`npm test`,
`npm run test:live`, `npm run test:gitlab`). Run as `node --import ./test/record/capture.ts src/main.ts`, it
replaces the global `fetch` with `recordingFetch`; every write is still started by a person's click in the UI
(II.4), following `test/record/README.md`. It refuses to start unless `PRWB_RECORD_FIXTURES` names a
directory and the alias variables are set. `recordingFetch` gains an `aliases` option (real value →
placeholder) applied to URLs, headers and bodies; placeholders are `alice-dev`, `bob-dev` and
`test-workspace`. Each fixture README names the recording role ("reviewer account", "author account") and
the date. Real workspace and account names appear nowhere in the repository.

## Verification commands

| Command | Must show |
|---|---|
| `npm run typecheck` | 0 errors (FR-027, SC-007) |
| `npm test` | 0 failures (FR-027, SC-007) |
| `node --test test/contract/*.contract.test.ts` | Every FR-001 to FR-015 scenario passes for all three platforms, expectations as data (FR-028, SC-008) |
| `npm run gitlab:up && npm run test:gitlab` | The writer contract runs live against the local GitLab instance and exercises review actions (FR-031) |
