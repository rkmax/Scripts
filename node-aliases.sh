#!/bin/bash

# Node process management aliases
# Add this to your ~/.bashrc or ~/.zshrc:
# source ~/Development/Scripts/node-aliases.sh

# List all Node.js processes grouped by directory
alias nodeps='/home/rkmax/Development/Scripts/node-processes.ts'

# Kill Node.js process groups interactively
alias nodekill='/home/rkmax/Development/Scripts/kill-node-group.ts'

# Kill Node.js process groups with force
alias nodekill-force='/home/rkmax/Development/Scripts/kill-node-group.ts --force'

# Usage examples:
# nodeps                    # List all Node processes grouped by directory
# nodekill                  # Interactive kill - select which groups to terminate
# nodekill 1 2             # Kill groups 1 and 2 directly
# nodekill --yes 1         # Kill group 1 without confirmation
# nodekill-force           # Force kill (SIGKILL) with interactive selection