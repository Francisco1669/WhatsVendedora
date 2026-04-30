#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Uso: $0 /caminho/backup.sql.gz"
  exit 1
fi

BACKUP_FILE="$1"
PROJECT_DIR="${PROJECT_DIR:-/opt/mundo-variedade}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.evolution.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
APP_ENV_FILE="${APP_ENV_FILE:-$ENV_FILE}"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup nao encontrado: $BACKUP_FILE"
  exit 1
fi

cd "$PROJECT_DIR"
gunzip -c "$BACKUP_FILE" | APP_ENV_FILE="$APP_ENV_FILE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T evolution-postgres \
  sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

echo "Restore concluido com sucesso."
