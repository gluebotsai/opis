# Architecture

`ur-signaling` is a **merged node**: Signaling Gateway controller path + Interrogator PBX/live-call logic in one process.

## Locked design

- **PBX IPs:** Redis Pub/Sub → in-memory `PbxSelector`; local snapshot on restart; Redis TTL `pbx:alive:<ip>` as fallback only (not a full Redis registry).
- **Live calls:** Redis `call:live:<uid>`; **PBX writes only**; merged node **reads only** via `LiveCallStore`.
- **Dual nodes:** Active-Active; each node round-robins locally.
- **Dual Redis:** pubsub (events) + store (keys); no HA fallback.
- **SIP transports:** UDP always; optional WSS + TLS when `sip.wss_listen` + `certificate_dir` are set (Sofia with `NUTAG_WSS_URL` — see [`wss.md`](wss.md)).

## Communication (v1)

```
SofiaAdapter (Sofia/Receiver thread) → SipService worker queue
  → Controller::request(InviteRoute) → InterrogatorApi::getNextPbxIp()
  → SofiaAdapter DialOut command → nua_invite (Sofia thread only)
Interrogator → LiveCallStore (read Redis)
Interrogator → Redis Pub/Sub (PBX events) → PbxSelector (memory)
Interrogator → PbxPresenceStore (TTL check/refresh)
```

### Thread affinity (Phase 6)

| Thread | Owns | May call |
|--------|------|----------|
| Sofia / Receiver | `su_root`, `nua`, handle create/destroy/`nua_invite` | Enqueue to SipService only |
| Sip worker | inbound job queue | `Controller::request` only — never `nua_*` |
| Main | lifecycle | start/stop order |

Handle destroy: each Leg-A / Leg-B once, on Sofia thread only (avoid SGW double-delete / wrong-leg destroy).

Forbidden: SIP→Redis directly; Controller→external Interrogator TCP; merged node writing `call:live:*`; routing math inside `SofiaAdapter`.