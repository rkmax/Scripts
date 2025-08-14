#!/bin/bash

# Check if first parameter (path) is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <path> [pattern]"
    echo "  path: Directory to search recursively"
    echo "  pattern: File pattern to search (default: '*' for all files)"
    exit 1
fi

# Set the search path from first parameter
SEARCH_PATH="$1"

# Set the pattern from second parameter, default to '*' if not provided
PATTERN="${2:-*}"

# Check if the path exists
if [ ! -d "$SEARCH_PATH" ]; then
    echo "Error: Path '$SEARCH_PATH' does not exist or is not a directory"
    exit 1
fi

# Find files matching the pattern and display relative paths
find "$SEARCH_PATH" -name "$PATTERN" -type f -exec realpath --relative-to="$SEARCH_PATH" {} \;