#!/usr/bin/env zsh

output_dir=~/Videos/Recordings

function show_help() {
    echo "Usage: $0 [start|stop] [--copy|-c] [--audio] [--window]"
    echo "  start        Start recording a selected screen area."
    echo "  stop         Stop the ongoing recording."
    echo "  --copy, -c   Copy the recording file to the clipboard (only with 'start')."
    echo "  --audio      Record audio using PipeWire device output.filter-chain-975-30 (only with 'start')."
    echo "  --window     Select a window using yad + hyprctl (only with 'start')."
    exit 0
}

function find_python() {
    if [ -x "$(command -v python3)" ]; then
        echo "python3"
        return 0
    fi

    if [ -x "$(command -v python)" ]; then
        echo "python"
        return 0
    fi

    return 1
}

function select_region_slurp() {
    local selection=$(slurp)

    if [ -z "$selection" ]; then
        echo "No area selected. Video recording canceled."
        if [ -x "$(command -v notify-send)" ]; then
            notify-send -r "344522" "Video recording canceled" "No area was selected."
        fi
        return 1
    fi

    echo "$selection"
}

function select_region_window() {
    if ! command -v hyprctl >/dev/null; then
        echo "hyprctl is not installed. Install it to use window selection."
        return 1
    fi

    if ! command -v yad >/dev/null; then
        echo "yad is not installed. Install it to use window selection."
        return 1
    fi

    local py_exec
    py_exec=$(find_python) || {
        echo "python3 is required for window selection."
        return 1
    }

    local clients_json
    if ! clients_json=$(hyprctl clients -j 2>/dev/null); then
        echo "Failed to query hyprctl clients."
        return 1
    fi

    local -a yad_rows
    local geometry title class workspace
    while IFS=$'\t' read -r geometry title class workspace; do
        if [[ -n "$geometry" ]]; then
            yad_rows+=("$geometry" "$title" "$class" "$workspace")
        fi
    done < <(
        "$py_exec" -c 'import json
import sys

try:
    clients = json.load(sys.stdin)
except json.JSONDecodeError:
    sys.exit(1)

for client in clients:
    if not client.get("mapped", False):
        continue
    at = client.get("at") or []
    size = client.get("size") or []
    if len(at) < 2 or len(size) < 2:
        continue
    x, y = int(at[0]), int(at[1])
    w, h = int(size[0]), int(size[1])
    if w <= 0 or h <= 0:
        continue
    geometry = f"{x},{y} {w}x{h}"
    title = (client.get("title") or "").strip() or "<untitled>"
    class_name = (client.get("class") or "").strip()
    workspace = client.get("workspace", {}).get("name")
    if workspace is None:
        workspace = client.get("workspace", {}).get("id")
    workspace = "" if workspace is None else str(workspace)
    sys.stdout.write(f"{geometry}\t{title}\t{class_name}\t{workspace}\n")' <<< "$clients_json"
    )

    if [[ ${#yad_rows[@]} -eq 0 ]]; then
        echo "No window candidates found."
        if [ -x "$(command -v notify-send)" ]; then
            notify-send -r "344522" "Video recording canceled" "No selectable windows found."
        fi
        return 1
    fi

    local selection
    selection=$(yad --list \
        --title="Select window" \
        --column="Geometry:HD" \
        --column="Title" \
        --column="Class" \
        --column="Workspace" \
        --print-column=1 \
        --width=900 \
        --height=600 \
        "${yad_rows[@]}")
    local yad_status=$?

    if [[ $yad_status -ne 0 || -z "$selection" ]]; then
        echo "No window selected. Video recording canceled."
        if [ -x "$(command -v notify-send)" ]; then
            notify-send -r "344522" "Video recording canceled" "No window was selected."
        fi
        return 1
    fi

    echo "$selection"
}

function start_recording() {
    mkdir -p "$output_dir"

    local filename=$(date +"%Y-%m-%d_%H-%M-%S_recording.mp4")
    local filepath="$output_dir/$filename"
    local copy_to_clipboard=false
    local enable_audio=false
    local audio_device="output.filter-chain-975-30"
    local selection_method="slurp"

    while [[ $# -gt 0 ]]; do
        case $1 in
        --copy | -c) copy_to_clipboard=true ;;
        --audio) enable_audio=true ;;
        --window) selection_method="window" ;;
        *) echo "Unknown option: $1" && exit 1 ;;
        esac
        shift
    done

    local selection=""
    if [[ "$selection_method" == "window" ]]; then
        selection=$(select_region_window) || exit 1
    else
        selection=$(select_region_slurp) || exit 1
    fi

    echo "Recording video to $filepath"

    local -a wf_args=(-g "$selection" -f "$filepath" --codec libx264)
    if $enable_audio; then
        wf_args+=("--audio=$audio_device")
    fi

    wf-recorder "${wf_args[@]}" &
    local pid=$!
    trap "kill -SIGINT $pid 2>/dev/null" INT
    trap "kill -SIGTERM $pid 2>/dev/null" TERM

    echo "Recording started with PID: $pid."

    wait $pid
    local wait_status=$?
    trap - INT TERM

    if [ $wait_status -eq 0 ]; then
        if [ -x "$(command -v notify-send)" ]; then
            notify-send -r "344522" "Recording saved" "$filepath"
        fi

        if $copy_to_clipboard; then
            if [ -x "$(command -v wl-copy)" ]; then
                wl-copy <"$filepath"
                echo "Recording filepath copied to clipboard."
                if [ -x "$(command -v notify-send)" ]; then
                    notify-send -r "344522" "Recording filepath copied to clipboard" "$filepath"
                fi
            else
                echo "wl-copy is not installed. Install it with 'sudo pacman -S wl-clipboard'."
                exit 1
            fi
        fi
    elif [ $wait_status -gt 128 ]; then
        echo "Recording interrupted by user."
        exit $wait_status
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
