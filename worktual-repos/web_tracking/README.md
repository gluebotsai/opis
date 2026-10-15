# Worktual Web Analytics

Production web analytics: SDK → Python ingest → ClickHouse (MV pipeline) → **Node.js API** → React dashboard.

Auth lives in **PostgreSQL** (`worktual.public.admin_accounts` @ `10.180.0.126`); event analytics in **ClickHouse** (`web_tracking`).

**PostgreSQL is read-only** from this app (`POSTGRES_READ_ONLY=true`): API login and **ingest** both read My Accounts tables (`accounts.subscriptions`, `active_products` → `visitorAllowanceBySlot` JSON).

## Prerequisites

- Node.js 20+, Python 3.12+, Yarn (dashboard)
- Remote PostgreSQL, ClickHouse, and Redis reachable from your machine

## Quick start

```bash
cp .env.example .env
# Edit .env: set DATABASE_URL, CLICKHOUSE_HOST, REDIS_URL to your remote hosts

python scripts/apply_clickhouse_ddl.py   # once per ClickHouse server (includes dict_admin_accounts)
# Postgres column grants + ch_sync user: see postgres/ddl/README.md (DB team runs first)

python run_backend.py --all
```

| Service | Local dev | QA production |
|---------|-----------|---------------|
| Dashboard | http://localhost:7862 | https://qatracking.worktual.com |
| Analytics API | http://localhost:7861/docs | https://qatrackingapi.worktual.com/api/ |
| Ingest | http://localhost:7860/v1/tracking/nfs-ingestions | https://qatrackingapi.worktual.com/webtracking/v1/tracking/nfs-ingestions |
| AI Chat | ws://localhost:7863/ws/chat | wss://qatrackingapi.worktual.com/chat/ws/chat |
| SDK script | http://localhost:7864/dist/webtracking.min.js | https://qatracking.worktual.com/webtracking.min.js |

**Demo login:** `admin@worktual.co.uk` / `admin123` (domain **12345**)

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React, TypeScript, Vite, TanStack Query, Redux Toolkit, Ant Design, Tailwind |
| API | Node.js, Fastify, Prisma, PostgreSQL, ClickHouse, Redis |
| Ingest | Python FastAPI → ClickHouse `raw_payloads` (website check via My Accounts `visitorAllowanceBySlot`) |
| AI Chat | Python FastAPI WebSocket → ClickHouse |
| Analytics DB | ClickHouse `web_tracking` (materialized views) |
| Auth DB | PostgreSQL `worktual.public.admin_accounts` @ `10.180.0.126` |

## Documentation

- [docs/DATABASE_TABLES_RETENTION.md](docs/DATABASE_TABLES_RETENTION.md) — ClickHouse tables, TTL, pipeline
- [postgres/ddl/README.md](postgres/ddl/README.md) — Postgres view + ClickHouse dictionary rollout
- [docs/SESSION_REPLAY.md](docs/SESSION_REPLAY.md) — Session replay (rrweb record → ClickHouse → player)
- [docs/CLIENT_INTEGRATION_GUIDE.md](docs/CLIENT_INTEGRATION_GUIDE.md) — **Client-facing** script, forms, and custom events setup
- [docs/EVENTS_REFERENCE.md](docs/EVENTS_REFERENCE.md) — SDK event catalog
- [docs/CLIENT_IP_GETIP.md](docs/CLIENT_IP_GETIP.md) — visitor IP via getip.worktual.co.uk (SDK + ingest)
- [docs/PostgreSQL_Auth_Schema_DB_Team.docx](docs/PostgreSQL_Auth_Schema_DB_Team.docx) — Auth schema for DB team

## Useful scripts

| Script | Purpose |
|--------|---------|
| `python scripts/apply_clickhouse_ddl.py` | Apply ClickHouse schema + `dict_admin_accounts` dictionary |
| `python scripts/verify_clickhouse_pipeline.py` | Smoke-test MV pipeline |
| `python scripts/verify_kafka_ingest_pipeline.py --consume-one` | Verify Kafka publish → ClickHouse insert |
| `python run_backend.py --all` | Start API, ingest, AI chat, dashboard |

## Kafka ingest pipeline (optional)

By default ingest writes directly to ClickHouse (`INGEST_WRITE_MODE=direct`). To buffer through Kafka:

| Mode | Behavior |
|------|----------|
| `direct` | API → ClickHouse only (local dev default) |
| `kafka` | API → Kafka topic; Python consumer → ClickHouse |
| `dual` | Publish to Kafka **and** insert ClickHouse (QA verification) |

Configure in `.env`:

```env
INGEST_WRITE_MODE=direct
# KAFKA_BOOTSTRAP_SERVERS=192.168.13.207:9092
<!-- KAFKA_BOOTSTRAP_SERVERS=82.113.92.45:9092 -->
KAFKA_TOPIC=cdp.ingestion.webtracking
KAFKA_CLIENT_ID=webtracking-ingest
KAFKA_CONSUMER_GROUP=webtracking-ch-writer
```

Each Kafka message is `{ "payload": <enriched tracking body>, "published_at": "<ISO8601 UTC>" }`. The consumer sets ClickHouse `received_at` from `published_at`.

**Rollout:** QA with `dual` (compare Kafka lag vs `raw_payloads` row counts), then switch to `kafka`. Run the consumer alongside ingest:

```bash
python etl/run_kafka_consumer.py
# or: python run_backend.py (starts consumer when INGEST_WRITE_MODE=kafka|dual)
```

On Kafka publish failure the ingest API returns **503** (payload is not marked accepted).

**Verify end-to-end:**

```bash
# Publish to Kafka, consume inline, confirm row in raw_payloads
python scripts/verify_kafka_ingest_pipeline.py --consume-one

# Test via running ingest API (INGEST_WRITE_MODE=kafka|dual)
python scripts/verify_kafka_ingest_pipeline.py --via-api

# Live integration tests (requires KAFKA_INTEGRATION_TEST=1)
cd etl && KAFKA_INTEGRATION_TEST=1 pytest tests/test_kafka_pipeline_integration.py -v
```


Deploy on server
Pull/copy updated code
Rebuild/restart ingest if needed
Upload new web_tracking_v3.js from sdk/dist/webtracking.min.js to CDN