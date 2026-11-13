#!/usr/bin/env bash
set -euo pipefail

DEVCONTAINER_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVCONTAINER_ROOT_DIR="${DEVCONTAINER_ROOT_DIR:-$(dirname "$DEVCONTAINER_SCRIPT_DIR")}"
export DEVCONTAINER_ROOT_DIR
ROOT_DIR="$DEVCONTAINER_ROOT_DIR"
SPECIFY_CLI_VERSION_TAG="v1.1.3"
SPECIFY_PRESET_VERSION_TAG="v1.0.0"

log() {
  echo "[setup-claude] $*"
}

die() {
  echo "[setup-claude] ERROR: $*" >&2
  exit 1
}

append_block_if_missing() {
  local marker="$1"
  local file="$2"
  local block="$3"

  if grep -Fq "$marker" "$file" 2>/dev/null; then
    return
  fi

  printf '\n%s\n' "$block" >>"$file"
}

append_if_missing() {
  local line="$1"
  local file="$2"
  grep -Fqx "$line" "$file" 2>/dev/null || echo "$line" >>"$file"
}

load_nvm() {
  export NVM_DIR="$HOME/.nvm"

  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    source "$NVM_DIR/nvm.sh"
    return 0
  fi

  log "nvm not found; skipping Node-based Claude LSP setup"
  return 1
}

enable_claude_lsp_tooling() {
  export ENABLE_LSP_TOOL=1
  append_if_missing 'export ENABLE_LSP_TOOL=1' "$HOME/.bashrc"
}

ensure_claude_official_marketplace() {
  claude plugin marketplace add anthropics/claude-plugins-official >/dev/null 2>&1 || true
}

ensure_claude_plugin_enabled() {
  local plugin_name="$1"

  enable_claude_lsp_tooling
  ensure_claude_official_marketplace

  if ! claude plugin list | grep -Fq "${plugin_name}@claude-plugins-official"; then
    claude plugin install "${plugin_name}@claude-plugins-official" --scope project
  fi

  claude plugin enable "${plugin_name}@claude-plugins-official" --scope project >/dev/null 2>&1 || true
}

# Project has PHP files if any .php files exist in apps/, excluding node_modules and vendor directories.
has_first_party_php_files() {
  find "$ROOT_DIR/apps" \
    \( -path '*/node_modules/*' -o -path '*/vendor/*' \) -prune -o \
    -type f -name '*.php' -print -quit | grep -q .
}

# Project has Python files if any .py files exist in apps/, excluding node_modules and vendor directories.
has_first_party_python_files() {
  find "$ROOT_DIR/apps" \
    \( -path '*/node_modules/*' -o -path '*/vendor/*' \) -prune -o \
    -type f -name '*.py' -print -quit | grep -q .
}

# Project has TypeScript files if any .ts or .tsx files exist in apps/, excluding node_modules and vendor directories.
has_first_party_typescript_files() {
  find "$ROOT_DIR/apps" \
    \( -path '*/node_modules/*' -o -path '*/vendor/*' \) -prune -o \
    -type f \( -name '*.ts' -o -name '*.tsx' \) -print -quit | grep -q .
}

install_claude_cli() {
  if command -v claude >/dev/null 2>&1; then
    log "Claude CLI already installed"
    return
  fi

  log "Installing Claude CLI"
  curl -fsSL https://claude.ai/install.sh | bash
}

install_uv_and_specify_cli() {
  if ! command -v uv >/dev/null 2>&1; then
    log "Installing uv"
    curl -LsSf https://astral.sh/uv/install.sh | sh
  fi

  export PATH="$HOME/.local/bin:$PATH"
  append_if_missing 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.bashrc"

  if ! command -v specify >/dev/null 2>&1; then
    log "Installing specify-cli via uv"
    uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@${SPECIFY_CLI_VERSION_TAG}
  fi
}

install_spec_kit_workspace() {
  if [[ -d "$ROOT_DIR/.specify" ]]; then
    if command -v specify >/dev/null 2>&1; then
      specify self upgrade --tag ${SPECIFY_CLI_VERSION_TAG}
    fi
    
    log "Spec Kit already initialized in the workspace root"
    return
  fi

  log "Initializing Spec Kit in the workspace root"
  cd "$ROOT_DIR"
  specify init --here --force --integration claude --script sh --ignore-agent-tools --preset lean
  specify preset add --from https://github.com/sakitA/spec-kit-preset-multi-repo-branching/archive/refs/tags/${SPECIFY_PRESET_VERSION_TAG}.zip
}

