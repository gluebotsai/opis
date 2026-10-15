# Session Replay Implementation Guide (Agent Instructions)

**Purpose:** Implement the **working rrweb 2.1.1 session replay** on a copy of this project that does **not** yet have session replay or GitHub rrweb setup.

**Target outcome:** Record sessions in the browser → `replay_chunk_v1` → ClickHouse `fact_replay_chunks` → dashboard playback with `window.rrweb.Replayer`.

**Reference repo pattern:** [rrweb-io/rrweb](https://github.com/rrweb-io/rrweb) v2.1.1 — load official UMD (`window.rrweb.record` / `window.rrweb.Replayer`). Do **not** bundle `@rrweb/record` inside the SDK.

---

## 0. Critical decisions before you start

### Do NOT copy the full `Github_session/rrweb-main` folder from the other machine

| Approach | Recommended? | Why |
|----------|--------------|-----|
| Copy entire `Github_session/rrweb-main` with `node_modules` | **No** | Huge (~500MB+), machine-specific, slow, unnecessary |
| Paste downloaded zip of rrweb repo | **No** | Same problem; you only need the **built UMD file** |
| **`git clone` + build on target machine** | Optional | Only if npm path fails |
| **`npm install rrweb@2.1.1` + `vendor_rrweb.py`** | **Yes (preferred)** | Fast, reliable, official 2.1.1 UMD |
| **Sync project source via git** | **Best** | Copy all code changes; vendor rrweb via npm on target |

### What the other agent MUST get from the successful project

**Option A (best):** Same git branch/commit that has replay working — `git pull` or cherry-pick.

**Option B:** Copy the paths listed in [Section 13](#13-complete-file-manifest-sync-from-working-project) manually from the working machine.

**Option C:** Re-implement from this guide file-by-file.

### What NOT to do (causes failure)

- Do **not** bundle `@rrweb/record` inside the SDK (`import { record } from '@rrweb/record'`)
- Do **not** use rrweb `2.0.0-alpha.4` for new work — use **2.1.1**
- Do **not** set `keepalive: true` on all replay POSTs (browser limit ~64KB)
- Do **not** mark snapshot as sent before HTTP 200
- Do **not** serve demo with `python -m http.server` — use `demo/serve.py`

---

## 1. Prerequisites on target machine

```bash
# Tools
python 3.10+
node 18+ and npm
git
conda env or venv with project dependencies (clickhouse_connect, fastapi, etc.)

# Clone/sync the web tracking project
cd /path/to/cursor_session   # or your project root

# Environment
cp .env.example .env
# Set at minimum:
# CLICKHOUSE_HOST, CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE=web_tracking
# DB_PASSWORD / DATABASE_URL for dashboard login
# CH_DICT_PG_PASSWORD for ingest website validation
# INGEST_WRITE_MODE=direct   (or kafka/dual if using Kafka pipeline)
```

---

## 2. Architecture to implement (reference)

```text
Browser:
  webtracking.js (Worktual SDK)
    → dynamically loads rrweb.min.js (official UMD 2.1.1)
    → window.rrweb.record({ emit })
    → buffer events → gzip+base64 → POST replay_chunk_v1
    → /v1/tracking/nfs-ingestions

Backend:
  Ingest API → raw_payloads → MV → fact_replay_chunks
  (Same Kafka pipeline as analytics when INGEST_WRITE_MODE=kafka|dual)

Dashboard:
  API merges chunks → decode gzip → load rrweb.min.js → new Replayer(events)
```

Analytics (`events_v3`) and replay (`replay_chunk_v1`) share the same ingest service. Replay uses **`nfs-ingestions`** endpoint (auto-derived from `collect` when `replayEndpoint` is unset).

---

## 3. Phase 1 — ClickHouse DDL

```bash
conda activate web_tracking   # or your env
cd /path/to/project
python scripts/apply_clickhouse_ddl.py
```

**Must include:** `clickhouse/ddl/07_replay_chunks.sql`

Creates:

- `web_tracking.fact_replay_chunks`
- `web_tracking.mv_fact_replay_chunks`

Verify:

```bash
python scripts/verify_replay_setup.py
```

Expected: `✓ fact_replay_chunks`, `✓ mv_fact_replay_chunks`

---

## 4. Phase 2 — SDK source files (core implementation)

Ensure these files exist and match the **UMD script-load pattern** (not bundled `@rrweb/record`).

### 4.1 Required SDK files

| File | Role |
|------|------|
| `sdk/src/replay/recorder.js` | Loads `rrweb.min.js`, calls `window.rrweb.record`, buffer/flush |
| `sdk/src/replay/chunk-sender.js` | POST `replay_chunk_v1`, keepalive fix, chunk index |
| `sdk/src/replay/encode.js` | Browser gzip + base64 |
| `sdk/src/replay/recorder.js` | rrweb record + flush |
| `sdk/src/core/config.js` | Replay defaults (see 4.2) |
| `sdk/src/index.js` | Calls `setupSessionReplay()` on init |

### 4.2 Required config defaults in `sdk/src/core/config.js`

```javascript
trackReplay: true,
replayMode: 'rrweb',           // NOT 'html'
replaySampleRate: 1,
replayChunkIntervalMs: 2000,
replayMaxEventsPerChunk: 25,
replayCheckoutEveryNms: 30_000,
replayBlockClass: 'wt-no-replay',
replayMaskTextClass: 'wt-mask',
replaySampleMousemove: 100,
replaySampleScroll: 150,
replayScriptUrl: null,          // set in init for prod; localhost uses /vendor/rrweb/rrweb.min.js
replayEndpoint: null,           // auto-derived from endpoint → nfs-ingestions
```

### 4.3 `recorder.js` — must use UMD load (not npm import)

```javascript
// NO: import { record } from '@rrweb/record';

// YES:
await loadScript(replayScriptUrl);  // /vendor/rrweb/rrweb.min.js or CDN
window.rrweb.record({ emit: onRrwebEmit, sampling: {...} });
```

**Flush rules:**

1. On **FullSnapshot** (type 2) → flush immediately
2. Every **2s** or **25 events**
3. On **page hide** → flush remaining
4. Set `snapshotFlushed = true` **only after successful POST**

### 4.4 `chunk-sender.js` — critical fixes

```javascript
// replayEndpoint: auto from collect endpoint
function getEndpoint() {
  if (config?.replayEndpoint) return config.replayEndpoint;
  const base = config?.endpoint || '/v1/tracking/collect';
  if (base.includes('/collect')) return base.replace(/\/collect\/?$/, '/nfs-ingestions');
  return base.replace(/\/?$/, '/nfs-ingestions');
}

// keepalive only for small bodies (~64KB browser limit)
const useKeepalive = bodyStr.length <= 60_000;
fetch(url, { ..., keepalive: useKeepalive });
```

**Payload shape:**

```json
{
  "type": "replay_chunk_v1",
  "websiteId": 1001,
  "websiteUrl": "https://example.com",
  "visitorId": "...",
  "sessionId": "...",
  "chunkIndex": 0,
  "encoding": "gzip_b64",
  "eventsData": "<gzip base64>",
  "source": "rrweb"
}
```

### 4.5 `scripts/build_sdk.py` — include replay in bundle list

Must list in `FILES`:

```text
"replay/encode.js",
"replay/chunk-sender.js",
"replay/recorder.js",
```

At end of `build()`, call `vendor_rrweb.py` automatically.

### 4.6 Remove if present (broken approach)

Delete or do **not** add:

- `sdk/src/replay/rrweb-recorder.js` (bundled `@rrweb/record` — removed in working version)

---

## 5. Phase 3 — rrweb vendor (official UMD 2.1.1)

### Method A — npm (preferred, no GitHub clone needed)

```bash
cd sdk
npm install rrweb@2.1.1 --save-dev
cd ..
python scripts/vendor_rrweb.py
```

Creates:

```text
vendor/rrweb/rrweb.min.js      (~260 KB)
vendor/rrweb/style.css
demo/vendor/rrweb/rrweb.min.js
web/public/vendor/rrweb/rrweb.min.js
```

### Method B — GitHub clone (only if npm fails)

```bash
mkdir -p Github_session
git clone https://github.com/rrweb-io/rrweb.git Github_session/rrweb-main
cd Github_session/rrweb-main
PUPPETEER_SKIP_DOWNLOAD=1 yarn install
PUPPETEER_SKIP_DOWNLOAD=1 yarn build:all
# If build:all fails on browser-client, that's OK — check:
# packages/rrweb/umd/rrweb.min.js exists

cd ../..
python scripts/vendor_rrweb.py
```

Or use the helper script:

```bash
python scripts/build_rrweb_from_github.py
```

**Do not commit `Github_session/rrweb-main/node_modules` to git.**

### Method C — copy only vendor output (acceptable shortcut)

From the working machine, copy **only**:

```text
vendor/rrweb/rrweb.min.js
vendor/rrweb/style.css
```

To the same paths on target. Then run `python scripts/build_sdk.py`.

---

## 6. Phase 4 — Build SDK

```bash
python scripts/build_sdk.py
```

Outputs:

```text
sdk/dist/webtracking.js       (~120 KB — must NOT be ~283 KB; that means rrweb was bundled)
sdk/dist/webtracking.min.js   (~74 KB)
demo/sdk/webtracking.js       (copied)
web/public/webtracking.js     (copied)
```

Verify SDK does **not** contain bundled rrweb:

```bash
wc -c sdk/dist/webtracking.min.js                # ~74000 bytes, not 280000+
grep -c "@rrweb/record" sdk/dist/webtracking.js  # should be 0
```

---

## 7. Phase 5 — Backend / API / Dashboard

### 7.1 Ingest (usually already present)

Confirm `etl/ingest/app.py` handles `replay_chunk_v1` on both:

- `/v1/tracking/collect`
- `/v1/tracking/nfs-ingestions`

Confirm `etl/ingest/service.py` has:

- `prepare_replay_chunk()`
- `ingest_replay_chunk()` → `write_prepared()` (same Kafka path as analytics when `INGEST_WRITE_MODE=kafka|dual`)

### 7.2 API files to sync

| File | Purpose |
|------|---------|
| `api-node/src/utils/replayDecode.ts` | gzip decode, merge events, `replayHasFullSnapshot` |
| `api-node/src/repositories/clickhouse/analyticsRepository.ts` | `getReplaySessions`, `getReplayEvents`, prefer rrweb |
| `api-node/src/routes/analytics.ts` | Replay routes, session exists check |

`replayDecode.ts` must have **try/catch** on gzip decode (corrupt chunks must not 500 the session list).

### 7.3 Dashboard player

| File | Purpose |
|------|---------|
| `web/src/components/SessionReplayPlayer.jsx` | Load UMD `rrweb.min.js`, `new window.rrweb.Replayer(events)` |
| `web/src/pages/Sessions.jsx` | Sessions list |
| `web/src/pages/SessionReplay.jsx` | Replay page |

Player must **not** use `import { Replayer } from 'rrweb'` — use script load + `window.rrweb.Replayer`.

Local player URL: `/vendor/rrweb/rrweb.min.js`  
Production fallback: `https://cdn.jsdelivr.net/npm/rrweb@2.1.1/dist/rrweb.umd.min.cjs`

---

## 8. Phase 6 — Demo server

### 8.1 `demo/serve.py`

Must:

- Serve `/sdk/` → `sdk/dist/` or `demo/sdk/`
- Serve `/vendor/` → `vendor/`
- Strip `?v=` query from paths (cache-bust fix)

### 8.2 `demo/index.html` init block

```javascript
WorktualAnalytics.init({
  websiteId: 1001,
  websiteUrl: 'https://beta.worktual.co.uk/',  // must match admin registry
  endpoint: 'http://localhost:7860/v1/tracking/collect',
  replayEndpoint: 'http://localhost:7860/v1/tracking/nfs-ingestions',
  trackReplay: true,
  replayMode: 'rrweb',
  replayScriptUrl: '/vendor/rrweb/rrweb.min.js',
  replaySampleRate: 1,
  replayChunkIntervalMs: 2000,
  replayMaxEventsPerChunk: 25,
  debug: true,
});
```

Load SDK with **one URL** on localhost:

```html
<script src="/sdk/webtracking.js?v=TIMESTAMP"></script>
```

---

## 9. Phase 7 — Run and test (step-by-step)

### Terminal 1 — Backend

```bash
python run_backend.py --all
```

Check:

```bash
curl http://localhost:7860/health   # ingest
curl http://localhost:7861/health   # api
curl http://localhost:7862/         # dashboard
```

### Terminal 2 — Demo

```bash
python demo/serve.py
```

Verify URLs return JS (not 404):

```text
http://localhost:7870/sdk/webtracking.js
http://localhost:7870/vendor/rrweb/rrweb.min.js
```

### Browser test

1. Open `http://localhost:7870/`
2. Hard refresh: Ctrl+Shift+R
3. Console should show: `[WorktualAnalytics] rrweb session replay started`
4. Interact 15–30 seconds (click, scroll, type)
5. DevTools → Network → filter `nfs-ingestions`
6. Expect: multiple `replay_chunk_v1` POSTs with **HTTP 200**
7. First chunk (index 0) must contain FullSnapshot

### Dashboard test

1. Login: `admin@worktual.co.uk` / `admin123` (or your local creds)
2. Website ID **1001** (must match demo)
3. Go to **Session replay** / **Sessions**
4. New session should appear
5. Click **Watch** → video-like replay plays

### DB verify

```bash
python scripts/verify_replay_setup.py
```

Or ClickHouse:

```sql
SELECT session_id, count() chunks, max(created_at) latest
FROM web_tracking.fact_replay_chunks
WHERE website_id = 1001
GROUP BY session_id
ORDER BY latest DESC
LIMIT 10;
```

---

## 10. Verification checklist (agent must confirm all)

- [ ] `fact_replay_chunks` table exists
- [ ] `vendor/rrweb/rrweb.min.js` exists (~260 KB)
- [ ] `sdk/dist/webtracking.min.js` ~74 KB (not 283 KB)
- [ ] No `import { record } from '@rrweb/record'` in SDK source
- [ ] Demo loads SDK + rrweb with HTTP 200
- [ ] Console: `rrweb session replay started`
- [ ] Network: `replay_chunk_v1` → nfs-ingestions → 200
- [ ] ClickHouse: new rows in `fact_replay_chunks`
- [ ] Dashboard: session list shows new session
- [ ] Playback: Replayer runs without error

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| SDK 404 on demo | Wrong server or SDK not built | `python scripts/build_sdk.py` + `python demo/serve.py` |
| rrweb 404 | Vendor not copied | `python scripts/vendor_rrweb.py` |
| `Failed to fetch` on nfs-ingestions | `keepalive: true` on large body | Fix `chunk-sender.js` (≤60KB only) |
| Chunks 200 but session "Incomplete" | Chunk 0 missing FullSnapshot | Fix `snapshotFlushed` timing in `recorder.js` |
| Empty session list, API 500 | Corrupt gzip in old data | Resilient decode in `replayDecode.ts` |
| `rrweb.record not available` | Wrong script URL or blocked | Check `/vendor/rrweb/rrweb.min.js` loads |
| Ingest 403 | `websiteUrl` mismatch | Match admin registry exactly |
| Analytics works, replay doesn't | Wrong endpoint | Set `replayEndpoint` to nfs-ingestions |
| Kafka mode: chunks not in CH | Consumer not running | `python etl/run_kafka_consumer.py` or `run_backend.py --all` |

---

## 12. Production CDN (after local success)

Upload to CDN:

1. `sdk/dist/webtracking.min.js` → replace `web_tracking_v3.js` (or new filename)
2. **New:** `rrweb.min.js` + `style.css`

Customer init:

```javascript
WorktualAnalytics.init({
  websiteId: YOUR_ID,
  websiteUrl: 'https://your-site.com',
  endpoint: 'https://tracking.worktual.co.uk/webtracking/v1/tracking/nfs-ingestions',
  trackReplay: true,
  replayMode: 'rrweb',
  replayScriptUrl: 'https://your-cdn/.../rrweb.min.js',
});
```

Still **one** `<script>` tag for SDK — rrweb loads automatically.

See also: `docs/CLIENT_INTEGRATION_GUIDE.md`

---

## 13. Complete file manifest (sync from working project)

### Must have (create or copy)

```text
sdk/src/replay/recorder.js
sdk/src/replay/chunk-sender.js
sdk/src/replay/encode.js
sdk/src/core/config.js          (replay section)
sdk/src/index.js                (setupSessionReplay call)
scripts/vendor_rrweb.py
scripts/build_rrweb_from_github.py   (optional)
scripts/build_sdk.py            (replay files in FILES list)
scripts/verify_replay_setup.py
clickhouse/ddl/07_replay_chunks.sql
demo/serve.py
demo/index.html                 (rrweb init)
web/src/components/SessionReplayPlayer.jsx
api-node/src/utils/replayDecode.ts
api-node/src/repositories/clickhouse/analyticsRepository.ts  (replay methods)
api-node/src/routes/analytics.ts
etl/ingest/app.py               (replay_chunk_v1 routing)
etl/ingest/service.py           (ingest_replay_chunk)
etl/ingest/schemas.py           (ReplayChunkRequest)
etl/ingest/validation.py        (validate_replay_chunk_body)
```

### Generated (do not copy from other machine — rebuild on target)

```text
vendor/rrweb/rrweb.min.js
sdk/dist/webtracking.js
sdk/dist/webtracking.min.js
demo/sdk/webtracking.js
```

### Optional (do not copy)

```text
Github_session/rrweb-main/      (clone fresh or skip — use npm)
```

### Must NOT exist

```text
sdk/src/replay/rrweb-recorder.js   (bundled approach — delete if present)
```

---

## 14. Agent execution order (summary)

```bash
# 1. Sync code (git pull or copy files from Section 13)
# 2. ClickHouse
python scripts/apply_clickhouse_ddl.py

# 3. rrweb vendor
cd sdk && npm install rrweb@2.1.1 --save-dev && cd ..
python scripts/vendor_rrweb.py

# 4. Build SDK
python scripts/build_sdk.py

# 5. API deps (if needed)
cd api-node && npm install && cd ..
cd web && npm install && cd ..

# 6. Run
python run_backend.py --all
python demo/serve.py

# 7. Test browser + dashboard
python scripts/verify_replay_setup.py
```

---

## 15. GitHub folder vs repository link

| Question | Answer |
|----------|--------|
| Paste downloaded GitHub folder from other device? | **No** — too heavy; copy only `vendor/rrweb/*.js` if shortcut |
| Give repository link to agent? | **Yes** — `https://github.com/rrweb-io/rrweb` tag **v2.1.1** |
| Best approach? | `npm install rrweb@2.1.1` in `sdk/` + `python scripts/vendor_rrweb.py` |
| When to clone GitHub repo? | Only if npm vendor fails |
| What to sync between machines? | **Project source code** (git), not rrweb `node_modules` |

---

## 16. Why bundled `@rrweb/record` failed (for context)

| Before (broken) | After (working) |
|-----------------|-----------------|
| Bundled `@rrweb/record` inside SDK (~283 KB) | SDK loads official UMD separately (~74 KB + 260 KB rrweb) |
| `import { record } from '@rrweb/record'` | `window.rrweb.record` after script load |
| Dashboard npm `import { Replayer }` | `window.rrweb.Replayer` from same UMD |
| Recorder/player version mismatch possible | Same build for record + replay |
| `keepalive: true` on large snapshots → Failed to fetch | keepalive only if body ≤ 60 KB |
| `snapshotFlushed` before POST success → Incomplete sessions | Set flag only after HTTP 200 |

The rrweb **recording algorithm** is the same. Success came from **correct integration** + **flush/send bug fixes**.

---

## Related docs

- `docs/SESSION_REPLAY.md` — overview (may be stale on default mode; code default is `rrweb`)
- `docs/CLIENT_INTEGRATION_GUIDE.md` — customer embed + CDN URLs
