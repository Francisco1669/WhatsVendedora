# Deploy de Producao - VPS Ubuntu + Docker

## 1) Preparar VPS

Sistema recomendado: Ubuntu 24.04 LTS.

```bash
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone America/Sao_Paulo
sudo apt install -y ca-certificates curl gnupg
```

Instalar Docker:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

## 2) Estrutura de deploy

```bash
sudo mkdir -p /opt/mundo-variedade
sudo chown -R $USER:$USER /opt/mundo-variedade
cd /opt/mundo-variedade
```

Clone o projeto e crie `.env.production`:

```bash
cp .env.production.example .env.production
```

Preencha no minimo:

- `PUBLIC_DOMAIN`
- `ACME_EMAIL`
- `POSTGRES_PASSWORD`
- `POSTGRES_DATABASE_URL`
- `EVOLUTION_DATABASE_CONNECTION_URI`
- `AUTH_JWT_SECRET`
- `OWNER_BOOTSTRAP_EMAIL`
- `OWNER_BOOTSTRAP_PASSWORD`
- `EVOLUTION_API_KEY`

## 3) Subir stack

```bash
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f docker-compose.evolution.yml up -d --build
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f docker-compose.evolution.yml ps
```

## 4) Validar

1. DNS apontado para a VPS
2. Certificado TLS emitido pelo Caddy
3. Acesso ao painel: `https://SEU_DOMINIO/panel`
4. Health interno da API:

```bash
docker compose --env-file .env.production -f docker-compose.evolution.yml exec whatsvendedora-api wget -qO- http://127.0.0.1:3333/health
```

## 5) Operacao

Deploy padrao:

```bash
bash scripts/deploy.sh
```

Logs:

```bash
docker compose --env-file .env.production -f docker-compose.evolution.yml logs -f whatsvendedora-api
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f docker-compose.evolution.yml logs -f caddy
```

## 6) Backup e restore

Backup manual:

```bash
bash scripts/backup-postgres.sh
```

Restore:

```bash
bash scripts/restore-postgres.sh /opt/mundo-variedade/backups/daily/evolution-AAAAMMDD-HHMMSS.sql.gz
```

Cron sugerido (03:30 todo dia):

```bash
30 3 * * * cd /opt/mundo-variedade && /usr/bin/bash scripts/backup-postgres.sh >> /var/log/mundo-variedade-backup.log 2>&1
```

## 7) Rollback

1. Ver imagens disponiveis:

```bash
docker images | grep whatsvendedora-whatsvendedora-api
```

2. Ajuste temporario no `docker-compose.evolution.yml` para usar a tag anterior em `whatsvendedora-api`.
3. Reaplique:

```bash
docker compose --env-file .env.production -f docker-compose.evolution.yml up -d
```

## 8) Seguranca minima de rede

- Expor somente `80` e `443` no firewall/security group.
- Nao expor `5432`, `6379`, `8080` e `3333`.
- Usar senhas fortes e rotacionar periodicamente.

## 9) Homologacao sem dominio proprio (Cloudflare Tunnel)

Se voce quiser validar com cliente antes de pagar dominio:

1. Crie um tunnel no Cloudflare Zero Trust e copie `CLOUDFLARE_TUNNEL_TOKEN`.
2. No `.env.production`, preencha:
   - `CLOUDFLARE_TUNNEL_TOKEN`
   - `EVOLUTION_SERVER_URL` com a URL publica do tunnel
   - `CORS_ALLOWED_ORIGINS` com a mesma URL
3. Suba com compose de tunnel (sem Caddy):

```bash
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f docker-compose.evolution.yml -f docker-compose.tunnel.yml up -d --build whatsvendedora-api evolution-postgres evolution-redis evolution-api cloudflared
```

4. Verifique logs:

```bash
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f docker-compose.evolution.yml -f docker-compose.tunnel.yml logs -f cloudflared whatsvendedora-api evolution-api
```
