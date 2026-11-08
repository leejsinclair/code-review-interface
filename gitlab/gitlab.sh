#!/usr/bin/env bash
# Manage the local GitLab test instance. Usage: gitlab/gitlab.sh <command>
#   up         start GitLab and wait until it reports healthy (first boot: ~3-5 min)
#   bootstrap  create the root API token tests use (idempotent)
#   down       stop GitLab, keep data
#   reset      stop GitLab and delete all data, for a clean slate
#   status     show container state
#   logs       follow GitLab logs
set -euo pipefail

cd "$(dirname "$0")"

export GITLAB_HTTP_PORT="${GITLAB_HTTP_PORT:-8929}"
# Throwaway token for a local-only instance; override to use your own.
export PRWB_GITLAB_TOKEN="${PRWB_GITLAB_TOKEN:-glpat-prwb-local-test-token}"

compose() { docker compose "$@"; }

case "${1:-}" in
  up)
    mkdir -p volumes/config volumes/logs volumes/data
    compose up -d --wait --wait-timeout 900
    echo "GitLab is up at http://localhost:${GITLAB_HTTP_PORT}"
    ;;
  bootstrap)
    compose exec -T -e PRWB_GITLAB_TOKEN gitlab \
      gitlab-rails runner "$(cat bootstrap.rb)"
    # Prove the token works against the API.
    curl -fsS -H "PRIVATE-TOKEN: ${PRWB_GITLAB_TOKEN}" \
      "http://localhost:${GITLAB_HTTP_PORT}/api/v4/user" >/dev/null
    echo "API token verified."
    echo "  GITLAB_URL=http://localhost:${GITLAB_HTTP_PORT}"
    echo "  GITLAB_TOKEN=${PRWB_GITLAB_TOKEN}"
    ;;
  down)
    compose down
    ;;
  reset)
    compose down --remove-orphans
    # Volume contents are owned by container users, so delete from inside a container.
    if [ -d volumes ]; then
      docker run --rm -v "$PWD/volumes:/v" alpine:3.22 sh -c 'rm -rf /v/* /v/.[!.]* 2>/dev/null || true'
      rmdir volumes 2>/dev/null || true
    fi
    echo "GitLab data deleted."
    ;;
  status)
    compose ps
    ;;
  logs)
    compose logs -f --tail 100
    ;;
  *)
    sed -n '2,9p' "$0"
    exit 1
    ;;
esac
