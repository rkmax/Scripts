#!/usr/bin/env bash

# Configuration
PLAYLIST_PATH="/home/rkmax/Videos/Backgrounds/playlist.m3u"
MPVPAPER_OPTS="-o 'no-audio --loop-playlist'"
DISPLAY_TARGET="*"
LOG_FILE="/home/rkmax/Development/Scripts/mpvpaper.log"

# Monitor and restart mpvpaper if it dies
while true; do
    if ! pgrep -x "mpvpaper" > /dev/null; then
        echo "$(date): mpvpaper stopped. Restarting..." >> "$LOG_FILE"
        nohup mpvpaper $MPVPAPER_OPTS "$DISPLAY_TARGET" "$PLAYLIST_PATH" >/dev/null 2>&1 &
    fi
    sleep 5
done
