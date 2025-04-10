#!/usr/bin/env zsh

output_dir=~/Videos/Recordings

function show_help() {
  echo "Usage: $0 [start|stop] [--copy|-c]"
  echo "  start        Start recording a selected screen area."
  echo "  stop         Stop the ongoing recording."
  echo "  --copy, -c   Copy the recording file to the clipboard (only with 'start')."
  exit 0
}

function start_recording() {
  mkdir -p "$output_dir"

  local filename=$(date +"%Y-%m-%d_%H-%M-%S_recording.mp4")
  local filepath="$output_dir/$filename"
  local copy_to_clipboard=false

  while [[ $# -gt 0 ]]; do
    case $1 in
      --copy|-c) copy_to_clipboard=true ;;
      *) echo "Unknown option: $1" && exit 1 ;;
    esac
    shift
  done

  local selection=$(slurp)

  if [ -z "$selection" ]; then
    echo "No area selected. Video recording canceled."
    if [ -x "$(command -v notify-send)" ]; then
      notify-send -r "344522" "Video recording canceled" "No area was selected."
    fi
    exit 1
  fi

  echo "Recording video to $filepath."

  wf-recorder -g "$selection" -f "$filepath" --codec libx264 &
  local pid=$!

  echo "Recording started with PID: $pid."

  wait $pid

  if [ $? -eq 0 ]; then
    if [ -x "$(command -v notify-send)" ]; then
      notify-send -r "344522" "Recording saved" "$filepath"
    fi

    if $copy_to_clipboard; then
      if [ -x "$(command -v wl-copy)" ]; then
        wl-copy < "$filepath"
        echo "Recording filepath copied to clipboard."
        if [ -x "$(command -v notify-send)" ]; then
          notify-send -r "344522" "Recording filepath copied to clipboard" "$filepath"
        fi
      else
        echo "wl-copy is not installed. Install it with 'sudo pacman -S wl-clipboard'."
        exit 1
      fi
    fi
  else
    echo "wf-recorder failed to record video."
    if [ -x "$(command -v notify-send)" ]; then
      notify-send -r "344522" "Recording failed" "wf-recorder encountered an error."
    fi
    exit 1
  fi
}

function stop_recording() {
  local pid=$(pgrep -x wf-recorder)
  if [[ -n "$pid" ]]; then
    kill -SIGTERM "$pid" 2>/dev/null
    if [ $? -eq 0 ]; then
      echo "Recording process (PID: $pid) stopped."
      if [ -x "$(command -v notify-send)" ]; then
        notify-send -r "344522" "Recording stopped" "Recording process was terminated."
      fi
    else
      echo "Failed to stop recording process (PID: $pid)."
    fi
  else
    echo "No active recording found."
  fi
}

if [[ $# -lt 1 ]]; then
  show_help
fi

case $1 in
  start)
    shift
    start_recording "$@"
    ;;
  stop)
    stop_recording
    ;;
  *)
    show_help
    ;;
esac
