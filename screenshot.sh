#!/usr/bin/env zsh

output_dir=~/Pictures/Screenshots
filename=$(date +"%Y-%m-%d_%H-%M-%S_screenshot.png")
filepath="$output_dir/$filename"

mkdir -p "$output_dir"

local copy_to_clipboard=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --copy|-c) copy_to_clipboard=true ;;
        *) echo "Unknown option: $1" && exit 1 ;;
    esac
    shift
done

selection=$(slurp)

if [ -z "$selection" ]; then
  echo "No area selected. Screenshot canceled."
  if [ -x "$(command -v notify-send)" ]; then
    notify-send "Screenshot canceled" "No area was selected."
  fi
  exit 1
fi

grim -g "$selection" "$filepath"

if [ -x "$(command -v notify-send)" ]; then
  notify-send "Screenshot saved" "$filepath"
fi

if $copy_to_clipboard; then
    if [ -x "$(command -v wl-copy)" ]; then
        wl-copy < "$filepath"
        echo "Screenshot copied to clipboard."
        if [ -x "$(command -v notify-send)" ]; then
          notify-send "Screenshot copied to clipboard" "$filepath"
        fi
    else
        echo "wl-copy is not installed. Install it with 'sudo pacman -S wl-clipboard'."
        exit 1
    fi
fi