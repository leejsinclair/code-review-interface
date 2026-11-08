# Local GitLab for integration tests

A disposable GitLab CE instance in Docker, so integration tests can run against
a real Git hosting API repeatably and offline. Based on the official
[GitLab Docker install guide](https://docs.gitlab.com/install/docker/installation/).

Only `compose.yaml`, `bootstrap.rb`, `gitlab.sh` and this file are tracked.
Runtime data lives in `gitlab/volumes/` and is git-ignored.

## Use

```sh
npm run gitlab:up          # start and wait until ready (first boot ~3 min)
npm run gitlab:bootstrap   # create the API token tests use (idempotent)
npm run gitlab:down        # stop, keep data
npm run gitlab:reset       # stop and delete all data
```

Or call `gitlab/gitlab.sh <up|bootstrap|down|reset|status|logs>` directly.

| What | Value |
| --- | --- |
| Web / API | <http://localhost:8929> (`/api/v4`) |
| SSH clone | `ssh://git@localhost:2424/<group>/<project>.git` |
| Root login | `root` / `prwb-Local-Test-2026!` |
| API token | `glpat-prwb-local-test-token` (root, scopes `api`, `read_repository`, `write_repository`) |

These credentials are throwaway values for an instance bound to `127.0.0.1`
only. Never reuse them anywhere else.

## Overrides

Set any of these in the environment before running the script:

| Variable | Default |
| --- | --- |
| `GITLAB_VERSION` | `19.5.3-ce.0` (pinned, bump on purpose) |
| `GITLAB_HTTP_PORT` | `8929` |
| `GITLAB_SSH_PORT` | `2424` |
| `GITLAB_ROOT_PASSWORD` | see above; applied only on first boot |
| `PRWB_GITLAB_TOKEN` | see above; must be at least 20 characters |

## Notes

- The root password applies only when the data directory is empty. To change
  it, run `reset` first.
- Files in `volumes/` are owned by users inside the container, so `reset`
  deletes them through a throwaway container instead of needing `sudo`.
- Monitoring, the container registry and KAS are switched off to keep memory
  use down. Expect about 2.5–3 GB of RAM when GitLab is idle.
- `up` waits on GitLab's `/-/readiness` endpoint rather than the image's
  built-in healthcheck, which can report healthy before Rails is serving.
