# Redis keys & channels

Exact formats used by `ur-signaling` Redis helpers (`src/redis/`).

| Kind | Exact pattern | Redis type | Value | TTL | Writer | Reader |
|------|---------------|------------|-------|-----|--------|--------|
| Pub/Sub channel | Config `redis.pubsub_channel` (prepro `InterrogatorEventPREPRO`) on **pubsub** Redis | Pub/Sub | PBX event JSON (`pbx-call-load-statistics` / `-delete`) | n/a | PBX | Merged `InterrogatorService` → in-memory `PbxSelector` |
| Presence | `pbx:alive:<ip>` | string | `"1"` | `redis.pbx_alive_ttl_sec` (default **30**) | PBX + Merged `PbxPresenceStore::refreshAlive` | Merged `isAlive` |
| Live call | `call:live:<uid>` | string JSON **or** hash | See below | Set by **PBX** (~`redis.call_live_ttl_sec`, default **3600**) | **PBX only** | Merged `LiveCallStore` (read-only) |
| Credentials | `<user>@<domain>` | string JSON | `user_id`,`domain_id`,`password`,`callerName`,`sip_login_id` | Provisioned externally | **Read-only** via `RegistrationStore` (digest) |
| Binding (AOR) | `<user>@<domain>@<deviceType>:<appType>` | string JSON | `Call_id`,`Contact_address`,`Ipaddress`,`proxy_username`,`transport_type`,`device_type`,`Registered_time`,`user_status` | none (plain SET) | `RegistrationStore` on REGISTER success; DEL on `Expires:0` |

Desktop / MicroSIP (unknown UA) uses empty `appType` → e.g. `202@13981.call.worktual.co.uk@URDESK:`. Worktual web softphone keeps `@URWEB:WEB`.

## Helpers

- `PbxPresenceStore::keyFor(ip)` → `pbx:alive:` + ip  
  Ops: `SET … EX`, `GET`, `DEL` / `EXPIRE` via `RedisClient` — **not** a full PBX IP registry.
- `LiveCallStore::keyFor(uid)` → `call:live:` + uid  
  Ops: `GET`, `HGETALL` only. **No** write/delete APIs on `LiveCallStore`.

### `call:live:<uid>` value shapes

1. **Hash** (preferred when PBX uses HSET): fields may include `client-call-info` / `call-hosted-info` (also snake_case variants). Mapped into `LiveCallInfo`.
2. **String**: entire blob stored as `LiveCallInfo.client_call_info_json`.

#### Hash field aliases

| Hash field | Maps to `LiveCallInfo` |
|------------|------------------------|
| `client-call-info` or `client_call_info` | `client_call_info_json` |
| `call-hosted-info` or `call_hosted_info` | `call_hosted_info_json` |
| (neither present) | whole hash dumped into `client_call_info_json` |

#### Inner JSON (legacy interrogator / PBX names)

Aligned with `worktual_interrogator` `xGateRoutingManager` pub/sub payloads. PBX should store the same field names inside Redis hash values.

**`client-call-info` JSON fields:**

| Field | Notes |
|-------|--------|
| `call_id` | SIP Call-ID style id |
| `call_uid` | Joins to hosted info / Redis key uid |
| `sub_key` | Participant sub-index (legacy map) |
| `extension` | Extension |
| `device_type` | Device type |
| `master_key` | Sticky key form `user@domain` |

**`call-hosted-info` JSON fields:**

| Field | Notes |
|-------|--------|
| `call_uid` | Same uid as Redis key suffix |
| `domain_name` | Domain |
| `pbx-addr` | Sticky PBX IP (legacy mid-call route target) |
| `mgw-addr` | Media gateway address |

Legacy in-memory join was `master_key` → `call_uid` → `pbx-addr`. The **merged node mid-call read path** does **not** rebuild those maps from Pub/Sub: it reads Redis `call:live:<uid>` via `Controller` `LiveCallLookup` → `LiveCallStore` only. Pub/Sub `client-call-info*` messages are ignored by `InterrogatorService`.

## Dual Redis (no HA fallback)

- Config: `redis.pubsub` + `redis.store` (host/port/password).
- Defaults in `configs/ur-signaling.conf.json`: pubsub `10.180.2.106:6379`, store `10.180.2.109:6379`, channel `InterrogatorEventPREPRO`.
- `RedisClient` opens **both** connections at start: SUBSCRIBE/PUBLISH → pubsub; SET/GET/HGETALL/`pbx:alive` → store.
- Env overrides: `UR_REDIS_PUBSUB_*`, `UR_REDIS_STORE_*`, `UR_REDIS_PUBSUB_CHANNEL`.
- Passwords must never be logged.

## Interrogator consumer (Phase 4)

- On `pbx-call-load-statistics`: upsert memory + `refreshAlive(ip, pbx_alive_ttl_sec)`.
- On `-delete`: remove memory + `clearAlive`.
- Restart: load `pbx.snapshot_path` → drop IPs where `isAlive` is false → subscribe.
- Live-call SoT remains Redis (`LiveCallStore`); Interrogator does **not** keep call maps in memory.

## Smoke

```bash
./scripts/redis-smoke.sh
./scripts/interrogator-smoke.sh
./scripts/live-call-lookup-smoke.sh
./scripts/redis-failover-smoke.sh
./scripts/dual-subscriber-smoke.sh
```

If pubsub or store Redis is unreachable, scripts print `SKIP: Redis … not available` and exit `0`.

Always-on (no Redis): `ctest` includes key-format and `PbxSelector` smokes.

## Architecture note

Full PBX IP list lives in **memory** (+ local `pbx.snapshot_path`), fed by Pub/Sub — **not** stored as a Redis registry. `pbx:alive:*` is TTL fallback presence only.
