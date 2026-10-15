# Cutover checklist (vs old SGW + Interrogator)

Use this before replacing `signalinggateway` + `worktual_interrogator` with `ur-signaling` for the merged SIP/Interrogator path.

## Code paths (must be true)

- [ ] No NetIO / `CreateTcpClient` / `sendMsgToInterrogator` / `m_interrogatorProfileList` under `ur-signaling/src/`
- [ ] Invite routing is in-process: `Controller::request(InviteRoute)` → `InterrogatorApi::getNextPbxIp()` (not TCP Interrogator)
- [ ] Live-call mid-call read: `LiveCallLookup` → `LiveCallStore` only; PBX writes `call:live:*`
- [ ] No `password` field in `INVITE_RES`; Logger redacts password/token/authorization
- [ ] No SIP → Redis direct calls; no merged-node write APIs on `LiveCallStore`
- [ ] WSS listen verified (`sip.wss_listen` + `certificate_dir`; WSS Sofia linked — see [`wss.md`](wss.md))

Verify quickly:

```bash
rg -n 'CreateTcpClient|sendMsgToInterrogator|m_interrogatorProfileList|NetIO' src/ || true
rg -n 'password' src/controller src/app src/logging
```

## Ops / dual-node

- [ ] Same Redis `pubsub_channel` on all merged nodes (see `docs/active-active.md`)
- [ ] Distinct `pbx.snapshot_path` per node (not shared NFS)
- [ ] Each node binds its own SIP listen
- [ ] Dual Redis configured: `redis.pubsub` (events) + `redis.store` (keys); same channel as PBXs

## Secrets (env)

| Variable | Purpose |
|----------|---------|
| `UR_REDIS_PUBSUB_PASSWORD` | Pub/Sub Redis password |
| `UR_REDIS_STORE_PASSWORD` | Store Redis password |
| `UR_REDIS_PUBSUB_HOST` / `UR_REDIS_PUBSUB_PORT` | Override pubsub endpoint |
| `UR_REDIS_STORE_HOST` / `UR_REDIS_STORE_PORT` | Override store endpoint |
| `UR_REDIS_PUBSUB_CHANNEL` | Override channel name |

Prefer env for secrets in shared deploys; local/prepro conf may embed passwords.

## Smokes (green before cutover)

```bash
./scripts/build.sh
ctest --test-dir build
./scripts/redis-smoke.sh
./scripts/interrogator-smoke.sh          # includes TTL reconcile on restart
./scripts/controller-interrogator-smoke.sh
./scripts/live-call-lookup-smoke.sh
./scripts/redis-failover-smoke.sh        # dual Redis store+pubsub
./scripts/dual-subscriber-smoke.sh
./scripts/invite-livecall-smoke.sh
./scripts/sip-invite-smoke.sh            # needs sofia-sip
```

## Migration notes

| Moves into `ur-signaling` | Stays outside / later |
|---------------------------|------------------------|
| PBX Pub/Sub → memory + snapshot | Full media / WSS client edge cases still on legacy until soak |
| In-process InviteRoute / LiveCallLookup | Sticky InviteRoute affinity / least-load |
| Sofia UDP invite vertical slice | Full media bridge / REGISTER auth |
| Redis `call:live:*` read, `pbx:alive:*` | Writing `call:live:*` (PBX only) |
| Dual Redis pubsub+store (no HA fallback) | Mid-run reconnect for either Redis |

Old TCP Interrogator profile in `urengine.conf` (`netio_module_profile.interagator_profile`) is ignored.
