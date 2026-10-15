# QA Server Install Guide — nlp-contactcentre

Deploy the Worktual CCaaS monorepo as a **shared QA environment** (not production).

- **Repo:** `https://github.com/Worktual-vibecoding/ai_contact_centre.git`
- **Server:** `nlp-contactcentre` (root user)
- **App path:** `/opt/worktual-ccaas`
- **UI:** `https://rebuild-ccaas.worktual.com`
- **API:** `https://rebuild-ccaas-api.worktual.com`
- **Postgres:** external at `10.x.x.126` (not on this server)

**Env files (two only):**
- Backend: `/opt/worktual-ccaas/.env` (copy from `.env.example`)
- Frontend: `/opt/worktual-ccaas/apps/web/.env` (copy from `apps/web/.env.example`)

DevOps owns Nginx, DNS, and TLS — see [devops-routing-spec.md](./devops-routing-spec.md).

---

## Step 1 — System packages

```bash
apt update && apt upgrade -y
apt install -y git curl ca-certificates gnupg ufw postgresql-client
```

## Step 2 — Docker Engine + Compose plugin

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker --version
docker compose version
docker run --rm hello-world
```

## Step 3 — Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node --version
```

## Step 4 — Firewall

```bash
ufw allow OpenSSH
ufw enable
```

## Step 5 — Clone repo (HTTPS)

```bash
git config --global credential.helper store
git clone https://github.com/Worktual-vibecoding/ai_contact_centre.git /opt/worktual-ccaas
cd /opt/worktual-ccaas
```

## Step 6 — Create env files

```bash
cd /opt/worktual-ccaas
cp apps/web/.env.example apps/web/.env
nano .env
nano apps/web/.env
```

**`.env`** — fill `DATABASE_URL`, `PLATFORM_DATABASE_URL`, `JWT_SECRET`, `TOGETHER_API_KEY`, `CORS_ORIGINS=https://rebuild-ccaas.worktual.com`

**`apps/web/.env`** — set QA URLs:
```env
VITE_CC_CORE_URL=https://rebuild-ccaas-api.worktual.com
VITE_PLATFORM_SERVICE_URL=https://rebuild-ccaas-api.worktual.com
VITE_NLP_SERVICE_URL=https://rebuild-ccaas-api.worktual.com
VITE_SOCKET_URL=https://rebuild-ccaas-api.worktual.com
VITE_CALL_SERVICE_URL=https://rebuild-ccaas-api.worktual.com/call-api
```

## Step 7 — Verify Postgres

```bash
set -a && source .env && set +a
psql "$DATABASE_URL" -c 'SELECT 1'
psql "$PLATFORM_DATABASE_URL" -c 'SELECT 1'
```

## Step 8 — Database schema (one-time)

```bash
npm ci
npm run db:generate
npm run db:push
```

## Step 9 — Start Redis + Kafka

```bash
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d redis kafka
docker exec worktual-redis redis-cli ping
```

## Step 10 — Build web

```bash
npm run build -w web
```

## Step 11 — Start full stack

```bash
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d --build
docker compose -f docker/docker-compose.qa.yml ps
```

## Step 12 — Health checks

```bash
curl -f http://127.0.0.1:3000/health
curl -f http://127.0.0.1:8000/health
```

After DevOps Nginx:
```bash
curl -f https://rebuild-ccaas-api.worktual.com/health
curl -f https://rebuild-ccaas.worktual.com
```

## Every future deploy

```bash
cd /opt/worktual-ccaas
git pull origin main
npm run build -w web
docker compose -f docker/docker-compose.qa.yml --env-file .env up -d --build
```
