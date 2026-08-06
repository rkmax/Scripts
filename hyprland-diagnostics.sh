#!/usr/bin/env bash
set -u

STATE_DIR="${HYPR_DIAG_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/hyprland-diagnostics}"
SNAPSHOT_DIR="$STATE_DIR/snapshots"
METRICS_FILE="$STATE_DIR/metrics.tsv"
MONITOR_LOG="$STATE_DIR/monitor.log"
COOLDOWN_FILE="$STATE_DIR/last-event"

EVENT_COOLDOWN_SECONDS="${HYPR_DIAG_EVENT_COOLDOWN_SECONDS:-7200}"
HYPR_RSS_THRESHOLD_MB="${HYPR_DIAG_HYPR_RSS_THRESHOLD_MB:-1024}"
HYPR_UNIT_THRESHOLD_MB="${HYPR_DIAG_HYPR_UNIT_THRESHOLD_MB:-0}"
GPU_MEM_THRESHOLD_MB="${HYPR_DIAG_GPU_MEM_THRESHOLD_MB:-8000}"
MPVPAPER_RSS_THRESHOLD_MB="${HYPR_DIAG_MPVPAPER_RSS_THRESHOLD_MB:-1800}"

mkdir -p "$SNAPSHOT_DIR"

import_user_graphics_env() {
    local line instance runtime_dir

    while IFS= read -r line; do
        case "$line" in
            HYPRLAND_INSTANCE_SIGNATURE=*|WAYLAND_DISPLAY=*|DISPLAY=*|XDG_CURRENT_DESKTOP=*|XDG_SESSION_TYPE=*)
                export "$line"
                ;;
        esac
    done < <(systemctl --user show-environment 2>/dev/null || true)

    runtime_dir="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
    if [[ -z "${HYPRLAND_INSTANCE_SIGNATURE:-}" && -d "$runtime_dir/hypr" ]]; then
        instance="$(find "$runtime_dir/hypr" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | head -n 1 || true)"
        [[ -n "$instance" ]] && export HYPRLAND_INSTANCE_SIGNATURE="$instance"
    fi

    if [[ -z "${WAYLAND_DISPLAY:-}" && -S "$runtime_dir/wayland-1" ]]; then
        export WAYLAND_DISPLAY="wayland-1"
    fi
}

log() {
    printf '%s %s\n' "$(date --iso-8601=seconds)" "$*" >> "$MONITOR_LOG"
}

bytes_to_mb() {
    local bytes="${1:-0}"
    [[ "$bytes" =~ ^[0-9]+$ ]] || bytes=0
    printf '%s\n' $(( (bytes + 1048575) / 1048576 ))
}

rss_mb_for_pid() {
    local pid="${1:-}"
    if [[ -n "$pid" ]] && ps -p "$pid" >/dev/null 2>&1; then
        ps -o rss= -p "$pid" | awk '{print int($1 / 1024)}'
    else
        printf '0\n'
    fi
}

rss_mb_for_name() {
    local name="$1"
    ps -C "$name" -o rss= 2>/dev/null | awk '{sum += $1} END {print int(sum / 1024)}'
}

hyprland_pid() {
    local pid
    import_user_graphics_env
    pid="$(hyprctl instances 2>/dev/null | awk '/^[[:space:]]*pid:/ {print $2; exit}')"
    if [[ -z "$pid" ]]; then
        pid="$(pgrep -nx Hyprland 2>/dev/null || true)"
    fi
    printf '%s\n' "$pid"
}

nvidia_metrics() {
    if command -v nvidia-smi >/dev/null 2>&1; then
        nvidia-smi --query-gpu=memory.used,utilization.gpu,temperature.gpu,pstate \
            --format=csv,noheader,nounits 2>/dev/null |
            awk -F, 'NR == 1 {
                gsub(/ /, "", $1); gsub(/ /, "", $2); gsub(/ /, "", $3); gsub(/ /, "", $4);
                print $1 "\t" $2 "\t" $3 "\t" $4
            }'
    else
        printf '0\t0\t0\tunknown\n'
    fi
}

