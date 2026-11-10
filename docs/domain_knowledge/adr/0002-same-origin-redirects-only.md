# 0002. Platform reads follow same-origin redirects only

**Status**: Accepted (2026-11-08)

**Context.** Every adapter call passes through the read-only HTTP layer, which followed any redirect. A redirect to another host would carry the credential header there, breaching constitution X.7. Platforms do send legitimate redirects, for example after a project is renamed.

**Decision.** For every platform, the read-only layer follows a redirect only when it keeps the scheme, host and port. A redirect to any other origin fails as unavailable, and the credential is never sent there.

**Considered.** Refusing every redirect: strictest, but a renamed project becomes unreadable until the reviewer reconfigures. Leaving redirects as they were: keeps an untested credential leak open.

**Consequences.** Spec 002 adds a live renamed-project test against the local GitLab and a unit test for a refused cross-origin redirect.
