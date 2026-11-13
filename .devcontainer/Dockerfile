FROM mcr.microsoft.com/devcontainers/typescript-node:24-bookworm

ARG INSTALL_SONAR=false
ARG SONAR_SCANNER_VERSION=6.2.1.4610

# General tooling, python for the Spec Kit hooks (.specify/events.py, specview.py), and the
# Secret Service stack (libsecret, gnome-keyring, D-Bus) that @napi-rs/keyring talks to.
# Chromium's own system libraries are installed by `playwright install-deps` in post-create.sh.
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
      git jq ripgrep unzip openssh-client ca-certificates curl xdg-utils \
      python3 python3-pip python3-yaml \
      libsecret-1-0 gnome-keyring dbus dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

# Claude Code CLI: the AI provider the workbench shells out to, and what `npm run test:live` exercises
RUN npm install -g @anthropic-ai/claude-code

# Optional: sonar-scanner (build with --build-arg INSTALL_SONAR=true)
RUN if [ "$INSTALL_SONAR" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends default-jre-headless \
      && curl -fsSL -o /tmp/sonar.zip "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-${SONAR_SCANNER_VERSION}-linux-x64.zip" \
      && unzip -q /tmp/sonar.zip -d /opt && rm /tmp/sonar.zip \
      && ln -s /opt/sonar-scanner-*/bin/sonar-scanner /usr/local/bin/sonar-scanner \
      && rm -rf /var/lib/apt/lists/*; \
    fi

USER node
