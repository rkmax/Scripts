#!/usr/bin/env zsh

# Configuration
PLAYLIST_PATH="/home/rkmax/Videos/Backgrounds/playlist.m3u"
MPVPAPER_OPTS="-o 'no-audio --loop-playlist'"
DISPLAY_TARGET="*"

# Error codes
readonly E_ALREADY_RUNNING=1
readonly E_MISSING_DEPS=2
readonly E_NO_PLAYLIST=3

# Check dependencies
check_dependencies() {
    if ! command -v mpvpaper >/dev/null 2>&1; then
        echo "Error: mpvpaper is not installed" >&2
        exit $E_MISSING_DEPS
    fi
}

# Function to stop mpvpaper if running
stop_mpvpaper() {
    if pgrep -x "mpvpaper" > /dev/null; then
        pkill -x "mpvpaper"
        echo "mpvpaper has been stopped."
        return 0
    else
        echo "mpvpaper is not running."
        return 1
    fi
}

# Function to start mpvpaper
start_mpvpaper() {
    # Check if playlist exists
    if [[ ! -f "$PLAYLIST_PATH" ]]; then
        echo "Error: Playlist not found at $PLAYLIST_PATH" >&2
        exit $E_NO_PLAYLIST
    fi

    # Check if already running
    if pgrep -x "mpvpaper" > /dev/null; then
        echo "Error: mpvpaper is already running." >&2
        exit $E_ALREADY_RUNNING
    fi

    # Start mpvpaper in the background
    nohup mpvpaper $MPVPAPER_OPTS "$DISPLAY_TARGET" "$PLAYLIST_PATH" > /dev/null 2>&1 &
    echo "mpvpaper started as a daemon."
}

# Show usage
show_usage() {
    cat << EOF
Usage: $(basename "$0") [OPTION]
Set animated wallpaper using mpvpaper.

Options:
  -h, --help    Show this help message
  -s, --stop    Stop running mpvpaper instance
EOF
}

# Main script
main() {
    check_dependencies

    case "$1" in
        -h|--help)
            show_usage
            exit 0
            ;;
        -s|--stop)
            stop_mpvpaper
            exit 0
            ;;
        "")
            start_mpvpaper
            ;;
        *)
            echo "Error: Unknown option '$1'" >&2
            show_usage
            exit 1
            ;;
    esac
}

main "$@"