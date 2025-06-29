#!/bin/bash

set -o pipefail          # Propagate grim/tee errors
TMP=$(mktemp --suffix .png)

hyprshot --freeze --mode=region --raw --clipboard-only \
  | tee "$TMP"           \
  | swappy -f -  || { notify-send "hyprshot failed"; exit 1; }

rm -f "$TMP"