# Active-Active runbook (two Merged instances)

Run two `ur-signaling` processes against the same Redis Pub/Sub channel and live-call keys. Each node keeps its own in-memory PBX list and round-robins independently.

## Configuration rules

| Concern | Rule |
|---------|------|
| Pub/Sub | Same `redis.pubsub_channel` on both nodes (default `InterrogatorEvent`) |
| Snapshot | Distinct `pbx.snapshot_path` per node — **not** a shared/NFS file |
| PBX selection | Each node round-robins its **local** `PbxSelector` (Active-Active; no shared RR cursor) |
| Live calls | Shared Redis `call:live:<uid>`; both nodes **read-only** via `LiveCallStore` |
| Redis | Same `redis.pubsub` + `redis.store` + `pubsub_channel` on both nodes (no HA fallback) |
| SIP | Each node binds its own `sip.udp_listen` (no shared Sofia socket) |

Example: node A `data/pbx_snapshot_a.json`, node B `data/pbx_snapshot_b.json`; both use the same `redis.pubsub` / `redis.store` / `pubsub_channel` (e.g. prepro `InterrogatorEventPREPRO`).

## Live-call mid-call read

1. PBX writes `call:live:<uid>` (string or hash) — never the merged node.
2. Either node: `Controller::request(LiveCallLookup)` → `InterrogatorApi::lookupLiveCall` → `LiveCallStore::get`.
3. Response carries opaque `client_call_info` / `call_hosted_info` JSON (see `docs/redis-keys.md`).

No SIP→Redis. No in-memory `client-call-info` maps on the merged node.

## Dual Redis

- **Pub/Sub Redis:** SUBSCRIBE + PUBLISH (`redis.pubsub`).
- **Store Redis:** SET/GET/HGETALL / `pbx:alive` / `call:live` (`redis.store`).
- If either endpoint is down at start, process fails to start. Mid-run reconnect is out of scope (restart the process).

Never log Redis passwords.

## Verify

```bash
./scripts/live-call-lookup-smoke.sh   # PBX mock HSET → LiveCallLookup on two LiveCallStore readers
./scripts/redis-failover-smoke.sh     # dual Redis store+pubsub smoke
./scripts/dual-subscriber-smoke.sh    # two subscribers both receive one publish
```
