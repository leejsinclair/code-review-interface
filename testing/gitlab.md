# GitLab for testing

A local, disposable GitLab CE instance (Docker) that integration tests can run
against: real Git hosting, real REST API, no network access or accounts needed.
The Docker setup lives in [`gitlab/`](../gitlab/README.md).

For the application's current runnable examples and the distinction between
fixture-backed tests and future GitLab integration, see the
[testing approach](README.md). GitLab is not yet a registered application
platform.

## Settings

- Web and API address: <http://localhost:8929> (REST API at `/api/v4`)
- API token: `glpat-prwb-local-test-token` (root; scopes `api`, `read_repository`, `write_repository`)
- Root login: `root` / `prwb-Local-Test-2026!`
- SSH: `localhost:2424` (only after you add a key to root; HTTP with the token is simpler)
- Version: GitLab CE `19.5.3` (pinned in `gitlab/compose.yaml`)

These are throwaway credentials. They're committed on purpose and the instance
only listens on `127.0.0.1`. Never reuse them anywhere else.

## Prerequisites

- Docker with Compose v2 (`docker compose`), and your user able to run `docker`.
- About 3 GB of free RAM and a few GB of disk. The image is about 1.5 GB.
- Ports `8929` and `2424` free on localhost. To change them, see
  [Overrides](#overrides).

## Lifecycle

| Command | What it does |
| --- | --- |
| `npm run gitlab:up` | Start GitLab and block until it is ready to serve requests. Takes about 3 min from empty and less on later starts. |
| `npm run gitlab:bootstrap` | Create the API token above and check it against the API. Safe to re-run. |
| `npm run gitlab:down` | Stop GitLab and keep its data. |
| `npm run gitlab:reset` | Stop GitLab and delete **all** its data, giving a clean slate. |
| `gitlab/gitlab.sh status` | Show the container state. |
| `gitlab/gitlab.sh logs` | Follow GitLab's logs. |

First time, or after a reset:

```sh
npm run gitlab:up && npm run gitlab:bootstrap
```

GitLab keeps its state between `down` and `up`. The token and anything the
tests created are still there next time. Run `reset` and then the line above
whenever you want a guaranteed clean instance, for example before a CI run.

## Writing tests against it

**Read the URL and token from the environment** and fall back to the defaults,
so the same tests can also point at another instance:

```ts
const GITLAB_URL = process.env.GITLAB_URL ?? 'http://localhost:8929';
const GITLAB_TOKEN = process.env.GITLAB_TOKEN ?? 'glpat-prwb-local-test-token';
```

**Skip, don't fail, when GitLab isn't running.** Check `GET /api/v4/version`
(with the token) before the suite starts, and skip with a message pointing to
`npm run gitlab:up`. Plain `npm test` must keep working without Docker.

**Make every test own its data.** Each test (or suite) creates its own project
with a unique name, such as `it-<suite>-<timestamp>`, and deletes it afterwards.
Never depend on data left by another test or an earlier run. That lets tests
run against a long-lived instance without a reset each time.

### Authenticating

- REST API: send the header `PRIVATE-TOKEN: <token>`. Sending
  `Authorization: Bearer <token>` also works.
- Git over HTTP: put the token in the URL as the password; any username works.
  For example: `http://oauth2:<token>@localhost:8929/root/<project>.git`

### Typical setup: a project with a merge request

```sh
T=glpat-prwb-local-test-token; API=http://localhost:8929/api/v4

# 1. Create a project (initialize_with_readme gives it a `main` branch)
curl -fsS -H "PRIVATE-TOKEN: $T" -X POST "$API/projects" \
  -d name=it-demo -d initialize_with_readme=true

# 2. Clone, branch, commit, push
git clone "http://oauth2:$T@localhost:8929/root/it-demo.git" && cd it-demo
git switch -c feature && echo hi > a.txt && git add a.txt
git commit -m "add a" && git push origin feature

# 3. Open the merge request
curl -fsS -H "PRIVATE-TOKEN: $T" -X POST "$API/projects/root%2Fit-demo/merge_requests" \
  -d source_branch=feature -d target_branch=main -d title="Add a"

# 4. Read it back
curl -fsS -H "PRIVATE-TOKEN: $T" "$API/projects/root%2Fit-demo/merge_requests/1/diffs"
```

You can address a project by numeric ID or by its URL-encoded path
(`root%2Fit-demo`).

### Things that happen in the background (wait for them)

GitLab processes some work in background jobs, so a test that acts too soon
gets odd results:

- **Just after a push**, creating a merge request from that branch can return
  `400` until GitLab has processed the push. Before opening the merge request,
  poll `GET /projects/:id/repository/branches/:branch` until it returns `200`.
- **Just after a merge request is created**, its `detailed_merge_status` is
  `preparing` and `diff_refs` is `null`, so diff endpoints can be empty or `404`.
  Poll `GET /projects/:id/merge_requests/:iid` until `diff_refs` is set before
  reading diffs or posting comments on specific lines.

Poll briefly (every 0.5–1 s, giving up after about 30 s) rather than using fixed sleeps.

### Deleting a project

Deletion takes two steps. The first `DELETE` only *schedules* deletion and
renames the project to `<path>-deletion_scheduled-<id>`. That frees the
original name, but the project still shows up in listings. To remove it
completely, delete again with the *new* path:

```sh
curl -X DELETE -H "PRIVATE-TOKEN: $T" "$API/projects/$ID"
curl -X DELETE -H "PRIVATE-TOKEN: $T" -G "$API/projects/$ID" \
  --data-urlencode permanently_remove=true \
  --data-urlencode "full_path=root/it-demo-deletion_scheduled-$ID"
```

The second call fails with ``full_path` is incorrect`` if you pass the original
path. If cleanup gets messy, run `npm run gitlab:reset`.

## Overrides

Set these in the environment before any `gitlab:*` command. Use the same values
every time you run the commands, because ports and the version are read at
each `up`.

| Variable | Default | Notes |
| --- | --- | --- |
| `GITLAB_VERSION` | `19.5.3-ce.0` | Image tag. Bump on purpose, then `reset`. |
| `GITLAB_HTTP_PORT` | `8929` | Also changes the URL GitLab uses in links it generates. |
| `GITLAB_SSH_PORT` | `2424` | |
| `GITLAB_ROOT_PASSWORD` | `prwb-Local-Test-2026!` | Only applied on first boot; `reset` to change it. |
| `PRWB_GITLAB_TOKEN` | `glpat-prwb-local-test-token` | At least 20 characters; re-run `bootstrap` after changing it. |

If you change the port or token, export `GITLAB_URL` / `GITLAB_TOKEN` to match
for the tests.

## Troubleshooting

- **`up` takes a long time the first time.** That's normal: the image is
  pulled once, then GitLab sets up its database. Watch progress with
  `gitlab/gitlab.sh logs`. It gives up after 15 minutes.
- **Connection reset / `502` right after starting.** GitLab isn't ready yet.
  Use `gitlab:up`, which waits until it is ready, rather than `docker compose up -d`.
- **`401 Unauthorized`.** The token doesn't exist (for example after a `reset`).
  Run `npm run gitlab:bootstrap`.
- **Root password doesn't work.** It was set by an earlier first boot with a
  different value. Run `reset`.
- **Can't delete `gitlab/volumes/`.** The files belong to users inside the
  container. Use `npm run gitlab:reset` instead of `rm -rf`.
- **The token expires** after 364 days. Re-running `bootstrap` renews it.
