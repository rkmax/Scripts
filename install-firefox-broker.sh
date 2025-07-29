#!/bin/bash
# Firefox Broker Installation Script
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_FILE="$SCRIPT_DIR/firefox-broker.desktop"
VERSION="${1:-bash}"

# Determine which version to install
if [[ "$VERSION" == "deno" ]]; then
    BROKER_SCRIPT="$SCRIPT_DIR/firefox-broker.ts"
    echo "Installing Firefox Broker (Deno version)..."
    
    # Check if Deno is installed
    if ! command -v deno >/dev/null 2>&1; then
        echo "Error: Deno is not installed. Please install Deno first."
        echo "Visit: https://deno.land/#installation"
        exit 1
    fi
else
    BROKER_SCRIPT="$SCRIPT_DIR/firefox-broker"
    echo "Installing Firefox Broker (Bash version)..."
fi

# Validate files exist
[[ -f "$BROKER_SCRIPT" ]] || { echo "Error: $BROKER_SCRIPT not found"; exit 1; }
[[ -f "$DESKTOP_FILE" ]] || { echo "Error: firefox-broker.desktop not found"; exit 1; }

# Install script to PATH
if [[ -d "$HOME/.local/bin" ]]; then
    BIN_DIR="$HOME/.local/bin"
else
    mkdir -p "$HOME/.local/bin"
    BIN_DIR="$HOME/.local/bin"
fi

if [[ "$VERSION" == "deno" ]]; then
    # For Deno version, copy the TypeScript file
    cp "$BROKER_SCRIPT" "$BIN_DIR/firefox-broker"
    # Create a shell wrapper for the Deno script
    cat > "$BIN_DIR/firefox-broker" << 'EOF'
#!/bin/bash
exec deno run --allow-all "$(dirname "$0")/firefox-broker.ts" "$@"
EOF
    cp "$BROKER_SCRIPT" "$BIN_DIR/firefox-broker.ts"
    chmod +x "$BIN_DIR/firefox-broker"
    chmod +x "$BIN_DIR/firefox-broker.ts"
else
    cp "$BROKER_SCRIPT" "$BIN_DIR/"
    chmod +x "$BIN_DIR/firefox-broker"
fi

# Install desktop file
APPS_DIR="$HOME/.local/share/applications"
mkdir -p "$APPS_DIR"
cp "$DESKTOP_FILE" "$APPS_DIR/"

# Update desktop database if available
command -v update-desktop-database >/dev/null 2>&1 && \
    update-desktop-database "$APPS_DIR" || true

# Set as default browser
if xdg-settings set default-web-browser firefox-broker.desktop 2>/dev/null; then
    echo "✓ Firefox Broker installed and set as default browser"
else
    echo "✓ Firefox Broker installed (set as default manually if needed)"
fi

echo
echo "Usage: External links will now route to your active Firefox profile"
echo "Debug: FIREFOX_BROKER_DEBUG=0 firefox-broker https://example.com"
echo
echo "To uninstall:"
if [[ "$VERSION" == "deno" ]]; then
    echo "  rm $BIN_DIR/firefox-broker $BIN_DIR/firefox-broker.ts $APPS_DIR/firefox-broker.desktop"
else
    echo "  rm $BIN_DIR/firefox-broker $APPS_DIR/firefox-broker.desktop"
fi
echo "  xdg-settings set default-web-browser firefox.desktop"
echo
echo "Installation type: $VERSION"
echo "To install a different version: $0 [bash|deno]"