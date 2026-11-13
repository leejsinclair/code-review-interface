#!/usr/bin/env bash
set -euo pipefail

# Container-local git config: include host config, trust host-owned mounted repos
cat > "$HOME/.gitconfig.container" <<EOF
[include]
	path = $HOME/.gitconfig.host
[safe]
	directory = *
EOF

if [ -f package.json ]; then
  npm ci || npm install
fi

# Chromium for the browser tests (`npm run test:ui`); the version follows package-lock.json.
sudo "$(command -v npx)" playwright install-deps chromium \
  || echo "warning: playwright install-deps failed; browser tests may not start"
npx playwright install chromium \
  || echo "warning: playwright chromium download failed; run 'npx playwright install chromium' later"

# Secret Service for @napi-rs/keyring (`npm run dev` / `npx .`): a session D-Bus plus an
# unlocked gnome-keyring. The keyring is ephemeral: credentials must be re-entered after a rebuild.
# shellcheck disable=SC2016
KEYRING_BLOCK='# >>> prwb keyring >>>
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && command -v dbus-launch >/dev/null 2>&1; then
  eval "$(dbus-launch --sh-syntax)"
  eval "$(printf "" | gnome-keyring-daemon --unlock --components=secrets 2>/dev/null | sed "s/^/export /")"
fi
# <<< prwb keyring <<<'
grep -Fq '# >>> prwb keyring >>>' "$HOME/.bashrc" 2>/dev/null || printf '\n%s\n' "$KEYRING_BLOCK" >> "$HOME/.bashrc"

export PATH="$HOME/.local/bin:$PATH"
echo "node:    $(node --version)"
echo "npm:     $(npm --version)"
echo "git:     $(git --version)"
echo "python3: $(python3 --version)"
echo "claude:  $(claude --version 2>/dev/null || echo 'not available')"
echo "specify: $(specify --version 2>/dev/null || echo 'not available')"
echo "docker:  $(docker --version 2>/dev/null || echo 'not available')"
echo "projects: $(ls "${PROJECTS_ROOT:-/workspaces/projects}" 2>/dev/null | wc -l) entries"
