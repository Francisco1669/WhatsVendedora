#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/mundo-variedade}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.evolution.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
APP_ENV_FILE="${APP_ENV_FILE:-$ENV_FILE}"

cd "$PROJECT_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo $ENV_FILE nao encontrado em $PROJECT_DIR"
  exit 1
fi

APP_ENV_FILE="$APP_ENV_FILE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull || true
APP_ENV_FILE="$APP_ENV_FILE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build --pull
APP_ENV_FILE="$APP_ENV_FILE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d
APP_ENV_FILE="$APP_ENV_FILE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
