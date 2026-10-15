# Local dev — CRM native

**Do not run meeting-related services on this machine.** meeting-service, Vexa, and the Meet add-on run on the server. Use the server credentials already in root `.env` (`MEETING_SERVICE_URL` and related keys). `./scripts/up-dev.sh` starts only the CRM and does not launch meeting Docker.

**No CRM Docker.** Vite `:5173`, Fastify `:4000`, ai-service `:8000` / `:8020` via `./scripts/up-dev.sh`.

---

## CRM only (5173 + API + AI)

Schedule meetings, contacts, coworker — **no meeting-service**.

```bash
cd /Users/macbook/Movies/AI-Native-CRM-old && ./scripts/down-dev.sh && ./scripts/up-dev.sh
```

- Web: http://127.0.0.1:5173  
- API: http://127.0.0.1:4000  
- Logs: `.dev-logs/*.log`

Root `.env`: `DATABASE_URL`, `GOOGLE_*`, etc.

---

## CRM + meeting-service Docker (Meet / capture)

Do not use this on the machine that talks to the server meeting stack. Start these containers only when you intentionally want a local meeting-service.

CRM processes stay native; **only** `meeting-service/` runs in Docker (Postgres, Redis, whisper-adapter, API, worker on **:8030**, plus Vexa Lite on **:18056**).

**One-time** — `meeting-service/.env` from `.env.example`:

- `CRM_BOT_BASE_URL=http://host.docker.internal:4000` (Mac/Win Docker → host API)
- `CRM_BOT_API_KEY` = same as root `.env` `CRM_BOT_API_KEY`
- `VEXA_API_BASE=http://vexa-lite:8056` (set by compose; host gateway is `:18056`)

**Root `.env`**

```bash
MEETING_SERVICE_URL=http://127.0.0.1:8030
NOTETAKER_PROVIDER=vexa
CRM_BOT_API_KEY=...
```

**Start**

```bash
cd /Users/macbook/Movies/AI-Native-CRM-old && ./scripts/down-dev.sh && ./scripts/up-dev.sh && ./scripts/up-meeting-docker.sh
```

Or one line without the helper script:

```bash
cd /Users/macbook/Movies/AI-Native-CRM-old && ./scripts/down-dev.sh && ./scripts/up-dev.sh && cd meeting-service && docker compose up -d --build meeting-service meeting-worker
```

Meet add-on (browser smoke): http://127.0.0.1:5173/addons/meet/ (Vite proxies to `MEETING_SERVICE_URL`).

### Path B — `:8050` (keep `:8030` for QA SSH tunnel)

```bash
MEETING_SERVICE_URL=http://127.0.0.1:8050   # root .env
./scripts/up-meeting-docker-local.sh
./scripts/down-dev.sh && ./scripts/up-dev.sh
./scripts/verify-meeting-assist-local.sh
```

**Production / deployed server:** set `FRONTEND_ORIGIN` and `MEETING_SERVICE_PUBLIC_URL` in root `.env`, set `GOOGLE_ADDON_CLIENT_ID` + `GOOGLE_ADDON_CLOUD_PROJECT_NUMBER`, run `./scripts/render-meet-deployment-json.sh`, upload `meeting-service/addons/google-meet/deployment.json` to Google Cloud, and restart API + meeting-service. Local Docker: `./scripts/sync-meeting-service-env.sh` copies add-on keys into `meeting-service/.env`.

**Inside Google Meet locally**, the iframe still needs **HTTPS** (not LAN `:5173`). Optional ngrok on the API:

```bash
./scripts/up-meet-ngrok.sh   # dev only; uses CRM_API_PUBLIC_URL from root .env → :4000
```

Verify: `curl -H 'ngrok-skip-browser-warning: 1' https://<your-ngrok-host>/addons/meet/config`

---

## Full stack — Vexa live PCM

`./scripts/up-meeting-docker.sh` starts `vexa-lite` in the same compose and runs the live-PCM patch. To re-apply the patch alone:

```bash
cd /Users/macbook/Movies/AI-Native-CRM-old && ./scripts/up-vexa-live-pcm.sh
```

Equivalent:

```bash
cd /Users/macbook/Movies/AI-Native-CRM-old/meeting-service && ./scripts/patch-vexa-live-pcm.sh && docker restart vexa-lite
```

Preflight:

```bash
MEET_ASSIST_PREFLIGHT_MEET_CODE=xxx-xxxx-xxx ./scripts/meet-assist-preflight.sh
```

---

## Alternative: meeting-service native Python (no meeting Docker)

See `./scripts/up-meeting-native.sh` if you prefer `:8030` via local uvicorn instead of Docker.

---

## Stop

```bash
./scripts/down-dev.sh
cd meeting-service && docker compose stop meeting-service meeting-worker   # optional
docker stop vexa-lite   # optional
```

`down-dev.sh` frees ports **5173, 4000, 8000, 8020, 8030** on the host; Docker meeting-service may still hold **8030** until you `docker compose stop`.
