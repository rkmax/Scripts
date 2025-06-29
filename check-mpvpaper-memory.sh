#!/bin/bash

# Configuración: límite de memoria en MB
THRESHOLD_MB=2048

# Comando a monitorear (puede ser cambiado a otro proceso)
MONITOR_COMMAND="mpvpaper"

# Obtener todos los procesos del comando especificado (puede haber varios)
rss_total_kb=$(ps -C "$MONITOR_COMMAND" -o rss= | awk '{sum += $1} END {print sum}')

# Si hay algún proceso del comando activo
if [ -n "$rss_total_kb" ] && [ "$rss_total_kb" -gt 0 ]; then
    rss_total_mb=$(( rss_total_kb / 1024 ))

    if [ "$rss_total_mb" -gt "$THRESHOLD_MB" ]; then
        echo "🚨 $MONITOR_COMMAND total RSS: ${rss_total_mb}MB > ${THRESHOLD_MB}MB. Reiniciando mpvpaper..."
        systemctl --user restart mpvpaper.service
    else
        echo "✅ $MONITOR_COMMAND total RSS: ${rss_total_mb}MB dentro del límite (${THRESHOLD_MB}MB)."
    fi
else
    echo "ℹ️ No hay procesos $MONITOR_COMMAND corriendo."
fi
