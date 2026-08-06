#!/usr/bin/env bash

set -Eeuo pipefail

readonly APP_NAME="Markdown to Slack"
readonly NOTIFICATION_ID="84721"

notify() {
  local urgency="$1"
  local icon="$2"
  local title="$3"
  local body="$4"

  notify-send \
    --app-name="$APP_NAME" \
    --replace-id="$NOTIFICATION_ID" \
    --urgency="$urgency" \
    --icon="$icon" \
    "$title" \
    "$body" >/dev/null 2>&1 || true
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  notify critical dialog-error "Markdown → Slack failed" "$1"
  exit 1
}

for dependency in wl-paste pandoc copyq notify-send; do
  command -v "$dependency" >/dev/null 2>&1 || fail "Missing dependency: $dependency"
done

clipboard_types="$(wl-paste --list-types 2>/dev/null)" || \
  fail "Could not inspect the clipboard."

text_mime=""
for candidate in 'text/plain;charset=utf-8' 'text/plain' 'UTF8_STRING' 'STRING'; do
  if grep -Fxq "$candidate" <<<"$clipboard_types"; then
    text_mime="$candidate"
    break
  fi
done

[[ -n "$text_mime" ]] || fail "The clipboard does not contain text."

markdown="$(wl-paste --no-newline --type "$text_mime" 2>/dev/null)" || \
  fail "Could not read text from the clipboard."

[[ -n "${markdown//[$' \t\r\n']/}" ]] || fail "The clipboard is empty."

html="$(
  printf '%s' "$markdown" | pandoc \
    --from=gfm-raw_html \
    --to=html5 \
    --wrap=none \
    --no-highlight
)" || fail "Could not render the Markdown."

[[ -n "$html" ]] || fail "The rendered HTML is empty."

copyq copy \
  'text/plain' "$markdown" \
  'text/html' "<meta charset=\"utf-8\">$html" >/dev/null || \
  fail "Could not write rich text to the clipboard."

notify normal dialog-information "Markdown → Slack" \
  "Rich text copied to the clipboard."
