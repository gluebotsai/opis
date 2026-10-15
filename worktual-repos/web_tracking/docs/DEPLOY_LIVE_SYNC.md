# Sync main tree → `live_web_tracking_folder_2`

Production deploy uses the nested repo at `live_web_tracking_folder_2/` (remote: `web_tracking.git`).

**Main repo work is not on the live server until you sync, commit, push, and pull.**

For the **full git push/pull runbook**, troubleshooting (`__pycache__` pull conflicts, `reset --hard` on QA, secrets, node_modules), see **[GIT_DEPLOY_LOCAL_TO_SERVER.md](./GIT_DEPLOY_LOCAL_TO_SERVER.md)**.

## What gets synced

| Main path | Live path | Notes |
|-----------|-----------|--------|
| `api-node/src/` | `api-node/src/` | Live `api-node/src/routes/env.ts` restored from git after sync |
| `web/src/` | `web/src/` | Rebuild `web` on server after pull |
| `web/package.json`, `vite.config.js`, `index.html` | same | Needed when build tooling or env changes |
| `etl/ingest/`, `etl/config.py`, `etl/requirements.txt`, … | same | Ingest + Redis live presence on server |
| `clickhouse/ddl/` | `clickhouse/ddl/` | Files only — apply DDL manually after review |
| `AI_CHAT/` | `AI_CHAT/` | Excludes `.env`, venv, logs, `__pycache__`. Old live-only paths (e.g. legacy `app/agent/`) may still show as **deleted** in git until you commit — that is expected when main uses the newer MAS layout. |
| `shared/` | `shared/` | Python metrics/helpers used by api-node / AI_CHAT |
| `sdk/` (`src`, `dist`, `types`, …) | `sdk/` | No `node_modules`; run `npm run build` on server or before push if you commit `dist/` |
| `.env.example`, selected `scripts/` | same | Live `.env` / `AI_CHAT/.env` never overwritten |

Cursor agents edit the **main tree only**; run this script to copy into the deploy folder.

## After feature work (dev machine)

From repo root:

```bash
bash scripts/sync_main_to_live_web_tracking.sh
```

Manual tar fallback (if the script fails):

```bash
( cd api-node && tar -cf - src ) | ( cd live_web_tracking_folder_2/api-node && tar -xf - )
( cd web && tar -cf - src ) | ( cd live_web_tracking_folder_2/web && tar -xf - )
mkdir -p live_web_tracking_folder_2/clickhouse
( cd clickhouse && tar -cf - ddl ) | ( cd live_web_tracking_folder_2/clickhouse && tar -xf - )
( cd AI_CHAT && tar -cf - --exclude=.env --exclude=logs --exclude=.pytest_cache --exclude=__pycache__ . ) \
  | ( cd live_web_tracking_folder_2/AI_CHAT && tar -xf - )
( cd shared && tar -cf - . ) | ( cd live_web_tracking_folder_2/shared && tar -xf - )
cd live_web_tracking_folder_2 && git checkout HEAD -- api-node/src/routes/env.ts AI_CHAT/.env 2>/dev/null || true
```

## Git push (do not commit secrets)

```bash
cd live_web_tracking_folder_2
git status
git add -A
git reset HEAD .env AI_CHAT/.env 2>/dev/null || true
git commit -m "Sync from main: describe your changes"
git push origin main
```

## On the live server

```bash
cd /path/to/web_tracking   # your clone of web_tracking.git
git pull origin main

# API
cd api-node && npm ci && npm run build
# restart api service (systemd / pm2 / your run script)

# Dashboard
cd ../web && npm ci && npm run build
# redeploy static assets

# Co-worker / insights (if you use AI_CHAT on this host)
cd ../AI_CHAT
# pip install -r requirements.txt  # if deps changed
# restart uvicorn on port 7863 (see docs/SERVER_DEPLOY.md)
```

ClickHouse DDL under `clickhouse/ddl/` is **not** auto-applied; run manual apply only after explicit approval.
