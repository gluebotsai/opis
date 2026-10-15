# CRM embed — socket transport vs `join_session` (fix tracker)

Cross-team note for **CRM Marketing iframe** and **Campaign FE/agents**. See also [CRM_IFRAME_SETUP.md](CRM_IFRAME_SETUP.md).

---

## CRM embed model (agreed)

- **One iframe**, no reload on Marketing tab switch.
- CRM sends **`worktual:campaign-navigate`** with Campaign paths (Create, Drafts, Dashboard).
- CRM sends **`worktual:campaign-auth`** on load and on **real** JWT refresh only—not the same token on every tab click.

Campaign runs **`router.push`** inside the iframe (`CampaignEmbedBridge`).

---

## Issues reported by CRM

1. Co-worker appears to **reconnect on every Marketing tab switch**.
2. **First draft open:** *“Still connecting to co-worker — wait a moment, then send again.”* **Hard refresh** of the same draft allows send.

---

## Root cause (Campaign FE)

| Symptom | Cause |
|--------|--------|
| Transport reconnect storms | `refreshAgentsSocketAuth()` **disconnected** an already-connected `/agents-socket` when JWT **unchanged** (duplicate embed auth, `ensureAgentsSocketReady()` on Dashboard mount). |
| “Still connecting…” with pings only | (1) After **`io client disconnect`**, **`join_session` was not retried** if the draft effect only joined when `socket.connected` at mount and **never registered `connect`** for later reconnects. (2) **`joinIssuedRef`** could block re-join after auth refresh. |
| Duplicate agent greets | Agents emit **two `session_ready`** per `join_session`; FE static welcome + follow-up ready + orphan flush could duplicate assistant rows. |
| Hub `join_session` on a draft URL + **`44"Unable to connect"`** | Hub `connect` listener stayed armed until unmount, so a reconnect/handoff race joined `hub-*` on `/campaigns/create/{draftUuid}`. Hub `leave_session` then **wiped the draft Engine.IO binding**. Namespace `44` left `joinIssued` true with no `session_ready` → “Finishing co-worker setup…”. |

**Agents:** `join_session` already emits `session_ready` (early + after setup). Failure was **client not completing/retrying join**, not missing server ready in the common case.

---

## Transport vs `join_session` (for CRM)

| Layer | Tab switch behaviour |
|-------|----------------------|
| **Transport** (`/agents-socket`) | **Should stay connected** when JWT unchanged. |
| **Logical session** | Create hub, draft UUID, and Dashboard use **different `session_id`s**. Mount/unmount may emit **`leave_session` / `join_session`** on the **same** socket—that is **not** a full reconnect. |

CRM should **not** ask Campaign to never call `join_session` when switching modules; Campaign should **not** disconnect the shared socket for soft-nav.

---

## FE fixes (Campaign repo)

- **`agents.socket.ts`:** Skip reconnect when connected with same JWT; track auth on connect/disconnect.
- **`main.tsx`:** `refreshAgentsSocketAuth()` only when embed token **changes**.
- **`CreateCampaignChatWorkspace.tsx`:** Reset join on real disconnect only (keep ready on `io client disconnect`); **send when transport connected** (no “Finishing setup…” gate); protect local thread on follow-up `session_ready` during in-flight turns; no `seed_user_message` if user already sent; claim draft session; retry after **`44` / connect_error**.
- **`DashboardWorkspace.tsx`:** **Static dashboard welcome on mount** (`skip_welcome: true`); preserve optimistic user rows on `session_ready`; join via `emitJoinSession` with cleanup (no leaked `once('connect')`). **`update_dashboard_period`** async effect uses **`cancelled`** + skips when **`claimedCreateCampaignSocketSession()`**; **`leave_session`** on unmount; dispose pending period emit on cleanup.
- **`agents-join.ts`:** **`emitUpdateDashboardPeriod`** returns dispose; skips emit when create draft owns the socket.
- **`create-campaign-chat-bridge.ts`:** **`connect_error`** (`Unable to connect`) clears in-flight turn UI.
- **`CreateCampaignChatWorkspace.tsx`:** On **`44` / Unable to connect**, clear bridge awaiting + re-**`join_session`**.
- **`agents-join.ts`:** `emitJoinSessionNow` for retries; `emitJoinSession` returns dispose for reconnect join.
- **`CreateCampaignHubWorkspace.tsx`:** Detach hub `connect` → join **before** navigating to a draft; skip hub join after handoff; do not `leave_session` again on unmount after handoff.
- **`agents-join.ts`:** Single-flight claim so hub cannot `join_session` after the draft owns the socket.
- **`agents/app/socket_server.py`:** `leave_session` for `hub-*` does **not** clear a different session already bound on that sid.
- **`agents-chat-runtime.ts`:** Shared **`session_ready` merge** (`applySessionReadyChatMessages`), static module welcomes + **`skip_welcome: true`**, assistant dedupe, **`isAgentBusyError`** (matches agents `code: "agent_busy"`).
- **Agents `session_ready`:** First emit **`ready_phase: "initial"`**, follow-up **`ready_phase: "hydration"`** — FE must not wipe an in-flight user turn on hydration while sending/typing.
- **Modules wired (P1):** Dashboard, Create draft/hub, Audience, Reports, Monitoring, Events, Recommendations — `getAgentsSocket()` + `bindJoinOnConnect` / `emitJoinSession` dispose; preserve local transcript on busy hydration ready.

---

## Acceptance criteria

- [ ] New login → open draft → send soon after: no “Still connecting…” when WS shows `join_session` + `session_ready` for **URL draft UUID**.
- [ ] Create ↔ Drafts ↔ Dashboard soft-nav, same JWT: no unnecessary transport disconnect loop.
- [ ] Reconnect on same draft: **re-`join_session`** without full page refresh.
- [ ] One user turn → one agent reply (no double greeting from recovery/duplicate ready).

---

## Verification (DevTools)

1. Network → **All** → filter **`agents-socket`** (not “worktual”).
2. **Preserve log** on.
3. Confirm outgoing **`join_session`** with `session_id` = draft id in URL.
4. Confirm incoming **`session_ready`** with same id before send.

---

## Suggested reply to CRM

> We fixed unnecessary `/agents-socket` disconnects when the JWT is unchanged, and a bug where the draft chat did not re-join after reconnect (causing “Still connecting…” until refresh). Please keep one iframe and `worktual:campaign-navigate`; avoid duplicate `worktual:campaign-auth` on tab switch. `join_session` may still run when switching Create/Drafts/Dashboard because session ids differ—that is on one persistent socket. Retest on the latest Campaign web build.

---

## Key files

- `frontend/src/services/agents.socket.ts`
- `frontend/src/main.tsx`
- `frontend/src/lib/agents-join.ts`
- `frontend/src/components/campaigns/CreateCampaignChatWorkspace.tsx`
- `frontend/src/components/campaigns/CreateCampaignHubWorkspace.tsx`
- `frontend/src/components/embed/CampaignEmbedBridge.tsx`
- `agents/app/socket_server.py` (`join_session`, `leave_session`, dual `session_ready`)
