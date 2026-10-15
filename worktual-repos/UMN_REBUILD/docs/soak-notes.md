# Soak / capacity notes (~10k concurrent)

Phase 8 does **not** ship an automated 10k soak harness. Use external SIP load tools (sipp, etc.) against a staging pair of merged nodes.

## CPS vs concurrency

| Metric | Meaning | Pressure points |
|--------|---------|-----------------|
| **CPS** | Invites (or dialogs) started per second | SipService worker queue, sync `Controller::request`, Redis Pub/Sub fan-out, `getNextPbxIp` |
| **Concurrency** | Active dialogs / Sofia handles at once | Sofia Receiver thread, Leg-A/B handle maps, memory, timer churn |

A node can sustain high concurrency with modest CPS, or high CPS with short-lived calls. Size for both.

## Hot paths

1. **Sofia thread** — only place for `nua_*` / handle destroy; do not block on Redis here.
2. **SipService worker** — drains inbound INVITEs → `Controller::request(InviteRoute)` (synchronous today).
3. **Redis** — live-call `GET`/`HGETALL` on store Redis; Pub/Sub on pubsub Redis.
4. **Dual-node RR** — each node independently round-robins; load skew is expected unless least-load is added later.

## What to watch

- SipService queue depth / invite queue latency
- Redis GET/HGETALL P99 (especially `call:live:*`)
- Sofia handle count and Receiver thread CPU
- Redis Pub/Sub lag under two Active-Active subscribers
- Error rate on InviteRoute when PBX list empty or Redis down

## Suggested validation approach

1. Warm both nodes with Pub/Sub PBX load stats.
2. Ramp CPS with a SIP UAC farm toward each node’s listen address.
3. Hold target concurrency (~10k dialogs total or per node — define per deployment) for a soak window.
4. Confirm no handle double-destroy / process crash; confirm DialOut / route IPs remain sane.
5. Confirm pubsub Redis and store Redis are both reachable; restart process if either drops (see `docs/active-active.md`).
