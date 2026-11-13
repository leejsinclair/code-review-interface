# Contract: git allowlist additions

Added to `GIT_COMMANDS` in `src/repo/git.ts`, each with a test in the git sandbox suite (XI.3). Arguments
are an array, never a shell (IX.1). None runs checkout, switch, pull, merge, rebase, reset, stash, clean or
worktree prune, and none writes to the reviewer's branches, index or working files (FR-006).

```ts
  /** Lists a remote's branch heads: `<commit>\trefs/heads/<name>`. Network read; writes nothing. */
  listRemoteHeads: { args: ['ls-remote', '--heads', '{url}'] },
  /** Lists every file path in a commit's `specs/` tree, to find `specs/*<key>*` folders and their files. */
  listTreePaths: { args: ['ls-tree', '-r', '--name-only', '{commit}', '--', 'specs/'] },
  /** Prints the last commit that touched a path, as the document's recorded commit. */
  lastCommitTouching: { args: ['log', '-1', '--format=%H', '{commit}', '--', '{path}'] },
```

Reused, unchanged:

- `fetchToPrwbRef` with `side` set to `spec-{n}`: fetches a branch into
  `refs/prwb/{sessionId}/{snapshotId}/spec-{n}`, a ref the product owns. `{sourceRef}` is
  `refs/heads/{branch}` from `listRemoteHeads`. The refs are removed by the existing `deleteSessionRefs`.
- `readFileAtCommit` (`cat-file -p {commit}:{path}`): reads each chosen file at its last-touching commit.
- `fileSizeAtCommit`: size check before reading a document.

## Rules

- `{url}` is the clone's matched remote URL from `listRemotes`. The reviewer's own remote-tracking refs and
  local branches are never read (R2).
- `{path}` and `{commit}` come from `listTreePaths` and `lastCommitTouching` output, validated as a
  40 or 64 character hex commit and a path under `specs/` with no `..` segment. A value that fails is refused
  before the command runs.
- The folder match, file-name match and branch choice are done in `src/core/spec-match.ts` on the listed names,
  not by git arguments. File names matched: ending in `spec.md` (`spec.md`, `<name>.spec.md`, `<name>-spec.md`)
  and exactly `tdd-evidence.md`.
- A command failure becomes a `read-failed` gap with the first git error line (FR-018). It never stops
  the rest of the overview.
- The existing allowlist test (no entry may contain a forbidden verb) covers the three new entries. A sandbox
  test checks that after a full lookup the checked-out branch, index, stash and working files are unchanged
  (SC-006).
