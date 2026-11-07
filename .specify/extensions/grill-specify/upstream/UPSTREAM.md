# Upstream provenance

| Item | Value |
|------|-------|
| Upstream repository | https://github.com/yoshi1220/speckit-grill-me |
| Upstream path | `spec-kit-extension/commands/with-docs.md` |
| Upstream version | v1.0.1 |
| Vendored file | `upstream/with-docs.v1.0.1.md` |
| Vendored SHA-256 | `4bf0c0863c06ae847b2214e0530edf8b25fdc082215e5adc099ddc8559d7b90e` |
| Licence | MIT, see `upstream/LICENSE.upstream` |
| Recorded change | `upstream/nested-hooks.patch` |

The vendored file is upstream's command, unchanged. `commands/speckit.grill-specify.with-docs.md`
carries it between `<!-- BEGIN UPSTREAM grill v1.0.1 -->` and `<!-- END UPSTREAM -->` with
the one recorded change applied. `scripts/dev/sync-upstream.sh` rebuilds that region.

## Spec Kit release verified against

Spec Kit v1.1.3 (published 2026-10-09), verified on 2026-10-11. The manifest requires
`>=1.1.3`.

## Updating from upstream

1. Fetch the new upstream tag's `spec-kit-extension/commands/with-docs.md`, `LICENSE` and
   the whole `spec-kit-extension/` directory (`gh api` with the raw Accept header).
2. Replace `upstream/with-docs.<version>.md`, `upstream/LICENSE.upstream` and
   `tests/fixtures/upstream-grill/` with the new copies, unchanged.
3. Re-apply or revise `upstream/nested-hooks.patch` so it applies to the new body.
4. Update the version, path and SHA-256 in the table above, and the markers' version text.
5. Run `scripts/dev/sync-upstream.sh` to rebuild the marked region.
6. Run `make test`, then `make test-live`. Never edit text between the markers by hand.
