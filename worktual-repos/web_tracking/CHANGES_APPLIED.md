# Live server — UI + Analytics changes applied

Applied on: 2026-08-23

## What was changed (code only)

### Frontend (`web/`)
- New sidebar layout (`AppShell`, `Sidebar`, `TopHeader`)
- Dashboard split: co-worker chat (left) + reports (right)
- Analytics page with diagnostic / predictive / prescriptive sections
- All main pages migrated to `AppShell`
- New KPI icons, styles, insights hook

### Backend (`api-node/`)
- `GET /api/analytics/insights` — ClickHouse aggregates + forecasts + narrative
- New files: `insightsRepository`, `forecast`, `insightsService`, `insightsNarrative`, types

### AI Chat (`AI_CHAT/`)
- `POST /insights/generate` — internal insights agent
- New `app/insights/` package + prompt

## What was NOT changed

- `.env` — your live DNS, IPs, `VITE_API_URL`, CORS, DB passwords **unchanged**
- nginx / DNS mapping
- `etl/`, `sdk/`, `clickhouse/`, `postgres/`

## After copying back to live server

**One command — full stack (recommended):**
```bash
cd ~/Web_tracking_workspace/current_setup   # or your deploy root
python run_backend.py --all                 # ingest + kafka + api + ai-chat + web
python run_backend.py --status              # check PIDs / ports
python run_backend.py --stop                # stop all services
```

Logs: `.local/logs/{ingest,api,ai-chat,web,kafka-consumer}.log`

**Backend only (no web dashboard):**
```bash
python run_backend.py                       # ingest + api + ai-chat (+ kafka if enabled)
```

**Start one or more services:**
```bash
python run_backend.py --only ingest
python run_backend.py --only kafka-consumer
python run_backend.py --only api
python run_backend.py --only ai-chat
python run_backend.py --only web
python run_backend.py --only ingest api web
```

**Run each service separately (foreground):**
```bash
python etl/run_ingest.py                    # ingest (INGEST_PORT, default 7860)
python etl/run_kafka_consumer.py            # kafka → ClickHouse (when INGEST_WRITE_MODE=kafka|dual)
cd api-node && yarn dev                     # API (API_PORT, default 7861)
cd AI_CHAT && python -m uvicorn app.main:app --host 0.0.0.0 --port 7863
cd web && yarn dev                          # dashboard (WEB_PORT, default 7862)
```

**Legacy (api + ai-chat + web only, no ingest/kafka):**
```bash
python run_service.py --all
python run_service.py --status
python run_service.py --stop
```

Logs (run_service): `.local/run_service/logs/{api-node,ai-chat,web}.log`

**Manual (if needed):**
```bash
cd api-node && yarn install && yarn build && yarn start   # or yarn dev
cd web && yarn install && yarn dev                         # restart frontend
cd AI_CHAT && python -m uvicorn app.main:app --host 0.0.0.0 --port 7863
```

## Optional: enable AI-written insights text

Add these 3 lines to your **existing** live `.env` (do not replace the file):

```env
INSIGHTS_INTERNAL_KEY=pick-a-long-random-secret
AI_CHAT_INSIGHTS_URL=http://127.0.0.1:7863/insights/generate
INSIGHTS_CACHE_TTL_SECONDS=600
```

Without these, Analytics still works using rule-based fallback text.

## Verify

1. Dashboard → new sidebar + split layout
2. Reports panel → **View Analytics** button
3. Analytics page → period pills + insights sections

## White screen on login (qatracking.worktual.co.uk)

If Vite dev runs but the public URL is a **white screen**, add your real hostname to `.env`:

```env
VITE_ALLOWED_HOSTS=qatracking.worktual.co.uk,qatracking.worktual.com,backend_qatracking,.worktual.co.uk,.worktual.com
```

Then **restart** `yarn dev` in `web/`. Vite blocks unknown Host headers from nginx.

Also confirm nginx proxies your domain → `http://127.0.0.1:7862` (not an old static folder).

---

## 502 Bad Gateway (qatracking.worktual.co.uk)

**Symptom:** nginx shows `502 Bad Gateway` but `yarn dev` looks running.

**Most common cause:** Vite started on **7863** because **7862 is already in use**, while nginx still proxies to **7862**.

