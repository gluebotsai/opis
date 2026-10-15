# Redis live presence (MVP)

Hot path for **Live Users** and **Online now** on the dashboard. ClickHouse remains the source for reports and history.

**Live Users `current_page`:** always from **ClickHouse** (`getLive` — latest `fact_page_views` / staging `page_view` per session and visitor). Redis is not used for the path on `/api/analytics/live` (even when `REDIS_URL` is set). SSE may still update last-activity for commerce widgets; the dashboard poll owns the page column.

**If `REDIS_URL` is unset or commented out:** api-node serves `/api/analytics/live` from **ClickHouse only** (`presence_source: clickhouse`, `live_stream_available: false`). The dashboard polls every few seconds (see `VITE_LIVE_USERS_REFRESH_MS` / `_FALLBACK`). SSE `/api/analytics/live/stream` is not used until Redis is configured.

## Architecture (typical QA)

| Server | Role |
|--------|------|
| **nlp-crm** (app) | ingest + api-node read/write `REDIS_URL` |
| **82.113.92.44** (or dedicated Redis host) | Redis only |

```text
ingest (nlp-crm)  --write-->  Redis:6379
api-node (nlp-crm) --read-->  Redis:6379  (fallback: ClickHouse getLive)
```

## DevOps checklist (Redis host)

Run on the **Redis server** (not the app server):

1. Install and start: `apt install redis-server` → `systemctl enable --now redis-server`
2. `/etc/redis/redis.conf`:
   - `port 6379`
   - `requirepass <strong-password>`
   - Remote from app server: `bind 0.0.0.0` **or** private IP — **not** `bind 127.0.0.1` only
   - `protected-mode yes`
3. Firewall: allow **inbound TCP 6379 only from nlp-crm’s IP** (app team sends `curl -s ifconfig.me` from nlp-crm)
4. On Redis host: `ss -tlnp | grep 6379` and `redis-cli -a '<password>' ping` → `PONG`

Hand this section to infra if the app team gets **Connection refused** from nlp-crm.

## Install Redis locally (same host as app)

When ingest and api-node run on **one** machine and Redis is local:

```bash
sudo apt update
sudo apt install -y redis-server
sudo systemctl enable --now redis-server
redis-cli ping   # PONG
```

Use `bind 127.0.0.1 ::1` in `/etc/redis/redis.conf` when Redis is local only.

## Remote Redis (app on nlp-crm, Redis on another host)

1. DevOps completes checklist above on Redis host (e.g. **82.113.92.44**).
2. From **nlp-crm** (project root):

   ```bash
   bash scripts/verify_redis_live.sh
   # or explicitly:
   redis-cli -h 82.113.92.44 -p 6379 -a '<password>' ping
   ```

   Must print **`PONG`**. Plain `redis-cli ping` on nlp-crm only tests **local** Redis, not remote.

3. Set `.env` on **nlp-crm** (never commit):

   ```env
   REDIS_URL=redis://:YOUR_PASSWORD@82.113.92.44:6379
   LIVE_PRESENCE_ENABLED=true
   LIVE_PRESENCE_TTL_SECONDS=300
   ```

   URL-encode `@` in passwords as `%40` (e.g. `qaR3d15%409244`).

4. Restart **ingest** and **api-node**.

## Environment

Set in project root `.env` (ingest and api-node load it):

```env
# Local Redis (app + Redis same host)
REDIS_URL=redis://127.0.0.1:6379

# Remote Redis (example — use your host and encoded password)
# REDIS_URL=redis://:qaR3d15%409244@82.113.92.44:6379

REDIS_CACHE_TTL_SECONDS=120
LIVE_PRESENCE_ENABLED=true
LIVE_PRESENCE_TTL_SECONDS=300
```

Web (optional build-time):

The dashboard reads `presence_source` from `/api/analytics/live` and polls Live Users **3 s** when `redis`, **10 s** when `clickhouse` (override via env):

```env
VITE_LIVE_USERS_REFRESH_MS=3000
VITE_LIVE_USERS_REFRESH_MS_FALLBACK=10000
VITE_DASHBOARD_REFRESH_MS=30000
```

## Manual QA checklist

1. `bash scripts/verify_redis_live.sh` → PONG on app server.
2. Start ingest, api-node, web.
3. Browse a tracked site (accept cookies if required) and trigger `page_view`.
4. `redis-cli -h <host> -a '<pass>' KEYS 'wt:live:*'` — keys for your `website_id`.
5. Dashboard Live Users updates within ~10 s.
6. `GET /api/analytics/live` (authenticated) matches the UI.
7. Stop Redis or break `REDIS_URL` — live falls back to ClickHouse `getLive` (slower, same JSON shape).

## Fallback

| Condition | Live API |
|-----------|----------|
| `REDIS_URL` set, ingest writing | Redis |
| Redis up but no keys for this site (ingest not writing) | ClickHouse |
| Redis down on read | ClickHouse |
| `LIVE_PRESENCE_ENABLED=false` | Ingest skips write; API uses Redis if available else CH |

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Connection refused from nlp-crm | Redis not running, `bind 127.0.0.1` only, or wrong host IP |
| Timeout | Firewall / security group blocking 6379 from nlp-crm |
| PONG but no `wt:live:*` keys | Ingest not restarted, wrong `.env`, or `LIVE_PRESENCE_ENABLED=false` |
| WRONGPASS | Fix `requirepass` / `REDIS_URL` encoding |

## Live Users without Redis (ClickHouse poll)

| Setting | Effect |
|---------|--------|
| No `REDIS_URL` | `/api/analytics/live` → ClickHouse (`presence_source: clickhouse`) |
| `INGEST_WRITE_MODE=kafka` | Live path waits on **Kafka consumer → CH** (slowest without Redis) |
| `INGEST_WRITE_MODE=dual` | **Kafka still receives every payload (CDP unchanged)**; ingest also writes CH by `payloadId` (consumer insert → `duplicate`, no double row) |
| `INGEST_FAST_ACK=true` | Ingest returns before CH insert finishes; Live Users updates within a few poll cycles |

**Recommended QA (CDP on Kafka, no Redis):** `INGEST_WRITE_MODE=dual`, keep Kafka consumer running, set `VITE_LIVE_USERS_REFRESH_MS=3000`.

**Best live page UX:** add `REDIS_URL` on **ingest + api-node** (sub-second path via SSE).
