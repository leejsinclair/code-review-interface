# Project purpose

## Setup

Speckit: [Speckit](https://github.com/github/spec-kit)

Speckit extensions:

* [Grill me integrated](https://github.com/leejsinclair/speckit-grill-specify)
* [TDD integrated](https://github.com/leejsinclair/speckit-tdd-integrated)
* [Spec Viewer and Kanban Board](https://github.com/leejsinclair/rich-specification-viewer)
* [Claude Mod - Mini Kanban](https://github.com/leejsinclair/speckit-mod-micro-kanban)
## Development environment

The product targets **Bitbucket Cloud and Jira**. It is developed on a personal machine
that has only **GitHub and GitHub Issues**, so:

* This repository and its issues live on GitHub.
* Source control and issue tracking sit behind provider-neutral interfaces (as the AI
  provider already does in MVP.md §6): GitHub / GitHub Issues adapters are used to build
  and dogfood here; Bitbucket Cloud / Jira adapters are the target and are tested against
  recorded API fixtures, since there is no live access here.

## Installed (2026-11-07)

| Component | Version | Installed from |
| --- | --- | --- |
| Spec Kit (`specify`) | 1.2.3 | Claude integration (`.claude/skills`) |
| grill-specify | `main` @ 4c0d3d4 | local checkout (`--dev`); the archive has a symlink Spec Kit refuses |
| integrated-tdd extension + preset | 0.3.0 (`main`) | branch archive; no v0.3.0 tag published yet |
| Spec viewer | `main` | `specview.py` in the project root: `python3 specview.py` |
| micro-kanban | latest | `claude plugin install … --scope project` |
