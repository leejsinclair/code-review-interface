#!/usr/bin/env bash
# Writes or refreshes the grilled-on label in a spec and changes nothing else in it.
# Bash 3.2 compatible.
#
#   grill-label.sh --spec <spec.md> --state stopped --open <n> [--date YYYY-MM-DD]
#   grill-label.sh --spec <spec.md> --state complete [--date YYYY-MM-DD]
#
# Exit status: 0 label written (prints the label line); 2 bad arguments, nothing written;
# 3 spec missing, not writable or without a **Status**: line, nothing written.

spec=""
state=""
open_count=""
date_value=""
have_open=0

fail_args() { echo "grill-label: $1" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --spec|--state|--open|--date)
      [ $# -ge 2 ] || fail_args "$1 needs a value"
      case "$1" in
        --spec) spec="$2" ;;
        --state) state="$2" ;;
        --open) open_count="$2"; have_open=1 ;;
        --date) date_value="$2" ;;
      esac
      shift 2 ;;
    *) fail_args "unknown argument: $1" ;;
  esac
done

[ -n "$spec" ] || fail_args "--spec is required"
case "$state" in
  complete) [ "$have_open" -eq 0 ] || fail_args "--open is not allowed with --state complete" ;;
  stopped)
    [ "$have_open" -eq 1 ] || fail_args "--open is required with --state stopped"
    case "$open_count" in
      ''|*[!0-9]*) fail_args "--open must be a whole number of 0 or more" ;;
    esac
    ;;
  *) fail_args "--state must be stopped or complete" ;;
esac
if [ -n "$date_value" ]; then
  case "$date_value" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
    *) fail_args "--date must be YYYY-MM-DD" ;;
  esac
else
  date_value="$(date +%Y-%m-%d)"
fi

if [ ! -f "$spec" ] || [ ! -r "$spec" ] || [ ! -w "$spec" ]; then
  echo "grill-label: spec not found or not writable: $spec" >&2
  exit 3
fi
if ! grep -q '^\*\*Status\*\*:' "$spec"; then
  echo "grill-label: no **Status**: line in $spec" >&2
  exit 3
fi

if [ "$state" = "complete" ]; then
  label="**Grilled on**: $date_value"
else
  if [ "$open_count" = "1" ]; then word="point"; else word="points"; fi
  label="**Grilled on**: $date_value (stopped early, $open_count $word open)"
fi

tmp="$(mktemp "$(dirname "$spec")/.grill-label.XXXXXX")" || exit 3
if grep -q '^\*\*Grilled on\*\*:' "$spec"; then
  # Replace the first label in place and drop any further ones.
  awk -v label="$label" '
    /^\*\*Grilled on\*\*:/ { if (!seen) { print label; seen = 1 } ; next }
    { print }
  ' "$spec" > "$tmp"
else
  # Insert one blank line plus the label, followed by one blank line, under Status.
  awk -v label="$label" '
    !done && /^\*\*Status\*\*:/ {
      print
      if ((getline nextline) > 0) {
        if (nextline == "") { print ""; print label; print "" }
        else { print ""; print label; print ""; print nextline }
      } else { print ""; print label }
      done = 1
      next
    }
    { print }
  ' "$spec" > "$tmp"
fi
if ! cat "$tmp" > "$spec.grill-new" 2>/dev/null || ! mv "$spec.grill-new" "$spec"; then
  rm -f "$tmp" "$spec.grill-new"
  exit 3
fi
rm -f "$tmp"
printf '%s\n' "$label"
exit 0