Expected ports:

| Service | Port |
|---------|------|
| api-node | **7861** |
| web (Vite) | **7862** |
| AI_CHAT | **7863** |

### Fix (run on live server)

**1. See what holds the ports**
```bash
sudo ss -tlnp | grep -E '7861|7862|7863'
# or
sudo lsof -i :7862 -i :7863
```

**2. Stop the stale process on 7862** (old Vite/node from a previous terminal/screen)
```bash
# replace PID from lsof/ss
kill PID
```

**3. Confirm root `.env` has WEB_PORT** (Vite reads env from repo root, not `web/`)
```bash
grep -E 'WEB_PORT|API_PORT|VITE_ALLOWED_HOSTS' ~/Web_tracking_workspace/current_setup/.env
```
Should include:
```env
API_PORT=7861
WEB_PORT=7862
VITE_ALLOWED_HOSTS=qatracking.worktual.co.uk,qatracking.worktual.com,backend_qatracking,.worktual.co.uk,.worktual.com
```

**4. Restart services in order**
```bash
# Terminal 1 — API
cd ~/Web_tracking_workspace/current_setup/api-node
yarn dev

# Terminal 2 — Web (must show 7862, NOT 7863)
cd ~/Web_tracking_workspace/current_setup/web
yarn dev
```
You must see: `Network: http://...:7862/` — if it says 7863, port 7862 is still taken.

**5. Optional — AI Chat (separate port 7863)**
```bash
cd ~/Web_tracking_workspace/current_setup/AI_CHAT
python -m uvicorn app.main:app --host 0.0.0.0 --port 7863
```

**6. Test locally on server**
```bash
curl -I http://127.0.0.1:7862/
curl -I http://127.0.0.1:7861/health
```
Both should return HTTP 200/304 (not "Connection refused").

**7. Confirm nginx upstream**
```bash
sudo grep -r "7862\|7863\|qatracking" /etc/nginx/sites-enabled/
```
Dashboard domain should have: `proxy_pass http://127.0.0.1:7862;`

**8. Reload nginx**
```bash
sudo nginx -t && sudo systemctl reload nginx
```

### If still 502

| Check | Command |
|-------|---------|
| Vite bound to 7862? | `ss -tlnp \| grep 7862` |
| Wrong nginx target? | grep config for `.co.uk` vs `.com` |
| Vite host blocked? | Add domain to `VITE_ALLOWED_HOSTS`, restart web |
| API down? | `curl http://127.0.0.1:7861/health` |

### Keep processes running (recommended for QA)

Use `screen` or `tmux` so closing SSH does not kill dev servers:
```bash
screen -S webtracking-api
cd ~/Web_tracking_workspace/current_setup/api-node && yarn dev
# Ctrl+A then D to detach

screen -S webtracking-web
cd ~/Web_tracking_workspace/current_setup/web && yarn dev
# Ctrl+A then D to detach

screen -S webtracking-chat
cd ~/Web_tracking_workspace/current_setup/AI_CHAT
pip install -r requirements.txt   # first time only
python -m uvicorn app.main:app --host 0.0.0.0 --port 7863
# Ctrl+A then D to detach
```

---

## Co-worker chat: "I wasn't able to finish that just now"

AI_CHAT on **7863** can be healthy while the **browser still cannot connect**. Login uses api-node (7861); chat uses a WebSocket to AI_CHAT (7863).

### Quick verify (on server)

```bash
curl -s http://127.0.0.1:7863/health
# expect: {"status":"ok","service":"ai-analytics-chat"}
# Note: curl -I http://127.0.0.1:7863/ returns 404 — that is normal (no route on /)
```

### Fix (recommended): same-origin chat via Vite proxy

The dashboard now proxies **`/chat/*` → localhost:7863** in `web/vite.config.js`.  
The browser connects to **`wss://<your-dashboard-host>/chat/ws/chat`** (same host as the UI).

**On server after git pull:**

1. **Comment out or remove** `VITE_AI_CHAT_WS_URL` in root `.env` (do not use `localhost` or a separate api host unless nginx chat is configured there).

2. **Restart web** (required — Vite reads env + proxy on startup):
   ```bash
   cd ~/Web_tracking_workspace/current_setup/web && yarn dev
   ```

