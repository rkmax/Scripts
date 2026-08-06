#!/usr/bin/env bash

set -euo pipefail

notify() {
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "$@"
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

capture_region() {
  if [[ ":${XDG_CURRENT_DESKTOP:-}:" == *":Hyprland:"* ]]; then
    require_command hyprshot
    hyprshot --freeze --mode=region --raw --clipboard-only
    return
  fi

  require_command grim
  require_command slurp

  local geometry
  geometry="$(slurp)" || {
    notify "Screenshot canceled" "No area was selected."
    exit 1
  }

  if [[ -z "$geometry" ]]; then
    notify "Screenshot canceled" "No area was selected."
    exit 1
  fi

  grim -g "$geometry" -
}

require_command satty

satty_args=(--filename -)

if command -v wl-copy >/dev/null 2>&1; then
  satty_args+=(--copy-command wl-copy)
fi

capture_region \
  | satty "${satty_args[@]}" \
  || {
    notify "Screenshot failed" "Could not capture or edit the selected area."
    exit 1
  }
