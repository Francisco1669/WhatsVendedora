# Deploy em VPS (Guia Completo para Iniciantes)

Este guia foi feito para quem sabe pouco de infra e quer colocar o sistema em producao com o menor custo possivel.

Objetivo final:
- VPS Linux rodando containers Docker
- Dominio `.com.br` no Registro.br
- HTTPS automatico com Caddy
- Backup diario do banco

---

## 0) Visao geral (o que voce vai fazer)

1. Comprar dominio no Registro.br
2. Comprar VPS Linux na Hostinger
3. Configurar DNS (Registro.br direto ou Cloudflare Free)
4. Instalar Docker na VPS
5. Subir o projeto com `docker compose`
6. Validar painel + HTTPS
7. Ativar backup diario

---

## 1) Custo minimo recomendado

Configuracao inicial recomendada:
- VPS: `2 vCPU`, `4 GB RAM`, `60-80 GB SSD/NVMe`
- SO: `Ubuntu 24.04 LTS`
- Dominio: `seunegocio.com.br`

Observacao:
- O dominio voce paga separado (Registro.br).
- Cloudflare (DNS/proxy) pode ser plano Free.

---

## 2) Comprar dominio no Registro.br

1. Acesse: `https://registro.br/`
2. Pesquise e registre seu dominio (`.com.br`).
3. Finalize pagamento.
4. Deixe aberto o painel do dominio (vai usar depois para DNS).

Voce vai precisar depois de:
- Nome do dominio (ex.: `meudominio.com.br`)

---

## 3) Comprar VPS na Hostinger (passo a passo)

1. No painel da Hostinger, contrate uma VPS Linux.
2. Escolha plano com no minimo `2 vCPU / 4 GB RAM`.
3. Sistema operacional: `Ubuntu 24.04`.
4. Defina senha root forte.
5. Conclua a criacao da VPS.
6. Copie o `IP publico` da VPS.

Depois, conecte por SSH no seu computador:

```bash
ssh root@SEU_IP_DA_VPS
```

Se SSH por senha estiver bloqueado, use a opcao de terminal web no painel da Hostinger para os primeiros comandos.

---

## 4) Configurar DNS do dominio para a VPS

Voce tem 2 formas. Recomendada para iniciantes: **usar Cloudflare Free**.

### Opcao A (recomendada): Registro.br + Cloudflare Free

1. Crie conta em `https://cloudflare.com`.
2. Clique em adicionar site e informe seu dominio.
3. Escolha plano Free.
4. Cloudflare vai mostrar 2 nameservers.
5. No Registro.br, altere os DNS do dominio para os nameservers do Cloudflare.
6. No Cloudflare, crie registros:
   - `A` para `@` apontando para o IP da VPS
   - `A` para `www` apontando para o IP da VPS
   - Proxy pode ficar `Proxied` (nuvem laranja) ou `DNS only` (cinza). Para evitar surpresa no inicio, use `DNS only`.

### Opcao B: DNS direto no Registro.br

Crie registros `A`:
- Host `@` -> IP da VPS
- Host `www` -> IP da VPS

---

## 5) Preparar a VPS (Ubuntu)

Conectado na VPS, rode:

```bash
apt update && apt upgrade -y
timedatectl set-timezone America/Sao_Paulo
apt install -y ca-certificates curl git
```

Instalar Docker:

```bash
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version
```

---

## 6) Baixar o projeto na VPS

```bash
mkdir -p /opt/mundo-variedade
cd /opt/mundo-variedade
git clone SEU_REPOSITORIO_GIT .
cp .env.production.example .env.production
```


Edite o arquivo:

```bash
nano .env.production
```

---

## 7) Preencher `.env.production` (campos obrigatorios)

