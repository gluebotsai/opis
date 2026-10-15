# Message API

## ModuleMessage (IURModuleMsg-inspired)

Value type in `src/common/Messages.h` — **no** raw ACE/`IURModuleMsg*` pointers.

| Field | Meaning |
|-------|---------|
| `src` | `ModuleId` of producer |
| `dst` | `ModuleId` of consumer |
| `type` | `MessageType` |
| `payload` | Opaque string (JSON/text); schema per type below |

### MessageType

| Type | Status | Use |
|------|--------|-----|
| `Dummy` | smoke | Controller → StubEcho ping |
| `InviteRoute` | **Phase 5/6** | SIP/`SipService` → `Controller::request` → `getNextPbxIp()` |
| `Register` | stub | `handleRegister` → `REGISTER_RES` |
| `LiveCallLookup` | **Phase 5** | `lookupLiveCall` → `LIVE_CALL_LOOKUP_RES` |

## Old TCP path (replaced)

SGW used NetIO TCP to an external Interrogator:

- `xGateSGWController::CreateTcpClient` / `m_interrogatorProfileList`
- `EN_XGATE_MSG_CONNECT_CLIENT` + `sendMsgToInterrogator`
- JSON `INVITE_REQ` ↔ `INVITE_RES` over the wire

**ur-signaling Phase 5:** Controller calls `InterrogatorApi` **in-process**. No NetIO module. Config `netio_module_profile.interagator_profile` from legacy `urengine.conf` is ignored.

## Controller::request (synchronous)

`Controller::setInterrogator(InterrogatorApi*)` (non-owning). If unset → `Result::err("interrogator not wired")`.

Response messages: `src=Controller`, `dst=req.src`, same `MessageType`.

### InviteRoute

**Request** (subset of old `INVITE_REQ`):

```json
{"msg_type":"INVITE_REQ","trans_id":"...","call_id":"...","calling_party":"...","called_party":"...","calling_party_domain":"...","called_party_domain":"...","key":""}
```

Phase 6 still uses `getNextPbxIp()` for new invites (affinity/`key` deferred). Producer is `SipService` after inbound Sofia INVITE (or tests via `Controller::request`).

**Success response:**

```json
{"msg_type":"INVITE_RES","trans_id":"...","call_id":"...","route_pbx_ip":"...","ok":true}
```

**Failure response:**

```json
{"msg_type":"INVITE_RES","trans_id":"...","error_reason":"...","ok":false}
```

**Omit `password`** — old Interrogator `INVITE_RES.password` is never returned or logged.

### LiveCallLookup (mid-call read)

**Path:** `Controller::request` → `InterrogatorApi::lookupLiveCall` → read-only `LiveCallStore` (`call:live:<uid>`). PBX is the only writer. No in-memory `client-call-info` maps on the merged node.

**Request:**

```json
{"msg_type":"LIVE_CALL_LOOKUP","call_uid":"..."}
```

**Response:**

```json
{"msg_type":"LIVE_CALL_LOOKUP_RES","call_uid":"...","found":true,"client_call_info":"...","call_hosted_info":"..."}
```

When not found: `"found":false` (optional info fields omitted). Inner JSON field names: see `docs/redis-keys.md`.

### Register

**Request** (`REGISTER_REQ` JSON): `username`, `domain`, `device_type`, `app_type`, `contact_address`, `transport_type` (`udp`/`wss`/`tls`/…), `expires`, `sgw_ip`, optional `authorization` `{username,realm,nonce,uri,response}`.

**Response:**

```json
{"msg_type":"REGISTER_RES","accepted":false,"need_challenge":true,"realm":"...","nonce":"...","detail":"challenge"}
```

On success: `accepted=true`, `contact` for SIP 200 (includes `;transport=wss` when Via was WSS). Unregister (`expires=0`) deletes binding key on store Redis. INVITE routing does **not** use registration bindings (PBX RR only). WSS listen: [`docs/wss.md`](wss.md).

## InterrogatorApi (in-process)

Implemented by `InterrogatorService` — **not** NetIO/TCP.

| Method | Behaviour |
|--------|-----------|
| `getNextPbxIp()` | Local round-robin from in-memory `PbxSelector` |
| `lookupLiveCall(uid)` | Read-only `LiveCallStore` (`call:live:<uid>`) |
| `handleRegister(...)` | Digest 401 + store Redis credentials/binding (`RegistrationStore`) |

### Redis Pub/Sub → memory (Phase 4)

Channel: config `redis.pubsub_channel` (default `InterrogatorEvent`).

| `msg_type` | Action |
|------------|--------|
| `pbx-call-load-statistics` | Upsert memory (`pbx_addr`, `cpu_usage`, `memory_usage`, `network_io_usage`, `cps`) + `refreshAlive` |
| `pbx-call-load-statistics-delete` | Remove memory + `clearAlive` |

Other message types (e.g. `client-call-info*`) ignored here — live-call SoT remains Redis.

Restart: load `pbx.snapshot_path` → drop IPs with expired `pbx:alive:<ip>` → subscribe → periodic snapshot.

## SIP path (Phase 6)

```
inbound nua_i_invite (Sofia thread)
  → enqueue InboundInvite
  → SipService worker → Controller InviteRoute
  → DialOut on Sofia thread → nua_invite toward route_pbx_ip
```

No NetIO; no password; no SIP→Redis. Smoke: `scripts/sip-invite-smoke.sh` (UAC + Pub/Sub PBX).

## Controller (Mediator)

`registerModule` / `handleModuleCallbackMsg` / `push` — module routing (Phase 2).  
`setInterrogator` / `request` — in-process Interrogator (Phase 5).