collect_metrics() {
    METRIC_TS="$(date --iso-8601=seconds)"
    METRIC_BOOT_ID="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || printf 'unknown')"
    METRIC_HYPR_PID="$(hyprland_pid)"
    METRIC_HYPR_RSS_MB="$(rss_mb_for_pid "$METRIC_HYPR_PID")"

    local unit_current unit_peak
    unit_current="$(systemctl --user show wayland-wm@hyprland.desktop.service -p MemoryCurrent --value 2>/dev/null || printf '0')"
    unit_peak="$(systemctl --user show wayland-wm@hyprland.desktop.service -p MemoryPeak --value 2>/dev/null || printf '0')"
    METRIC_HYPR_UNIT_MB="$(bytes_to_mb "$unit_current")"
    METRIC_HYPR_UNIT_PEAK_MB="$(bytes_to_mb "$unit_peak")"

    METRIC_MPVPAPER_RSS_MB="$(rss_mb_for_name mpvpaper)"
    read -r METRIC_GPU_MEM_MB METRIC_GPU_UTIL METRIC_GPU_TEMP METRIC_GPU_PSTATE < <(nvidia_metrics)
    METRIC_GPU_MEM_MB="${METRIC_GPU_MEM_MB:-0}"
    METRIC_GPU_UTIL="${METRIC_GPU_UTIL:-0}"
    METRIC_GPU_TEMP="${METRIC_GPU_TEMP:-0}"
    METRIC_GPU_PSTATE="${METRIC_GPU_PSTATE:-unknown}"
    METRIC_MEM_AVAILABLE_MB="$(awk '/MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo 2>/dev/null)"
    METRIC_LOADAVG="$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
}

write_metrics_header() {
    if [[ ! -f "$METRICS_FILE" ]]; then
        printf 'timestamp\tboot_id\thypr_pid\thypr_rss_mb\thypr_unit_mb\thypr_unit_peak_mb\tmpvpaper_rss_mb\tgpu_mem_mb\tgpu_util_pct\tgpu_temp_c\tgpu_pstate\tmem_available_mb\tloadavg\n' > "$METRICS_FILE"
    fi
}

sample() {
    collect_metrics
    write_metrics_header
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$METRIC_TS" "$METRIC_BOOT_ID" "$METRIC_HYPR_PID" "$METRIC_HYPR_RSS_MB" \
        "$METRIC_HYPR_UNIT_MB" "$METRIC_HYPR_UNIT_PEAK_MB" "$METRIC_MPVPAPER_RSS_MB" \
        "$METRIC_GPU_MEM_MB" "$METRIC_GPU_UTIL" "$METRIC_GPU_TEMP" "$METRIC_GPU_PSTATE" \
        "$METRIC_MEM_AVAILABLE_MB" "$METRIC_LOADAVG" >> "$METRICS_FILE"
}

run_cmd() {
    local outfile="$1"
    shift
    {
        printf '$'
        printf ' %q' "$@"
        printf '\n'
        "$@"
        local status=$?
        printf '\n(exit %s)\n' "$status"
    } > "$outfile" 2>&1
}

run_shell() {
    local outfile="$1"
    local command="$2"
    run_cmd "$outfile" bash -lc "$command"
}

