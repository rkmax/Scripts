#!/usr/bin/env bash

set -euo pipefail

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/streamdeck"
STATE_FILE="${SCREENSHOT_REGION_STATE_FILE:-$STATE_DIR/fixed-screenshot-region.json}"
OUTPUT_DIR="${SCREENSHOT_OUTPUT_DIR:-$HOME/Pictures/Screenshots}"
NOTIFY_ID="344521"

usage() {
  cat <<'EOF'
Usage:
  fixed-region-screenshot.sh set
  fixed-region-screenshot.sh capture

Commands:
  set      Select and save a fixed screen region for later reuse.
  capture  Capture a screenshot using the saved fixed region.
EOF
}

notify() {
  local title="$1"
  local body="${2:-}"

  if command -v notify-send >/dev/null 2>&1; then
    notify-send -r "$NOTIFY_ID" "$title" "$body"
  fi
}

require_command() {
  local command_name="$1"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is not installed." >&2
    notify "Screenshot failed" "$command_name is not installed."
    exit 1
  fi
}

read_saved_geometry() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "No saved screenshot region found." >&2
    notify "Screenshot area missing" "Use Set Area first."
    exit 1
  fi

  local geometry
  geometry="$(jq -r '.geometry // empty' "$STATE_FILE")"

  if [[ -z "$geometry" ]]; then
    echo "Saved screenshot region is invalid." >&2
    notify "Screenshot area invalid" "Saved region file does not contain geometry."
    exit 1
  fi

  if ! [[ "$geometry" =~ ^[0-9]+,[0-9]+\ [0-9]+x[0-9]+$ ]]; then
    echo "Saved screenshot geometry has an invalid format: $geometry" >&2
    notify "Screenshot area invalid" "$geometry"
    exit 1
  fi

  printf '%s\n' "$geometry"
}

save_region() {
  require_command slurp
  require_command jq

  local geometry
  geometry="$(slurp)"

  if [[ -z "$geometry" ]]; then
    echo "No area selected. Screenshot region was not saved." >&2
    notify "Screenshot area canceled" "No area was selected."
    exit 1
  fi

  mkdir -p "$STATE_DIR"

  local tmp_file
  tmp_file="$(mktemp "$STATE_DIR/fixed-screenshot-region.XXXXXX.json")"

  jq -n \
    --arg geometry "$geometry" \
    --arg saved_at "$(date --iso-8601=seconds)" \
    '{
      geometry: $geometry,
      saved_at: $saved_at
    }' > "$tmp_file"

  mv "$tmp_file" "$STATE_FILE"

  echo "Saved screenshot region: $geometry"
  notify "Screenshot area saved" "$geometry"
}

capture_region() {
  require_command grim
  require_command jq

  local geometry
  geometry="$(read_saved_geometry)"

  mkdir -p "$OUTPUT_DIR"

  local filename
  filename="$(date +"%Y-%m-%d_%H-%M-%S_saved-region.png")"
  local filepath="$OUTPUT_DIR/$filename"

  if ! grim -g "$geometry" "$filepath"; then
    echo "grim failed to capture the saved region." >&2
    notify "Screenshot failed" "grim failed to capture the saved region."
    exit 1
  fi

  echo "Saved screenshot to $filepath"
  notify "Screenshot saved" "$filepath"
}

main() {
  local command_name="${1:-}"

  case "$command_name" in
    set)
      save_region
      ;;
    capture)
      capture_region
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
