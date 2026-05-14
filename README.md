# Mundo da Variedade - WhatsApp Manager

Backend Node.js + painel web para operar instancias da Evolution API com:

- PostgreSQL (`pg`) para dados da aplicacao
- Redis + BullMQ para fila de webhooks
- JWT para autenticacao administrativa
- Retencao automatica de mensagens

## Stack atual

- Node.js 20 + Express 5
- PostgreSQL 16
- Redis 7
- Evolution API v2.3.6
- Docker Compose
- Caddy (TLS + reverse proxy em producao)

## Ambientes

- Desenvolvimento local: `.env`
- Producao: `.env.production` (nao versionado)
- Modelo de producao: `.env.production.example`

## Executar localmente

```bash
npm install
npm run evolution:up
npm run dev
```

Painel: `http://localhost:3333/panel`

## Executar em producao (VPS)

1. Copie `.env.production.example` para `.env.production` e preencha os segredos.
2. Ajuste DNS do `PUBLIC_DOMAIN` para o IP da VPS.
3. Suba com:

```bash
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f docker-compose.evolution.yml up -d --build
```

4. Verifique:

```bash
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f docker-compose.evolution.yml ps
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f docker-compose.evolution.yml logs -f caddy
```

## Homologacao sem dominio pago (Cloudflare Tunnel)

1. No Cloudflare Zero Trust, crie um Tunnel e copie o token (`CLOUDFLARE_TUNNEL_TOKEN`).
2. Preencha `.env.production` com:
   - `CLOUDFLARE_TUNNEL_TOKEN`
   - `EVOLUTION_SERVER_URL` com a URL publica do tunnel (ex.: `https://abc.trycloudflare.com`)
   - `CORS_ALLOWED_ORIGINS` com essa mesma URL
3. Suba sem Caddy:

```bash
npm run tunnel:up
```

4. Acompanhe os logs:

```bash
npm run tunnel:logs
```

5. Acesse:
   - Painel: `https://SUA_URL_DO_TUNNEL/panel`
   - Health: `https://SUA_URL_DO_TUNNEL/health`

## Seguranca aplicada

- `helmet` habilitado
- `cors` com allowlist por `CORS_ALLOWED_ORIGINS`
- Rate limit:
  - login: `RATE_LIMIT_LOGIN_*`
  - webhooks: `RATE_LIMIT_WEBHOOK_*`
- Rotas `/api/*` protegidas por JWT
- Webhooks validados por token/chave no processor

## Retencao e backup

- Retencao diaria via BullMQ (`prune-database`) usando `MESSAGE_RETENTION_DAYS`
- Scripts operacionais:
  - `scripts/deploy.sh`
  - `scripts/backup-postgres.sh`
  - `scripts/restore-postgres.sh`

## Endpoints publicos (via dominio HTTPS)

- `/panel`
- `/auth/*`
- `/api/*` (JWT)
- `/webhooks/evolution`
- `/webhooks/evolution/:instanceId`






docker compose --env-file .env.production -f docker-compose.evolution.yml -f docker-compose.tunnel.yml up -d
