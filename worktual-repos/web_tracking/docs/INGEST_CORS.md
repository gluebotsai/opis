# Ingest CORS — SDK from customer websites

When the SDK on `https://beta.worktual.co.uk` POSTs to your ingest URL (QA: `https://qatrackingapi.worktual.com/webtracking/v1/tracking/nfs-ingestions`), the browser sends an **OPTIONS preflight** first. If the response lacks `Access-Control-Allow-Origin`, you see:

```
blocked by CORS policy: No 'Access-Control-Allow-Origin' header
```

## Why it happened

1. **Wrong CORS env** — ingest was using dashboard `CORS_ORIGINS` instead of `INGEST_CORS_ORIGINS`.
2. **Wrong hostname** — `tracking.worktual.co.uk` still points at legacy server (`.165`); use **`qatrackingapi.worktual.com`** on migrated stack (`.44`).
3. **Path prefix** — public URL includes `/webtracking/`; uvicorn must expose that route (or nginx must strip the prefix).

Your **payload JSON is fine** — this is browser CORS + routing + correct ingest URL.

## Fix on server (after deploying updated `etl/ingest/app.py`)

### 1. Deploy code + restart ingest

```bash
cd ~/Web_tracking_workspace/web_tracking_QA
python etl/run_ingest.py
python etl/run_kafka_consumer.py   # if INGEST_WRITE_MODE=kafka
```

Updated ingest:
- Uses **`INGEST_CORS_ORIGINS`** (defaults to `*` — allows any tracked customer site)
- Registers **`/webtracking/v1/tracking/nfs-ingestions`** in addition to `/v1/...`

### 2. `.env` on server `.44`

```env
INGEST_PUBLIC_URL=https://qatrackingapi.worktual.com/webtracking/v1/tracking/nfs-ingestions
INGEST_CORS_ORIGINS=*
INGEST_WRITE_MODE=kafka
```

Do **not** rely on `CORS_ORIGINS` for ingest — that is for the dashboard API only.

### 3. nginx on `qatrackingapi.worktual.com`

```nginx
location /webtracking/ {
    proxy_pass http://127.0.0.1:7860/;   # strips /webtracking/
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Do **not** handle OPTIONS in nginx without CORS headers — let ingest respond.

### 4. Verify CORS

```bash
curl -i -X OPTIONS \
  'https://qatrackingapi.worktual.com/webtracking/v1/tracking/nfs-ingestions' \
  -H 'Origin: https://beta.worktual.co.uk' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

Expect **200** with `Access-Control-Allow-Origin: *` (or your origin).

### 5. Beta SDK init

```javascript
WorktualAnalytics.init({
  websiteId: 12345,
  websiteUrl: 'https://beta.worktual.co.uk',
  organizationId: 1,
  endpoint: 'https://qatrackingapi.worktual.com/webtracking/v1/tracking/nfs-ingestions',
  consent: { analytics: true },
});
```

## Quick checklist

- [ ] `endpoint` uses **qatrackingapi** (not tracking.worktual.co.uk on `.44` migration)
- [ ] `consent: { analytics: true }` in init (or enable after cookie banner)
- [ ] Updated `etl/ingest/app.py` deployed + ingest restarted
- [ ] `INGEST_CORS_ORIGINS=*`
- [ ] nginx `/webtracking/` → `:7860`
- [ ] Browser Network: POST to **qatrackingapi** → 200
- [ ] Kafka consumer running (if kafka mode)