3. **Keep AI_CHAT running** on 7863:
   ```bash
   cd ~/Web_tracking_workspace/current_setup/AI_CHAT
   python -m uvicorn app.main:app --host 0.0.0.0 --port 7863
   ```

4. **Browser check:** DevTools → Network → WS → URL should be  
   `wss://qatracking.worktual.co.uk/chat/ws/chat` (or `.com`), **not** `localhost:7863`.

### Alternative: chat on qatrackingapi subdomain

Only if infra team configured nginx `/chat/` on `qatrackingapi.worktual.com`:
```env
VITE_AI_CHAT_WS_URL=wss://qatrackingapi.worktual.com/chat/ws/chat
```

### JWT

`API_SECRET_KEY` in root `.env` must match for api-node (login token) and AI_CHAT (WS auth).

### Optional: LLM

Returning-visitor counts use **rule-based SQL** (no LLM). Other questions may need `LLM_BASE_URL` reachable.

---

## Tracking ingest + identity port (2026-08-27)

Ported from main repo: Kafka ingest pipeline, `websiteId`/`websiteUrl`/`organizationId`, and DB migration scripts.

### What was ported

| Area | Changes |
|------|---------|
| **ETL** | `etl/kafka/*`, `INGEST_WRITE_MODE`, consumer, `org_field.py`, updated ingest service/validation |
| **SDK** | `websiteId`, `websiteUrl`, `organizationId` (camelCase); dist bundles updated |
| **ClickHouse** | `website_id` DDL + migrations `08`–`10` |
| **Postgres** | `website_id`/`website_url`, `organization_id` INTEGER migrations |
| **api-node** | Prisma schema + routes/repos using `website_id` |
| **Scripts** | `verify_kafka_ingest_pipeline.py`, `migrate_clickhouse_website_identity.sh` |

See [`docs/KAFKA_ROLLOUT.md`](docs/KAFKA_ROLLOUT.md) and [`docs/CLIENT_INTEGRATION_GUIDE.md`](docs/CLIENT_INTEGRATION_GUIDE.md).

### Still NOT changed automatically

- **`.env`** — add Kafka vars manually from `.env.example` if using Kafka mode
- Live UI/chat customizations (preserved)

### Verify DB state before deploy

**Postgres:**
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'admin_accounts'
  AND column_name IN ('domain_id','website_id','domain_name','website_url','organization_id');
```

**ClickHouse:**
```sql
SELECT table, name, type FROM system.columns
WHERE database = 'web_tracking' AND name IN ('domain_id','website_id','organization_id')
ORDER BY table, name;
```

If still on `domain_id`, run migrations in order:
1. `postgres/ddl/organization_id_integer.sql`
2. `postgres/ddl/09_admin_accounts_website_columns.sql`
3. `scripts/migrate_clickhouse_website_identity.sh` (after backup)

### Deploy checklist

1. `pip install -r etl/requirements.txt` (adds `confluent-kafka`)
2. `cd api-node && yarn prisma migrate deploy && yarn build`
3. Start with `INGEST_WRITE_MODE=direct`; verify ingest accepts `websiteId` payloads
4. Upload `sdk/dist/webtracking.js` to CDN as `web_tracking_v3.js`
5. Optional Kafka: set `INGEST_WRITE_MODE=dual`, run `python etl/run_kafka_consumer.py`
6. Verify: run from **Live_web_tracking_folder** root (not inside `etl/`):

```bash
cd ~/Documents/Live_build_web_tracking/CURSOR_REBUILD_for_live/Live_web_tracking_folder

# Unit tests (etl/pytest.ini sets pythonpath)
cd etl && pytest tests/test_kafka_envelope.py tests/test_replay_validation.py -v

# End-to-end Kafka verify (script lives in scripts/, not etl/scripts/)
python scripts/verify_kafka_ingest_pipeline.py --consume-one --organization-id 1
```

### SDK init (new keys)

```javascript
WorktualAnalytics.init({
  websiteId: 12345,
  websiteUrl: 'https://beta.worktual.co.uk',
  organizationId: 1,
  endpoint: 'https://qatrackingapi.worktual.com/webtracking/v1/tracking/nfs-ingestions',
  consent: { analytics: true },
});
```

---
