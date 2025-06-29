#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────
#  lista-default-apps.sh
#  Muestra, de forma ordenada, todas las asociaciones MIME /
#  x-scheme-handler configuradas por el usuario y las vigentes
#  según xdg-mime, junto con las asociadas a nivel de sistema.
# ────────────────────────────────────────────────────────────────

set -euo pipefail

# Posibles archivos de configuración del usuario
USER_CFGS=(
  "$HOME/.config/mimeapps.list"
  "$HOME/.local/share/applications/mimeapps.list"
)

# Archivo de sistema (varía según distro)
SYS_CFG="/etc/xdg/mimeapps.list"

# Utilidades AUX
separator() { printf '\n%s\n' "────────────────────────────────────────"; }
tmpfile()   { mktemp --tmpdir "mimekeys.XXXXXXXX"; }

########################################
# 1. Asociaciones definidas por el usuario
########################################
echo "### Asociaciones configuradas por el usuario"
USR_TMP=$(tmpfile)
for CFG in "${USER_CFGS[@]}"; do
  [[ -f "$CFG" ]] || continue
  echo "  -- en $CFG"
  awk '
    /^\[/{section=$0; next}
    /^[[:space:]]*#/ {next}                                # ignora comentarios
    /^[^=]+=[^;]+/ && section~/\[(Default|Added) Applications\]/ {
        split($0,a,"="); print a[1]
    }
  ' "$CFG" | sort -u >> "$USR_TMP"

  if [[ -s "$USR_TMP" ]]; then
    while read -r key; do
      # Muestra la primera app asociada (antes del primer ';')
      app=$(grep -E "^${key}=" "$CFG" | head -n1 | cut -d= -f2 | cut -d';' -f1)
      printf "     %-38s → %s\n" "$key" "$app"
    done < <(grep -Ff "$USR_TMP" "$CFG" | cut -d= -f1 | sort -u)
  else
    echo "     (No hay entradas relevantes)"
  fi
  : > "$USR_TMP"   # vacía para próxima ronda
done
# Conserva claves para el bloque 2
awk '{print $1}' "${USR_TMP}" 2>/dev/null || true > /dev/null

########################################
# 2. Asociaciones efectivas (xdg-mime)
########################################
separator
echo "### Asociaciones efectivas (según xdg-mime)"

EFFECTIVE_TMP=$(tmpfile)
{
  # claves encontradas en los ficheros del usuario
  cat "$USR_TMP"
  # algunas muy habituales por si el usuario no las tenía listadas
  printf '%s\n' \
    x-scheme-handler/http \
    x-scheme-handler/https \
    x-scheme-handler/ftp \
    text/html \
    inode/directory
} | sort -u > "$EFFECTIVE_TMP"

while read -r mime; do
  app=$(xdg-mime query default "$mime" 2>/dev/null || true)
  [[ -n "$app" ]] && printf "%-40s → %s\n" "$mime" "$app"
done < "$EFFECTIVE_TMP"

########################################
# 3. Asociaciones de sistema (solo lectura)
########################################
separator
echo "### Asociaciones de sistema en $SYS_CFG"
if [[ -f "$SYS_CFG" ]]; then
  awk '
    /^\[/{section=$0; next}
    /^[[:space:]]*#/ {next}
    /^[^=]+=/ && section=="[Default Applications]" {
        split($0,a,"="); printf "%-40s → %s\n", a[1], a[2]
    }
  ' "$SYS_CFG"
else
  echo "   No existe $SYS_CFG (depende de la distribución)"
fi

# Limpieza de temporales
rm -f "$USR_TMP" "$EFFECTIVE_TMP"

echo -e "\n✓ Listo."