copy_hyprland_logs() {
    local target_dir="$1"
    local runtime_dir="/run/user/$(id -u)/hypr"
    local log_file instance

    if [[ -d "$runtime_dir" ]]; then
        for log_file in "$runtime_dir"/*/hyprland.log; do
            [[ -e "$log_file" ]] || continue
            instance="$(basename "$(dirname "$log_file")")"
            cp "$log_file" "$target_dir/hyprland-$instance.log"
        done
    fi
}

collect() {
    local reason="${1:-manual}"
    local safe_reason ts dir hypr_pid
    import_user_graphics_env
    safe_reason="$(printf '%s' "$reason" | tr -cs 'A-Za-z0-9._+-' '-')"
    ts="$(date +%Y%m%dT%H%M%S%z)"
    dir="$SNAPSHOT_DIR/${ts}-${safe_reason}"
    mkdir -p "$dir"

    sample
    hypr_pid="$(hyprland_pid)"

    {
        printf 'timestamp=%s\n' "$(date --iso-8601=seconds)"
        printf 'reason=%s\n' "$reason"
        printf 'boot_id=%s\n' "$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || printf 'unknown')"
        printf 'kernel=%s\n' "$(uname -a)"
        printf 'hyprland_pid=%s\n' "$hypr_pid"
        printf 'hyprland_instance_signature=%s\n' "${HYPRLAND_INSTANCE_SIGNATURE:-}"
        printf 'wayland_display=%s\n' "${WAYLAND_DISPLAY:-}"
        printf 'state_dir=%s\n' "$STATE_DIR"
    } > "$dir/metadata.txt"

    run_cmd "$dir/hyprctl-systeminfo.txt" hyprctl systeminfo
    run_cmd "$dir/hyprctl-version.txt" hyprctl version
    run_cmd "$dir/hyprctl-instances.txt" hyprctl instances
    run_cmd "$dir/hyprctl-monitors.txt" hyprctl monitors all
    run_cmd "$dir/hyprctl-clients.txt" hyprctl clients
    run_cmd "$dir/hyprctl-layers.txt" hyprctl layers
    run_cmd "$dir/hyprctl-devices.txt" hyprctl devices
    run_cmd "$dir/hyprctl-render-scheduling.txt" hyprctl getoption render:new_render_scheduling
    run_cmd "$dir/hyprctl-auto-hdr.txt" hyprctl getoption render:cm_auto_hdr
    run_cmd "$dir/hyprctl-debug-logs.txt" hyprctl getoption debug:disable_logs
    run_cmd "$dir/hyprpm-list.txt" hyprpm list

    run_cmd "$dir/systemctl-user-wayland-show.txt" systemctl --user show wayland-wm@hyprland.desktop.service
    run_cmd "$dir/systemctl-user-wayland-status.txt" systemctl --user status wayland-wm@hyprland.desktop.service --no-pager
    run_cmd "$dir/systemctl-user-mpvpaper-status.txt" systemctl --user status mpvpaper.service mpvpaper-check.timer --no-pager
    run_cmd "$dir/systemctl-user-portal-status.txt" systemctl --user status xdg-desktop-portal-hyprland.service --no-pager

    run_shell "$dir/ps-top-rss.txt" "ps -eo pid,ppid,comm,%mem,%cpu,rss,args --sort=-rss | head -80"
    run_shell "$dir/ps-hyprland-tree.txt" "if command -v pstree >/dev/null 2>&1 && [ -n '$hypr_pid' ]; then pstree -aps '$hypr_pid'; fi"
    run_shell "$dir/hyprland-proc-status.txt" "if [ -n '$hypr_pid' ] && [ -r /proc/$hypr_pid/status ]; then cat /proc/$hypr_pid/status; fi"
    run_shell "$dir/hyprland-smaps-rollup.txt" "if [ -n '$hypr_pid' ] && [ -r /proc/$hypr_pid/smaps_rollup ]; then cat /proc/$hypr_pid/smaps_rollup; fi"
    run_shell "$dir/hyprland-pmap-tail.txt" "if [ -n '$hypr_pid' ] && command -v pmap >/dev/null 2>&1; then pmap -x '$hypr_pid' | tail -80; fi"

    run_cmd "$dir/free.txt" free -h
    run_cmd "$dir/nvidia-smi.txt" nvidia-smi
    run_shell "$dir/nvidia-smi-query.txt" "nvidia-smi --query-gpu=timestamp,driver_version,name,pstate,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw --format=csv"
    run_shell "$dir/nvidia-smi-pmon.txt" "nvidia-smi pmon -c 1 || true"
    run_shell "$dir/pacman-graphics-versions.txt" "pacman -Q linux hyprland aquamarine nvidia-open-dkms nvidia-utils egl-wayland xorg-xwayland wayland mesa libglvnd mpv ffmpeg 2>/dev/null"

    run_shell "$dir/journal-kernel-2h.txt" "journalctl -b -k --since '-2 hours' --no-pager -o short-iso"
    run_shell "$dir/journal-user-2h.txt" "journalctl --user -b --since '-2 hours' --no-pager -o short-iso"
    run_shell "$dir/journal-wayland-unit.txt" "journalctl --user -b -u wayland-wm@hyprland.desktop.service --no-pager -o short-iso"
    run_shell "$dir/journal-mpvpaper-unit.txt" "journalctl --user -b -u mpvpaper.service -u mpvpaper-check.service -u mpvpaper-check.timer --no-pager -o short-iso"
    run_shell "$dir/coredumps-14d.txt" "coredumpctl list --since '-14 days' --no-pager || true"

    cp -a "$HOME/.config/hypr" "$dir/hypr-config"
    copy_hyprland_logs "$dir"

    log "collected snapshot: $dir reason=$reason"
    printf '%s\n' "$dir"
}

cooldown_active() {
    local now last
    now="$(date +%s)"
    if [[ -f "$COOLDOWN_FILE" ]]; then
        last="$(cat "$COOLDOWN_FILE" 2>/dev/null || printf '0')"
        [[ "$last" =~ ^[0-9]+$ ]] || last=0
        (( now - last < EVENT_COOLDOWN_SECONDS ))
    else
        return 1
    fi
}

check() {
    local reasons=()
    sample

    if (( METRIC_HYPR_RSS_MB >= HYPR_RSS_THRESHOLD_MB )); then
        reasons+=("hyprland-rss-${METRIC_HYPR_RSS_MB}mb")
    fi
    if (( HYPR_UNIT_THRESHOLD_MB > 0 && METRIC_HYPR_UNIT_MB >= HYPR_UNIT_THRESHOLD_MB )); then
        reasons+=("hyprland-unit-${METRIC_HYPR_UNIT_MB}mb")
    fi
    if (( METRIC_GPU_MEM_MB >= GPU_MEM_THRESHOLD_MB )); then
        reasons+=("gpu-mem-${METRIC_GPU_MEM_MB}mb")
    fi
    if (( METRIC_MPVPAPER_RSS_MB >= MPVPAPER_RSS_THRESHOLD_MB )); then
        reasons+=("mpvpaper-rss-${METRIC_MPVPAPER_RSS_MB}mb")
    fi

    if (( ${#reasons[@]} == 0 )); then
        log "sample ok hypr=${METRIC_HYPR_RSS_MB}mb unit=${METRIC_HYPR_UNIT_MB}mb mpvpaper=${METRIC_MPVPAPER_RSS_MB}mb gpu=${METRIC_GPU_MEM_MB}mb"
        return 0
    fi

    if cooldown_active; then
        log "threshold crossed during cooldown: ${reasons[*]}"
        return 0
    fi

    date +%s > "$COOLDOWN_FILE"
    collect "threshold-${reasons[*]}" >/dev/null
}

usage() {
    cat <<EOF
Usage: $(basename "$0") [check|sample|collect [reason]]

Commands:
  check             Record metrics and collect a full snapshot if thresholds are crossed.
  sample            Record one lightweight metrics row.
  collect [reason]  Collect a full diagnostic snapshot immediately.

State directory: $STATE_DIR
EOF
}

case "${1:-check}" in
    check)
        check
        ;;
    sample)
        sample
        ;;
    collect)
        shift || true
        collect "${*:-manual}"
        ;;
    *)
        usage
        exit 2
        ;;
esac
