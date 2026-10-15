# Rebuild plan (phase summary)

| Phase | Focus | Outcome |
|-------|--------|---------|
| **0** | Scaffold | CMake C++23 binary, config/logger stubs, module headers, docs |
| **1** | App shell | **done** — validated config, logger redaction, lifecycle + signals |
| **2** | Controller + messages | **done** — `IModule` / `ModuleMessage`, Mediator routing, smoke test |
| **3** | Redis client + stores | **done** — `RedisClient`, `PbxPresenceStore`, read-only `LiveCallStore` |
| **4** | Interrogator core | **done** — Pub/Sub → `PbxSelector`, TTL reconcile, snapshot, `InterrogatorApi` |
| **5** | In-process API | **done** — Controller ↔ InterrogatorApi (no NetIO TCP); InviteRoute / LiveCallLookup / Register |
| **6** | SIP path | **done** — `SofiaAdapter` + `SipService` queue; inbound INVITE → InviteRoute → outbound `nua_invite` |
| **7** | HA + live-call reads | **done** — `call:live` field docs, Active-Active runbook, lookup/failover/dual-subscriber smokes |
| **8** | Cutover harden | **done** — expanded ctest, env secrets, invite+livecall smoke, CI, cutover/soak docs |

Later: least-load, sticky InviteRoute affinity, REGISTER/HTTP, client WSS (separate binary/cutover).

Reference behaviour from sibling trees; generate only under `ur-signaling/`.