Preencha no minimo com valores reais:
- `PUBLIC_DOMAIN=app.seudominio.com.br` (ou o dominio que voce vai usar)
- `ACME_EMAIL=seu-email@dominio.com`
- `POSTGRES_PASSWORD=...` (forte)
- `POSTGRES_DATABASE_URL=...`
- `EVOLUTION_DATABASE_CONNECTION_URI=...`
- `AUTH_JWT_SECRET=...` (forte)
- `OWNER_BOOTSTRAP_EMAIL=...`
- `OWNER_BOOTSTRAP_PASSWORD=...` (forte)
- `EVOLUTION_API_KEY=...` (forte)

Gerar segredos fortes (rode 3-4 vezes e use cada valor em uma chave diferente):

```bash
openssl rand -hex 32
```

Importante:
- Nao use senhas como `evolution`, `admin123` etc.
- `PUBLIC_WEBHOOK_BASE_URL` em producao com compose interno costuma ficar `http://whatsvendedora-api:3333`.

---

## 8) Subir o ambiente de producao

```bash
cd /opt/mundo-variedade
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f docker-compose.evolution.yml up -d --build
```

Ver status:

```bash
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f docker-compose.evolution.yml ps
```

Ver logs do Caddy (HTTPS):

```bash
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f docker-compose.evolution.yml logs -f caddy
```

Ver health da API:

```bash
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f docker-compose.evolution.yml exec whatsvendedora-api wget -qO- http://127.0.0.1:3333/health
```

---

## 9) Firewall minimo (obrigatorio)

Abrir somente `22`, `80`, `443`.

Se usar UFW no Ubuntu:

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

Nao exponha portas:
- `5432` (Postgres)
- `6379` (Redis)
- `8080` (Evolution API)
- `3333` (app interna, idealmente atras do Caddy)

---

## 10) Validar em producao

Checklist:
1. `https://SEU_DOMINIO/panel` abre no navegador.
2. Certificado HTTPS valido (cadeado).
3. Login com usuario bootstrap.
4. Endpoint de health responde.

Comando de logs gerais:

```bash
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f docker-compose.evolution.yml logs -f --tail=200
```

---

## 11) Rotina de deploy (atualizacao)

Quando tiver atualizacao do codigo:

```bash
cd /opt/mundo-variedade
git pull
bash scripts/deploy.sh
```

---

## 12) Backup diario do banco

Teste backup manual:

```bash
cd /opt/mundo-variedade
bash scripts/backup-postgres.sh
```

Agendar no cron (03:30 todo dia):

```bash
crontab -e
```

Adicione a linha:

```bash
30 3 * * * cd /opt/mundo-variedade && /usr/bin/bash scripts/backup-postgres.sh >> /var/log/mundo-variedade-backup.log 2>&1
```

---

## 13) Rollback rapido

Se um deploy quebrar:

1. Veja imagens disponiveis:

```bash
docker images | grep whatsvendedora-whatsvendedora-api
```

2. Ajuste temporariamente a imagem/tag anterior no `docker-compose.evolution.yml`.
3. Reaplique:

```bash
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f docker-compose.evolution.yml up -d
```

---

## 14) Quando usar Cloudflare Tunnel?

Use Tunnel apenas para homologacao temporaria sem dominio final.
Para producao final com dominio proprio, prefira:
- DNS apontando para VPS
- Caddy emitindo HTTPS automatico

---

## 15) Troubleshooting rapido

Ver containers:

```bash
docker ps -a
```

Reiniciar stack:

```bash
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f docker-compose.evolution.yml down
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f docker-compose.evolution.yml up -d --build
```

Ver logs de um servico:

```bash
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f docker-compose.evolution.yml logs -f whatsvendedora-api
```

---

## 16) Resumo direto

Sim, seu projeto esta containerizado.
Mas producao pronta nao e so "subir container".
Voce precisa de:
- dominio + DNS
- HTTPS
- firewall
- segredos fortes
- backup
- rotina de deploy

Com este guia, voce cobre tudo isso com menor custo e complexidade.