install_aikido_mcp() {
  if npm list -g @aikidosec/mcp@1.0.12 --depth=0 >/dev/null 2>&1; then
    log "Aikido MCP already installed"
    return
  fi

  log "Installing Aikido MCP server"
  npm install -g @aikidosec/mcp@1.0.12
}

configure_claude_cli_helpers() {
  log "Configuring Claude CLI shell helpers"

  local docs_glob="${CLAUDE_DOCS_GLOB:-$DEVCONTAINER_ROOT_DIR/**/docs/developer/**/*.md}"
  local helper_block
  helper_block=$(cat <<'EOF'
# >>> HD-V3 Claude helpers >>>
cdi() {
  local docs_glob="${CLAUDE_DOCS_GLOB:-__HD_DOCS_GLOB_DEFAULT__}"
  local docs_text
  docs_text="$(cat ${docs_glob} 2>/dev/null || true)"

  if [[ -n "${docs_text}" ]]; then
    claude --append-system-prompt "${docs_text}" "$@"
    return
  fi

  echo "[cdi] No docs matched ${docs_glob}; running plain claude." >&2
  claude "$@"
}

cdx() {
  if [[ $# -lt 1 ]]; then
    echo "Usage: cdx '<glob>' [claude args...]" >&2
    return 1
  fi

  local custom_glob="$1"
  shift

  local docs_text
  docs_text="$(cat ${custom_glob} 2>/dev/null || true)"

  if [[ -n "${docs_text}" ]]; then
    claude --append-system-prompt "${docs_text}" "$@"
    return
  fi

  echo "[cdx] No docs matched ${custom_glob}; running plain claude." >&2
  claude "$@"
}
# <<< HD-V3 Claude helpers <<<
EOF
)

  helper_block="${helper_block//__HD_DOCS_GLOB_DEFAULT__/${docs_glob}}"
  append_block_if_missing "# >>> HD-V3 Claude helpers >>>" "$HOME/.bashrc" "$helper_block"
  append_if_missing 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.bashrc"
}

# If apps contain .php files, install the PHP LSP plugin for Claude
install_claude_php_lsp() {
  if ! command -v claude >/dev/null 2>&1; then
    log "Claude CLI not found; skipping PHP LSP installation"
    return
  fi

  if ! has_first_party_php_files; then
    log "No PHP files found in apps/; skipping PHP LSP installation"
    return
  fi

  log "Installing Claude PHP Language Server plugin"

  if load_nvm; then
    if ! command -v intelephense >/dev/null 2>&1; then
      npm install -g intelephense
    fi

    ensure_claude_plugin_enabled php-lsp
  fi
}

# If apps contain .py files within apps/<app_name>/src/, install the Python LSP plugin for Claude
install_claude_python_lsp() {
  if ! command -v claude >/dev/null 2>&1; then
    log "Claude CLI not found; skipping Python LSP installation"
    return
  fi

  if ! has_first_party_python_files; then
    log "No Python files found in apps/; skipping Python LSP installation"
    return
  fi

  log "Installing Claude Python Language Server plugin"

  if load_nvm; then
    ensure_claude_plugin_enabled pyright-lsp
  fi
}

# If apps contain .ts or .tsx files, install the TypeScript LSP plugin for Claude
install_claude_typescript_lsp() {
  if ! command -v claude >/dev/null 2>&1; then
    log "Claude CLI not found; skipping TypeScript LSP installation"
    return
  fi

  if ! has_first_party_typescript_files; then
    log "No TypeScript files found in apps/; skipping TypeScript LSP installation"
    return
  fi

  if ! load_nvm; then
    return
  fi

  # Install TypeScript and the TypeScript Language Server globally if not already installed.
  if ! command -v tsc >/dev/null 2>&1; then
    log "Installing TypeScript and TypeScript Language Server"
    npm install -g typescript-language-server typescript
  elif ! command -v typescript-language-server >/dev/null 2>&1; then
    log "Installing TypeScript Language Server"
    npm install -g typescript-language-server
  fi

  ensure_claude_plugin_enabled typescript-lsp
}

main() {
  [[ -d "$ROOT_DIR" ]] || die "Workspace root not found: $ROOT_DIR"

  mkdir -p "$ROOT_DIR/.claude"

  install_claude_cli
  install_uv_and_specify_cli
  install_spec_kit_workspace
  install_aikido_mcp
  install_claude_typescript_lsp
  install_claude_php_lsp
  install_claude_python_lsp
  configure_claude_cli_helpers

  log "Claude setup completed"
}

main "$@"
