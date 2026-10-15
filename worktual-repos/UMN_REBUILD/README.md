# ur-signaling

Merged **signaling gateway + interrogator** node (Active-Active capable).

**Phase 8:** Cutover-hardened — expanded unit tests, Redis env secret overrides, combined InviteRoute+LiveCallLookup smoke, CI workflow, [`docs/cutover-checklist.md`](docs/cutover-checklist.md). SIP **UDP + WSS/TLS** via Sofia (see [`docs/wss.md`](docs/wss.md)).

## Build

Requires CMake ≥ 3.21, a C++23 compiler (GCC 12+), `libhiredis-dev`, OpenSSL, and network on first configure (FetchContent `redis-plus-plus`).

For **WSS**, link a Sofia build that has `NUTAG_WSS_URL` (Ubuntu package usually does not). Default: `$HOME/.local/sofia-sip-1.13.17` (same as legacy SGW). Set `UR_SOFIA_PREFIX` if needed.

```bash
./scripts/gen-sofia-certs.sh    # once — certs/sofia/agent.pem
./scripts/build.sh
./build/ur-signaling configs/ur-signaling.conf.json
ctest --test-dir build
```

### Smokes (SKIP if Redis / sofia unavailable)

```bash
./scripts/redis-smoke.sh
./scripts/interrogator-smoke.sh              # Pub/Sub + TTL reconcile
./scripts/controller-interrogator-smoke.sh
./scripts/live-call-lookup-smoke.sh
./scripts/redis-failover-smoke.sh            # dual Redis store+pubsub smoke
./scripts/dual-subscriber-smoke.sh
./scripts/invite-livecall-smoke.sh           # InviteRoute + LiveCallLookup
./scripts/sip-invite-smoke.sh                # needs sofia-sip
```

Process runs until **Ctrl+C** (SIGINT) or SIGTERM. Missing/invalid config or Redis connect failure → exit `1`.

## Config and secrets

Dual Redis (no HA fallback): **pubsub** for SUBSCRIBE/PUBLISH, **store** for SET/GET/HGETALL/`pbx:alive`. Override via environment (applied after JSON load):

| Env | Overrides |
|-----|-----------|
| `UR_REDIS_PUBSUB_HOST` / `UR_REDIS_PUBSUB_PORT` / `UR_REDIS_PUBSUB_PASSWORD` | Pub/Sub Redis |
| `UR_REDIS_STORE_HOST` / `UR_REDIS_STORE_PORT` / `UR_REDIS_STORE_PASSWORD` | Store Redis |
| `UR_REDIS_PUBSUB_CHANNEL` | Pub/Sub channel name |
| `UR_SIP_HOST` | Rewrites `sip.udp/tcp/tls/wss_listen` hosts + `contact_wss_host` (keeps ports from JSON) |
| `UR_SIP_UDP_LISTEN` / `UR_SIP_TCP_LISTEN` / `UR_SIP_TLS_LISTEN` / `UR_SIP_WSS_LISTEN` | Full `host:port` overrides |
| `UR_SIP_CERTIFICATE_DIR` / `UR_SIP_CONTACT_WSS_HOST` | Cert dir / WSS contact host |

Deploy script auto-sets `UR_SIP_HOST` from the machine’s primary IPv4 when unset. Never log passwords. See `configs/ur-signaling.conf.json`.

## Dual-node / Redis keys / cutover

- Active-Active runbook: [`docs/active-active.md`](docs/active-active.md)
- Redis key schema: [`docs/redis-keys.md`](docs/redis-keys.md)
- Cutover checklist vs old SGW + Interrogator: [`docs/cutover-checklist.md`](docs/cutover-checklist.md)
- Soak / ~10k concurrency notes: [`docs/soak-notes.md`](docs/soak-notes.md)
- Architecture / messages / phases: `docs/architecture.md`, `docs/message-api.md`, `docs/rebuild-plan.md`

## CI

GitHub Actions workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — builds with hiredis + sofia-sip, runs `ctest`, then Redis-gated smokes (Redis service). Works when `ur-signaling` is the workflow root, or when the monorepo checkout still contains `ur-signaling/scripts/build.sh`.

## Self-hosted deploy (manual GitHub Actions)

Push → **Actions** → **Manual Deploy (self-hosted)** → **Run workflow**.  
Details: [`docs/deploy-self-hosted.md`](docs/deploy-self-hosted.md).

```bash
# workflow: .github/workflows/deploy-staging.yml  (labels: self-hosted, linux, staging)
# host script: ./scripts/deploy-self-hosted.sh
# systemd:     deploy/ur-signaling.service
```

## Migration vs old trees

| Old | New |
|-----|-----|
| SGW NetIO TCP → external Interrogator | In-process `InterrogatorApi` |
| Interrogator in-memory call maps from pub/sub | Redis `call:live:*` (PBX write / merged read) |
| Shared RR / single Interrogator process | Dual merged nodes, local RR each |
| Client/WSS in SGW | Sofia `NUTAG_WSS_URL` in this binary ([`docs/wss.md`](docs/wss.md)) |

Reference only (do not build as the product):

| Tree | Path |
|------|------|
| Existing SGW | [`../signalinggateway/`](../signalinggateway/) |
| Existing Interrogator | [`../worktual_interrogator/`](../worktual_interrogator/) |
