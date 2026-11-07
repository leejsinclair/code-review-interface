#!/usr/bin/env bash
# Reads the grill setting and prints it as one JSON object. Writes no file: no temporary
# files, no change to the setting file, output on standard output only (DC-01).
# Bash 3.2 compatible. Always exits 0.
#
#   grill-context.sh --json

CONFIG="${SPECKIT_GRILL_CONFIG:-.specify/extensions/grill-specify/grill-specify-config.yml}"

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

setting="on"
setting_source="default"
warning=""

if [ -e "$CONFIG" ]; then
  if [ ! -r "$CONFIG" ] || [ -d "$CONFIG" ]; then
    warning="Grill setting file could not be read; using on."
  else
    # First `grill:` line outside comments; drop a trailing comment, spaces and quotes.
    raw="$(sed -n -e '/^[[:space:]]*#/d' -e 's/^[[:space:]]*grill:[[:space:]]*//p' "$CONFIG" 2>/dev/null | head -n 1)"
    if [ -n "$raw" ] || grep -q '^[[:space:]]*grill:' "$CONFIG" 2>/dev/null; then
      value="$(printf '%s' "$raw" | sed -e 's/[[:space:]]*#.*$//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\\(.*\\)'\$/\\1/")"
      lowered="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
      case "$lowered" in
        on|strict|off)
          setting="$lowered"
          setting_source="config"
          ;;
        *)
          warning="Grill setting \"$value\" is not one of on, strict, off; using on."
          ;;
      esac
    fi
  fi
fi

# Interactivity, checked in this order: the switch, then the agent's own indicators.
interactive="true"
interactive_reason="no-signal"
switch="$(printf '%s' "${SPECKIT_GRILL_NONINTERACTIVE:-}" | tr '[:upper:]' '[:lower:]')"
case "$switch" in
  1|true|yes) interactive="false"; interactive_reason="switch" ;;
  0|false|no) interactive="true"; interactive_reason="switch" ;;
  *)
    case "${CLAUDE_CODE_ENTRYPOINT:-}" in
      sdk-*) interactive="false"; interactive_reason="agent" ;;
      *)
        if [ "${CLAUDE_CODE_SESSION_ATTENDED:-}" = "0" ]; then
          interactive="false"; interactive_reason="agent"
        fi
        ;;
    esac
    ;;
esac

printf '{"setting": "%s", "setting_source": "%s", "warning": "%s", "interactive": %s, "interactive_reason": "%s"}\n' \
  "$setting" "$setting_source" "$(json_escape "$warning")" "$interactive" "$interactive_reason"
exit 0
