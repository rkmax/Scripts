#!/usr/bin/env zsh

STORAGE_DIR="$HOME/.secure-clipboard"
STORAGE_FILE="$STORAGE_DIR/vault.gpg"

mkdir -p "$STORAGE_DIR"

show_help() {
    echo "Usage: secure-clipboard [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  store <name>    Store clipboard content with given name"
    echo "  list           List all stored items"
    echo "  get <name>     Retrieve item and copy to clipboard"
    echo "  remove <name>  Remove stored item"
    echo "  help           Show this help message"
    echo ""
    echo "Examples:"
    echo "  secure-clipboard store my-password"
    echo "  secure-clipboard list"
    echo "  secure-clipboard get my-password"
}

store_item() {
    local name="$1"
    if [[ -z "$name" ]]; then
        echo "Error: Name is required for store command"
        exit 1
    fi

    if ! command -v wl-paste &> /dev/null; then
        echo "Error: wl-paste is required. Install with: sudo pacman -S wl-clipboard"
        exit 1
    fi

    local clipboard_content
    clipboard_content=$(wl-paste)
    
    if [[ -z "$clipboard_content" ]]; then
        echo "Error: Clipboard is empty"
        exit 1
    fi

    if [[ -f "$STORAGE_FILE" ]]; then
        local existing_data
        existing_data=$(gpg --quiet --decrypt "$STORAGE_FILE" 2>/dev/null) || {
            echo "Error: Failed to decrypt existing vault"
            exit 1
        }
    else
        local existing_data=""
    fi

    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local new_entry="$name|$timestamp|$clipboard_content"
    
    if [[ -n "$existing_data" ]]; then
        local updated_data=$(echo "$existing_data" | grep -v "^$name|" || true)
        if [[ -n "$updated_data" ]]; then
            echo -e "$updated_data\n$new_entry"
        else
            echo "$new_entry"
        fi
    else
        echo "$new_entry"
    fi | gpg --quiet --symmetric --cipher-algo AES256 --compress-algo 2 --s2k-mode 3 --s2k-count 65011712 --output "$STORAGE_FILE"

    if [[ $? -eq 0 ]]; then
        echo "Stored '$name' securely"
    else
        echo "Error: Failed to store item"
        exit 1
    fi
}

list_items() {
    if [[ ! -f "$STORAGE_FILE" ]]; then
        echo "No items stored"
        return
    fi

    local data
    data=$(gpg --quiet --decrypt "$STORAGE_FILE" 2>/dev/null) || {
        echo "Error: Failed to decrypt vault"
        exit 1
    }

    if [[ -z "$data" ]]; then
        echo "No items stored"
        return
    fi

    echo "Stored items:"
    echo "$data" | while IFS='|' read -r name timestamp content; do
        local preview=$(echo "$content" | head -c 50)
        if [[ ${#content} -gt 50 ]]; then
            preview="$preview..."
        fi
        printf "  %-20s %s - %s\n" "$name" "$timestamp" "$preview"
    done
}

get_item() {
    local name="$1"
    if [[ -z "$name" ]]; then
        echo "Error: Name is required for get command"
        exit 1
    fi

    if [[ ! -f "$STORAGE_FILE" ]]; then
        echo "Error: No items stored"
        exit 1
    fi

    if ! command -v wl-copy &> /dev/null; then
        echo "Error: wl-copy is required. Install with: sudo pacman -S wl-clipboard"
        exit 1
    fi

    local data
    data=$(gpg --quiet --decrypt "$STORAGE_FILE" 2>/dev/null) || {
        echo "Error: Failed to decrypt vault"
        exit 1
    }

    local content
    content=$(echo "$data" | grep "^$name|" | head -1 | cut -d'|' -f3-)
    
    if [[ -z "$content" ]]; then
        echo "Error: Item '$name' not found"
        exit 1
    fi

    echo -n "$content" | wl-copy
    echo "Copied '$name' to clipboard"
}

remove_item() {
    local name="$1"
    if [[ -z "$name" ]]; then
        echo "Error: Name is required for remove command"
        exit 1
    fi

    if [[ ! -f "$STORAGE_FILE" ]]; then
        echo "Error: No items stored"
        exit 1
    fi

    local data
    data=$(gpg --quiet --decrypt "$STORAGE_FILE" 2>/dev/null) || {
        echo "Error: Failed to decrypt vault"
        exit 1
    }

    local item_exists
    item_exists=$(echo "$data" | grep "^$name|" | head -1)
    
    if [[ -z "$item_exists" ]]; then
        echo "Error: Item '$name' not found"
        exit 1
    fi

    local updated_data
    updated_data=$(echo "$data" | grep -v "^$name|")
    
    if [[ -n "$updated_data" ]]; then
        echo "$updated_data" | gpg --quiet --symmetric --cipher-algo AES256 --compress-algo 2 --s2k-mode 3 --s2k-count 65011712 --output "$STORAGE_FILE"
    else
        rm -f "$STORAGE_FILE"
    fi

    echo "Removed '$name'"
}

case "${1:-help}" in
    store)
        store_item "$2"
        ;;
    list)
        list_items
        ;;
    get)
        get_item "$2"
        ;;
    remove)
        remove_item "$2"
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo "Error: Unknown command '$1'"
        show_help
        exit 1
        ;;
esac