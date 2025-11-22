# Firefox Broker

Routes external links to the most recently active Firefox profile, solving Firefox's limitation of always opening links in the default profile.

## Overview

Firefox Broker is a TypeScript/Deno utility that intelligently routes URLs to the appropriate Firefox profile based on window focus history. Instead of always opening links in the default profile, it identifies which Firefox instance was most recently active and opens the link there.

## Features

- Routes URLs to most recently focused Firefox window
- Automatic profile detection from process command line arguments
- Fallback to new instance if existing Firefox can't handle the request
- Window focus management via Hyprland compositor
- File + stderr logging with env-controlled verbosity

## Requirements

- **Deno** - TypeScript runtime
- **hyprctl** - Hyprland window manager control
- **firefox** - Mozilla Firefox browser

## Installation

1. Make the script executable:
   ```bash
   chmod +x firefox-broker.ts
   ```

2. Set up as default browser handler (optional):
   ```bash
   ./install-firefox-broker.sh
   ```

## Usage

```bash
./firefox-broker.ts <URL>
```

### Environment Variables

- `FIREFOX_BROKER_DEBUG=1` - Enable debug logging (default: enabled)
- `FIREFOX_BROKER_SILENT=1` - Suppress error messages
- `FIREFOX_BROKER_DEBUG=0` - Disable debug output

### Examples

```bash
# Open URL in most recent Firefox profile
./firefox-broker.ts https://example.com

# Show help
./firefox-broker.ts --help
```

## How It Works

1. **Window Detection**: Uses `hyprctl` to get all Firefox windows with focus history
2. **Profile Detection**: Reads process command line arguments to identify profiles
3. **Target Selection**: Chooses the window with the lowest focus history ID (most recent)
4. **URL Routing**: Opens the URL in the target profile using `--new-tab`
5. **Window Focus**: Activates the Firefox window after opening the URL

## Profile Detection

The broker detects Firefox profiles by examining process command lines for:
- `-P <profile-name>` arguments
- `--profile <path>` arguments  
- Falls back to "default" profile if none found

## Notes

The broker queries Hyprland directly on each invocation; no caching is used.

## Error Handling

- Validates URLs for basic sanity (scheme or domain-like)
- Graceful fallback to new Firefox instance if existing instance fails
- Logs to `/tmp/firefox-broker-YYYY-MM-DD.log` and stderr when debug is enabled
