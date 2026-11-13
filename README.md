# PR Review Workbench

A local workbench for understanding a pull request before you review it. It gathers the PR, its diff, its commits and the issues it references, summarises the change, and answers your questions about it. Every claim in an answer is labelled **Evidence** or **Inference**, and every Evidence reference opens the code, issue or description it cites.

It runs on your machine: a Node server bound to `127.0.0.1` and a browser UI. Nothing leaves the machine except calls to your configured platforms and the AI provider you have installed. Calls to the platforms are read-only, with one exception: the reviewer actions you start yourself (comment, reply, edit or delete your own comment, approve, request changes, withdraw). Each is one click that posts at once, is refused if the pull request has new commits, and is recorded locally. The product never merges, declines or closes a pull request.

## Requirements

- Node.js 24 or later
- git
- Local clones of the repositories you review, all under one base folder
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
| Base folder | A folder that contains your clones. The workbench searches it (without following symlinks) for repositories whose remote matches the platform, and lists their open pull requests on Home. Rescan after adding a clone. |
| Platform | The source-control platform your repositories are hosted on, and a base address if it is self-hosted |
| Issue tracker | The tracker whose issues the pull requests reference, with its site and project keys where it needs them |
| Limits (Advanced) | Largest file, most changed lines and largest prompt sent to the AI. Files over a limit are listed as skipped, with the reason. |
| Log retention | Days to keep log files (default 7) |

## Sign in

Each platform has its own sign-in form. Credentials go to the operating system's keychain. They are never written to the config, the logs or the review store, and never passed to the AI provider.

| Platform | You provide |
|---|---|
| GitHub (repository and issues) | A personal access token with read access to the repository |
| Bitbucket Cloud | Your Atlassian account email and an API token with read access to repositories and pull requests |
| Jira Cloud | Your Atlassian account email and an API token |

If a token expires or is revoked, the next call that needs it sends you back to the sign-in screen.

## Review focus

Every changed file gets one of four risk classes: **Low**, **Normal**, **Elevated** or **Critical**, with the reasons, the rule IDs and, where there are any, the changed lines responsible. There is no score, percentage or rank, and nothing is ever called approved. The Overview lists the Critical and Elevated files first, then the files that are only a candidate for reduced review (lockfiles, generated files, comment-only edits, pure renames) and the files that could not be fully analysed.

- **Rules first.** Built-in rules (authentication, authorisation, deletion, financial calculation, database migrations, build and infrastructure configuration) run as soon as a snapshot is stored, without any AI.
- **The AI can only raise a class**, and only when it cites a changed line the workbench can find. It never lowers one. If it is unavailable or its output cannot be read, the rule classes still show and the AI assessment is reported as missing, with the reason.
- **You can override a class** with a reason. The override is recorded, never deletes the calculated class or its reasons, and carries over to a later snapshot only while that file's change is the same. Lowering a class that was calculated Critical also records your platform account, which the server reads from the platform; you never type it.
- **Tune the rules** with an optional `risk-rules.json` in the data directory (see below). A rule file can add paths and terms, add rules and raise a class, never lower one; a file it cannot read is ignored with a notice and the built-in rules apply. The format is in [`specs/004-risk-review-focus/contracts/rule-file.md`](specs/004-risk-review-focus/contracts/rule-file.md).

## Specification

The Overview shows the specification the pull request was built from, in place of a changed-files list (the Diff screen keeps the file list). For each Jira key on the pull request (branch name, title, description) the workbench looks for a `specs/<folder>` whose name contains the whole key, first in the pull request's own repository, then in the project repository whose clone encloses it on your disk (for example `apps/hd-job` inside `project-hd-v3`). It considers `develop` and every remote branch whose name contains the key, and reads the file ending in `spec.md` and `tdd-evidence.md` (in the folder or its `tests/` subfolder), each from the best place it exists: the pull request's own repository first, a matching branch over `develop`, then the most recent commit. The panel says which copy it used and by which rule.

The panel then shows a summary of each document, one row per acceptance criterion (what the code and the TDD evidence show for it), a verdict on whether testing looks sufficient, and scope deviations in both directions. Everything the AI says is labelled **Inferred** and cites the passage or changed lines it comes from; a citation the workbench cannot find in the stored text is marked and kept, never shown as fact. A missing, stale or unreadable document is a visible gap with its reason, never a pass. Reading uses read-only git into refs the workbench owns (`refs/prwb/...`); your branch, index, stash and working files are never touched, and the documents go only to your configured AI provider.

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

It holds `config.json`, the optional `risk-rules.json`, the append-only review store `review.db`, daily logs in `logs/`, isolated worktrees in `workspaces/`, and the AI provider's empty working folders in `provider-home/`. Logs hold operation names, outcomes, durations and ids only, never code, diffs, prompts, answers, PR or issue text, or credentials.

## Development

```sh
npm run typecheck   # tsc --noEmit
npm test            # every test, against recorded platform responses and a fake AI CLI
npm run test:live   # the real-CLI suite
npm run dev         # rebuild the UI on change and run from source
```

`npm run test:live` runs `test/live/` against the installed Claude Code CLI. It checks that a hostile PR cannot run hooks or plant instructions, that a business question gets a business answer, and that the provider cannot read outside its workspace or reach the network. It needs the CLI installed and signed in. Without that it fails rather than skipping.

### UI dependencies for the Markdown preview

The Files view can render a Markdown file as a preview, with Mermaid diagrams. These are bundled into the UI by esbuild (dev dependencies; nothing is loaded from a third party at run time):

| Package | Purpose | Alternative considered |
| --- | --- | --- |
| `marked` | Markdown to HTML | `markdown-it`: heavier, needs plugins for tables and task lists |
| `dompurify` | Sanitizes that HTML, because the file is untrusted repository content | none: a vetted sanitizer is safer than a hand-written one |
| `mermaid` | Draws ```` ```mermaid ```` blocks. Loaded on first use from `dist/ui/chunks/`, so it does not weigh on the main bundle | none comparable |

The page's Content-Security-Policy forbids inline styles, so each diagram is shown as an image (`data:image/svg+xml`), which keeps its own styles and cannot run scripts. Mermaid's temporary layout nodes still trigger "inline style" CSP console messages while a diagram is drawn; they do not affect the result.
