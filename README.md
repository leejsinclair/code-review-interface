# PR Review Workbench

A local workbench for understanding a pull request before you review it. It gathers the PR, its diff, its commits and the issues it references, summarises the change, and answers your questions about it. Every claim in an answer is labelled **Evidence** or **Inference**, and every Evidence reference opens the code, issue or description it cites.

It runs on your machine: a Node server bound to `127.0.0.1` and a browser UI. Nothing leaves the machine except read-only calls to your configured platforms and the AI provider you have installed.

## Requirements

- Node.js 24 or later
- git
- A local clone of the repository you review
- [Claude Code](https://claude.com/claude-code), installed and signed in, for summaries and questions. Without it the workbench still gathers context, and summaries and questions report the provider as unavailable.

## Start

From a checkout:

```sh
npm install
npm run build && npm run build:ui
npx .
```

The workbench prints a launch URL and opens it in your browser. The URL carries a one-time token in its fragment. The launch page exchanges it for a session cookie and removes it from the address bar. Stop the workbench with Ctrl+C. It cancels running AI work and removes its isolated workspaces. Your sessions stay in the review store.

## Configure

The first screen is **Setup**. It asks for:

| Setting | Meaning |
|---|---|
| Repository platform | `github` or `bitbucket-cloud` |
| Repository | `owner/name` (GitHub) or `workspace/repo` (Bitbucket Cloud) |
| Clone path | Your existing local clone. It must have a remote pointing at the repository. |
| Issue tracker | `github-issues`, or `jira-cloud` with its site URL and project keys |
| Limits | Largest file, most changed lines and largest prompt sent to the AI. Files over a limit are listed as skipped, with the reason. |
| Log retention | Days to keep log files (default 7) |

## Sign in

Each platform has its own sign-in form. Credentials go to the operating system's keychain. They are never written to the config, the logs or the review store, and never passed to the AI provider.

| Platform | You provide |
|---|---|
| GitHub (repository and issues) | A personal access token with read access to the repository |
| Bitbucket Cloud | Your Atlassian account email and an API token with read access to repositories and pull requests |
| Jira Cloud | Your Atlassian account email and an API token |

If a token expires or is revoked, the next call that needs it sends you back to the sign-in screen.

## What the workbench never does

- It never approves, merges, comments on or changes anything on any platform. Every platform call is a read.
- It never touches your working copy. It fetches PR heads into `refs/prwb/*` and checks them out in its own worktrees under its data directory. It never checks out, stashes or resets in your clone, never runs your git hooks, and never runs `git worktree prune`. It removes only its own worktrees, by their paths.
- It never runs the AI provider with write, shell or network tools. Claude Code runs with `--restricted`, the read and search tools only, no MCP servers and no project settings, hooks or instructions. Its working directory is an empty folder, and the PR's worktree is the only directory it may read. If a restriction cannot be enforced, the workbench either refuses to run the provider or names the missing restriction on every answer.
- It never scores, ranks or times a person.

## Where data lives

One directory per user:

| OS | Directory |
|---|---|
| Linux | `$XDG_DATA_HOME/pr-review-workbench` (default `~/.local/share/pr-review-workbench`) |
| macOS | `~/Library/Application Support/pr-review-workbench` |
| Windows | `%LOCALAPPDATA%\pr-review-workbench` |

It holds `config.json`, the append-only review store `review.db`, daily logs in `logs/`, isolated worktrees in `workspaces/`, and the AI provider's empty working folders in `provider-home/`. Logs hold operation names, outcomes, durations and ids only, never code, diffs, prompts, answers, PR or issue text, or credentials.

## Development

```sh
npm run typecheck   # tsc --noEmit
npm test            # every test, against recorded platform responses and a fake AI CLI
npm run test:live   # the real-CLI suite
npm run dev         # rebuild the UI on change and run from source
```

`npm run test:live` runs `test/live/` against the installed Claude Code CLI. It checks that a hostile PR cannot run hooks or plant instructions, that a business question gets a business answer, and that the provider cannot read outside its workspace or reach the network. It needs the CLI installed and signed in. Without that it fails rather than skipping.
