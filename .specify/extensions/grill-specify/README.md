# Specify Grill

A Spec Kit extension that grills every new spec straight after `specify`, so no spec
reaches planning with unresolved ambiguity. Terms and decisions settled in the interview
are saved to the project's knowledge docs. It carries upstream
[`speckit-grill-me`](https://github.com/yoshi1220/speckit-grill-me) v1.0.1's
grill-with-docs interview, MIT licensed, and adds the automatic start.

## Install

Needs Spec Kit 1.1.3 or later and Bash (macOS or Linux).

```bash
# from a local checkout
specify extension add --dev /path/to/speckit-grill-specify

# from the tag archive
specify extension add grill-specify --from https://github.com/leejsinclair/speckit-grill-specify/archive/refs/tags/v0.1.0.zip
```

Project-level installation is all it needs: it installs nothing at user level, ships no
user-level skill or agent, and delegates to no subagent, so it works where user-level
skills and agents are blocked.

## The grill setting

One line in `.specify/extensions/grill-specify/grill-specify-config.yml`:

| Value | Effect |
|-------|--------|
| `on` (default) | Grill the new spec; the opening offers a skip choice |
| `strict` | Grill the new spec with no skip choice |
| `off` | Do not grill; the spec stays exactly as specify wrote it |

An unknown value falls back to `on` and the report carries a one-line warning. The setting
applies only to the run that follows specify; the standalone command always grills.

## What a run reports

Every run that follows specify ends with one block whose first line is one of:
`GRILL OUTCOME: completed`, `stopped early`, `skipped`, `switched off` or
`not run (no human present)`. `skipped`, `switched off` and `not run` mean no file changed.

## The grilled-on label

The grill writes `**Grilled on**: <date>` under the spec's Status line, with
`(stopped early, N points open)` while the interview is unfinished, so a reader can tell how
far a spec was grilled. Run `/speckit-grill-specify-with-docs` to resume from the open points.

## Unattended runs

With no human present the grill asks nothing, changes nothing and reports
`not run (no human present)`. It decides this from `SPECKIT_GRILL_NONINTERACTIVE`
(`1`/`true`/`yes` unattended, `0`/`false`/`no` attended) or, if that is unset, from the
agent's own non-interactive indicator.

## Clarify hooks

A run that follows specify processes no `before_clarify` or `after_clarify` hook and no
specify hook. The standalone command processes the clarify hooks as upstream does.

## Attribution

The interview is upstream's, by yoshi1220, under the MIT licence; see
`upstream/LICENSE.upstream` and `upstream/UPSTREAM.md`.

## Removal

```bash
specify extension remove grill-specify
```

Removal deletes the extension's hook registration and its two commands, and nothing else.
Specs it labelled, the Clarifications it recorded and the knowledge docs it wrote stay
exactly as they are, and other extensions' registrations are not touched. The extension
installs only into `.specify/extensions/grill-specify/` and the agent's command directory.

## Using alongside upstream grill

This extension carries upstream `speckit-grill-me` v1.0.1's grill-with-docs interview inside
its own command, so it does not need upstream installed and does not depend on it. If you
install upstream's `grill` extension too, both work: upstream's `/speckit-grill-me` and
`/speckit-grill-with-docs` stay exactly as upstream installs them, and this extension adds
`/speckit-grill-specify-with-docs` and the hook entry point `/speckit-grill-specify-auto`.
Nothing is shared or overwritten. A spec grilled by one can be grilled again by the other.
