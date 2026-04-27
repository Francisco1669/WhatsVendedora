# Multi-instance WhatsApp Manager (EvoAPI Cloud / Evolution API)

Backend Node.js para gerenciar 6 a 8 instancias de WhatsApp sem misturar a origem das mensagens.

Agora o backend inclui autenticacao JWT para uso administrativo da dona, com supervisao centralizada das conversas das vendedoras.

## Como o problema de origem e resolvido

1. Cada numero/dispositivo e cadastrado como uma `instance` local com:
   - `id` interno
   - `phoneNumber` (numero dono da sessao)
   - `evolutionInstance` (nome da instancia no Evolution)
   - `webhookToken` exclusivo
2. Cada instancia recebe webhook exclusivo em:
   - `/webhooks/evolution/:instanceId`
3. Toda mensagem recebida e persistida com `originTag = instanceId:phoneNumber`.
4. Consultas e envios sempre exigem `instanceId`, evitando mistura entre numeros.

## Stack

- Node.js + Express
- EvoAPI Cloud ou Evolution API v2 self-hosted
- SQLite (`better-sqlite3`) para auditoria local

## Setup

1. Copie `.env.example` para `.env`.
2. Ajuste as variaveis:

Para EvoAPI Cloud:

```env
PORT=3333
EVOAPICLOUD_API_URL=https://your-evoapicloud-server-url
EVOAPICLOUD_API_KEY=change-me
PUBLIC_WEBHOOK_BASE_URL=https://your-public-backend-url
DB_PATH=./data/multi-instance.db
AUTH_JWT_SECRET=change-this-secret
AUTH_JWT_EXPIRES_IN=12h
OWNER_BOOTSTRAP_NAME=Dona
OWNER_BOOTSTRAP_EMAIL=dona@empresa.com
OWNER_BOOTSTRAP_PASSWORD=change-this-password
```

O app tambem aceita os aliases antigos `EVOLUTION_API_URL`,
`EVOLUTION_API_KEY` e `EVOLUTION_GLOBAL_WEBHOOK_SECRET`, para manter
compatibilidade com configuracoes locais ja existentes.

Na primeira inicializacao, se `OWNER_BOOTSTRAP_EMAIL` e `OWNER_BOOTSTRAP_PASSWORD` estiverem definidos, a conta administrativa da dona e criada automaticamente.

3. Instale dependencias:

```bash
npm install
```

4. Rode em desenvolvimento:

```bash
npm run dev
```

## Rodar tudo localmente

Com Docker Desktop instalado e aberto:

```powershell
npm run local
```

Esse comando sobe a Evolution API local pelo `docker-compose.evolution.yml`
e inicia o backend em `http://localhost:3333`.

Se preferir subir por etapas:

```powershell
npm run evolution:up
npm run dev
```

## Subir Evolution com Docker (local)

1. Defina variaveis para o `docker-compose.evolution.yml` no terminal (PowerShell):

```powershell
$env:EVOLUTION_API_KEY = "troque-por-uma-chave-forte"
$env:EVOLUTION_WEBHOOK_GLOBAL_URL = "http://host.docker.internal:3333/webhooks/evolution"
$env:EVOLUTION_WEBHOOK_GLOBAL_ENABLED = "true"
```

2. Suba a Evolution:

```powershell
docker compose -f docker-compose.evolution.yml up -d
```

3. Configure seu `.env` do app com a mesma chave:

```env
EVOLUTION_API_URL=http://127.0.0.1:8080
EVOLUTION_API_KEY=troque-por-uma-chave-forte
PUBLIC_WEBHOOK_BASE_URL=http://host.docker.internal:3333
EVOLUTION_WEBHOOK_GLOBAL_URL=http://host.docker.internal:3333/webhooks/evolution
EVOLUTION_WEBHOOK_GLOBAL_ENABLED=true
```

4. Suba o app:

```powershell
npm run dev
```

5. No painel (`/panel`), clique em `Conectar` na vendedora para gerar QR.

Observacoes:

- Cada instancia da Evolution representa uma vendedora (1 numero por instancia).
- O backend cria webhooks por instancia automaticamente ao cadastrar/provisionar.
- Se `docker compose` falhar por variaveis diferentes da sua versao, ajuste `docker-compose.evolution.yml`.
- Para EvoAPI Cloud, nao use o `docker-compose.evolution.yml`; configure `EVOAPICLOUD_API_URL`, `EVOAPICLOUD_API_KEY` e uma `PUBLIC_WEBHOOK_BASE_URL` HTTPS publica.

## Painel amigavel da dona

Abra no navegador:

- `http://localhost:3333/panel`

O painel web traz:

- login da dona via JWT
- cadastro de vendedora (instancia), edicao e exclusao
- acao de conectar WhatsApp por QR code para cada vendedora
- lista de vendedoras/instancias com busca
- leitura de mensagens por instancia sem mistura de origem
- envio da resposta pela instancia correta
- resumo de atividade e trilha de auditoria

