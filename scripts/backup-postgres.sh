#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/mundo-variedade}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.evolution.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
APP_ENV_FILE="${APP_ENV_FILE:-$ENV_FILE}"
BACKUP_DIR="${BACKUP_DIR:-/opt/mundo-variedade/backups}"
RETENTION_DAILY="${RETENTION_DAILY:-7}"
RETENTION_WEEKLY="${RETENTION_WEEKLY:-4}"

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"
cd "$PROJECT_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DAILY_FILE="$BACKUP_DIR/daily/evolution-$TIMESTAMP.sql.gz"

APP_ENV_FILE="$APP_ENV_FILE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T evolution-postgres \
  sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "$DAILY_FILE"

find "$BACKUP_DIR/daily" -type f -name '*.sql.gz' -mtime +"$RETENTION_DAILY" -delete

# Mantem backup semanal (domingo) separado
if [[ "$(date +%u)" == "7" ]]; then
  WEEKLY_FILE="$BACKUP_DIR/weekly/evolution-weekly-$TIMESTAMP.sql.gz"
  cp "$DAILY_FILE" "$WEEKLY_FILE"
fi

find "$BACKUP_DIR/weekly" -type f -name '*.sql.gz' -mtime +"$((RETENTION_WEEKLY * 7))" -delete

echo "Backup criado: $DAILY_FILE"
