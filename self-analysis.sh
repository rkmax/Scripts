#!/usr/bin/env bash

set -euo pipefail

ANALYSIS_PROMPT=$'Analyze the following host information for suspicious or abnormal activity.\nSummarize any concerns and recommend follow-up actions.\n'
OUTPUT_DIR="${HOME}/.self-analysis"
TIMESTAMP="$(date +%Y-%m-%d.%H-%M)"
OUTPUT_FILE="${OUTPUT_DIR}/${TIMESTAMP}.md"
RG_BIN="${RG_BIN:-rg}"

mkdir -p "${OUTPUT_DIR}"

command -v codex >/dev/null 2>&1 || {
  echo "codex CLI is required but was not found in PATH." >&2
  exit 1
}

command -v "${RG_BIN}" >/dev/null 2>&1 || {
  echo "Ripgrep is required for filtering ESTAB connections." >&2
  exit 1
}

collect_data() {
  printf '%s\n\n' "${ANALYSIS_PROMPT}"

  printf '## Process list (ps aux)\n\n'
  ps aux
  printf '\n'

  printf '## Listening sockets (ss -lptun)\n\n'
  ss -lptun || true
  printf '\n'

  printf '## Established outgoing connections (sudo lsof -i -P -n | %s ESTAB)\n\n' "${RG_BIN}"
  sudo lsof -i -P -n 2>/dev/null | "${RG_BIN}" ESTAB || true
  printf '\n'

  printf '## Recent error logs (journalctl -p 3 -b)\n\n'
  journalctl -p 3 -b || true
}

collect_data | codex exec --skip-git-repo-check - | tee "${OUTPUT_FILE}"

if command -v code >/dev/null 2>&1; then
  code -n "${OUTPUT_FILE}"
else
  echo "VS Code command 'code' not found. Review the report at ${OUTPUT_FILE}." >&2
fi