Observacao: para o login funcionar, configure no `.env` os campos `AUTH_JWT_SECRET`,
`OWNER_BOOTSTRAP_EMAIL` e `OWNER_BOOTSTRAP_PASSWORD`.

## Endpoints principais

## Autenticacao

### 0) Login da dona

`POST /auth/login`

```json
{
  "email": "dona@empresa.com",
  "password": "change-this-password"
}
```

Resposta:

```json
{
  "tokenType": "Bearer",
  "accessToken": "...",
  "expiresIn": "12h",
  "user": {
    "id": 1,
    "name": "Dona",
    "email": "dona@empresa.com",
    "role": "owner"
  }
}
```

Use o token em todas as rotas administrativas:

- `Authorization: Bearer <accessToken>`

`/health` e `/webhooks/evolution/:instanceId` continuam publicos (webhook ainda exige token de instancia).

### 1) Cadastrar/provisionar instancia

`POST /api/instances`

```json
{
  "id": "suporte-sp-01",
  "label": "Suporte Sao Paulo",
  "phoneNumber": "+5511999990001",
  "evolutionInstance": "suporte_sp_01"
}
```

Resposta inclui `webhookToken` da instancia (guarde em segredo).

Observacao: no produto, cada vendedora e representada por uma `instance` de WhatsApp.
Logo, cadastrar vendedora = cadastrar instancia.

### 1.1) Editar vendedora/instancia

`PATCH /api/instances/:instanceId`

Payload parcial (envie apenas o que deseja alterar):

```json
{
  "label": "Vendedora SP - Atualizada",
  "phoneNumber": "+5511999990001",
  "evolutionInstance": "vendedora_sp_01",
  "active": true
}
```

### 1.2) Excluir vendedora/instancia (hard delete)

`DELETE /api/instances/:instanceId`

Importante: essa operacao remove a instancia e tambem historico vinculado
(mensagens e auditorias dessa instancia).

### 1.3) Desativar sem excluir (opcional)

`POST /api/instances/:instanceId/deactivate`

Mantem dados no banco, mas desativa a instancia (`active=false`, `status=inactive`).

### 2) Listar instancias

`GET /api/instances`

### 3) Solicitar QR de conexao

`POST /api/instances/:instanceId/connect`

### 4) Enviar mensagem saindo da instancia correta

`POST /api/instances/:instanceId/send`

```json
{
  "to": "5511999991111",
  "text": "Oi! Mensagem enviada pela instancia certa."
}
```

### 5) Receber webhook

`POST /webhooks/evolution/:instanceId`

Use header:

- `x-webhook-token: <token-da-instancia>`

Tambem sao aceitos `apikey` com a chave da Evolution ou `token` na query
quando voce configurar `EVOLUTION_GLOBAL_WEBHOOK_SECRET`.

Para webhook global da Evolution, tambem e aceito:

`POST /webhooks/evolution`

Nesse formato o payload precisa trazer `instance` ou `instanceName`
correspondente ao cadastro local, ou o header `x-evolution-instance`.

### 6) Consultar mensagens por instancia

`GET /api/instances/:instanceId/messages?limit=50&offset=0`

Filtro incremental opcional:

`GET /api/instances/:instanceId/messages?receivedAfter=2026-04-16T00:00:00.000Z&limit=50&offset=0`

### 7) Consultar tudo com filtros

`GET /api/messages?instanceId=suporte-sp-01`

`GET /api/messages?originTag=suporte-sp-01:+5511999990001`

`GET /api/messages?receivedAfter=2026-04-16T00:00:00.000Z&limit=100&offset=0`

`GET /api/messages/origins`

### 8) Resumo de supervisao das vendedoras

`GET /api/seller-summary`

Retorna consolidado por instancia/vendedora com:

- status da conexao
- total inbound/outbound
- volume inbound nas ultimas 24h
- ultimo inbound e ultimo outbound

### 9) Auditoria administrativa

`GET /api/audit?limit=50&offset=0`

Filtros opcionais:

- `adminUserId`
- `instanceId`

## Escalando para 6-8 numeros

- Cadastre cada numero como uma instancia separada.
- Configure um webhook exclusivo por instancia (feito automaticamente ao provisionar).
- Nunca envie mensagens sem `instanceId`.
- Consuma dados por `originTag` ou `instanceId` no seu painel/CRM.

## Fluxo para painel da dona

1. Login em `POST /auth/login`.
2. Listar origens em `GET /api/messages/origins`.
3. Abrir conversa por vendedora em `GET /api/instances/:instanceId/messages`.
4. Responder pela instancia certa em `POST /api/instances/:instanceId/send`.
5. Acompanhar indicadores em `GET /api/seller-summary`.
6. Auditar operacoes em `GET /api/audit`.

## Observacoes

- O cliente Evolution usa fallback de endpoints para suportar variacoes entre versoes.
- Se sua versao usar rotas diferentes, ajuste apenas `src/services/evolution-client.js`.
