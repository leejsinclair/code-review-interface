# Devcontainer

## What's in it

- Node 24 (`engines.node >=24`), npm, TypeScript tooling from `npm ci`.
- Claude Code CLI (the workbench's AI provider; `npm run test:live`).
- Spec Kit `specify` 1.2.3 via `uv`, python3 for `.specify/events.py` and `specview.py`.
- Playwright Chromium for `npm run test:ui`.
- Docker CLI + compose against the host daemon (docker-outside-of-docker) for `npm run gitlab:*`.
- gnome-keyring + D-Bus so `@napi-rs/keyring` works for `npm run dev` / `npx .`.
- Optional sonar-scanner: set `INSTALL_SONAR` to `"true"` in `devcontainer.json` and rebuild.

## Mounts (from the host)

| Host | Container | Mode |
| --- | --- | --- |
| this repo | same absolute path | rw |
| `/home/lsinclair/projects` | `/workspaces/projects` (`$PROJECTS_ROOT`) | rw |
| `~/.ssh` | `/home/node/.ssh` | ro |
| `~/.gitconfig` | `/home/node/.gitconfig.host` (included by `~/.gitconfig.container`) | ro |
| `~/.aws`, `~/.kube` | `/home/node/.aws`, `/home/node/.kube` | rw |
| `/var/run/docker.sock` | `/var/run/docker-host.sock` | rw |
| `~/.claude` | `/home/node/.claude` **and** `/home/$USER/.claude` | rw |
| `~/.claude.json` | `/home/node/.claude.json` | rw |

`~/.claude` is mounted twice because the container user is `node`, but plugin metadata in
`~/.claude/plugins/installed_plugins.json` records absolute paths under the host user's home.

`~/.aws` and `~/.kube` must exist on the host or the container will not start.

## Why these choices

- **Workspace at the same path as the host.** Docker talks to the host daemon, so bind mounts in
  `gitlab/compose.yaml` and `gitlab.sh reset` must resolve to real host paths.
- **`--network=host`.** The local GitLab publishes on the host's `127.0.0.1:8929` and advertises
  `localhost:8929`; host networking makes `localhost` mean the same thing everywhere, and the
  workbench's random `127.0.0.1` port is reachable from the host browser.
- **`SONAR_TOKEN` comes from the host environment** (`${localEnv:SONAR_TOKEN}`). Export it before
  launching VS Code; never commit it.

## Notes

- `xdg-open` cannot open a host browser from inside the container: copy the launch URL the
  workbench prints.
- The container keychain is ephemeral. Re-enter platform tokens in **Setup** after a rebuild.
- `setup-claude.sh` installs the `typescript-lsp` Claude plugin with `--scope project`, which can
  add an `enabledPlugins` entry to the tracked `.claude/settings.json`. Review `git diff` before committing.

## Common commands

```sh
npm run typecheck && npm test
npm run build && npm run build:ui && npm run test:ui
npm run gitlab:up && npm run gitlab:bootstrap && npm run test:gitlab
```
