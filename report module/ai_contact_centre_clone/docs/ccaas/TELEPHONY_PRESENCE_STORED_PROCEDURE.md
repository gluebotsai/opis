# Telephony presence (Unified Media Node)

Contract for the **Unified Media Node (UMN)**. UMN is the only writer of `ccass.agent_presence`. cc-core publishes presence intent on Redis and reads the committed row. The media node must not write `cc:presence:*` or `org:{organizationId}:cc:presence:*` as authority.

If a stored procedure updates presence, UMN is its only caller. cc-core, the workspace, and the media node do not call it.

Each committed notification includes `version`, `updatedAt`, and `source`, plus the same organization, user, and operation correlation the browser sent. cc-core emits that version to the agent and ignores older versions.

CCaaS table: `ccass.agent_presence` (unique on `agent_id`). History: `ccass.agent_presence_history`.

Related: [Agent Presence](../nlp-backend/PRESENCE_REDIS_CACHE.md).

---

## What this team may change

Only these three outcomes. Never set `ready` or `offline` from media node. The agent (workspace) or a supervisor puts the agent back to Ready.

| Scenario | `presence_state` | `reason_code` | `source` |
|----------|------------------|---------------|----------|
| Agent reached and **answered** | `busy` | `on_call` | `telephony` |
| Agent **not reached** | `not_ready` | `not_reached` | `telephony` |
| **Dial-out timeout** (rang, no answer in time) | `away` | `offer_timeout` | `telephony` |

State strings are lowercase and exact: `busy`, `not_ready`, `away`.

`away` + `offer_timeout` matches CCaaS missed-offer behaviour. The workspace heartbeat keeps that Away until the agent changes presence. Heartbeat never rewrites `presence_state`.

---

## Lookup before the SP

`ext` is **not** a column on `ccass.agent_presence`. Do not pass `ext` into the procedure.

1. Resolve unique `(organization_id, ext)` → `ccass.agents.id`.
2. Confirm that agent belongs to the same `organization_id`.
3. Call the procedure with `agent_id`.

If lookup fails, do not write presence.

---

## Stored procedure arguments

Suggested signature (implement on the CCaaS database; name may vary):

```sql
ccass.set_agent_presence_from_telephony(
  p_organization_id  bigint,
  p_agent_id         bigint,
  p_presence_state   text,   -- busy | not_ready | away
  p_source           text,   -- telephony
  p_reason_code      text
)
```

| Argument | Type | Required | Notes |
|----------|------|----------|--------|
| `p_organization_id` | bigint | Yes | Tenant. Must match `ccass.agents.organization_id`. |
| `p_agent_id` | bigint | Yes | `ccass.agents.id` from the ext lookup. |
| `p_presence_state` | text | Yes | `busy`, `not_ready`, or `away` only. |
| `p_source` | text | Yes | Always `telephony`. |
| `p_reason_code` | text | Yes | Always send. **Required** for `not_ready`. For timeout use `offer_timeout`. |

Reject the call if:

- `p_presence_state` is not `busy`, `not_ready`, or `away`
- `p_presence_state = 'not_ready'` and `p_reason_code` is null or blank
- no `ccass.agents` row for that org + agent

Set session tenant (RLS) or run `SECURITY DEFINER` **and** still filter every statement by `organization_id`.

---

## What the procedure must write

### `ccass.agent_presence`

Upsert on unique `agent_id`. Set **both** `status` and `presence_state` to the same value.

| Column | Value |
|--------|--------|
| `organization_id` | `p_organization_id` |
| `agent_id` | `p_agent_id` |
| `status` | same as `p_presence_state` |
| `presence_state` | `p_presence_state` |
| `reason_code` | `p_reason_code` |
| `source` | `telephony` |
| `heartbeat_at` | `NOW()` |
| `lease_expires_at` | **`NULL`** (lease is only for Ready) |
| `updated_at` | `NOW()` if state changed, else leave |
| `version` | `version + 1` |

### `ccass.agent_presence_history`

Insert **only if** previous `presence_state` is distinct from the new state:

| Column | Value |
|--------|--------|
| `organization_id` | `p_organization_id` |
| `agent_id` | `p_agent_id` |
| `previous_state` | current `presence_state` (or `status`) |
| `new_state` | `p_presence_state` |
| `reason_code` | `p_reason_code` |
| `source` | `telephony` |
| `started_at` | default `NOW()` |
| `ended_at` | `NOW()` |

Same state sent twice → no history row.

### Notification after the SQL commit

Do not write Redis presence keys. Publish the committed row on `AGENT_PRESENCE_SUB` so cc-core can reread Postgres and emit a versioned socket event.

```json
{
  "organizationId": "1000",
  "agentId": "501",
  "userId": "42",
  "state": "busy",
  "reasonCode": "on_call",
  "updatedAt": "2026-09-14T14:30:00.000Z",
  "version": 4,
  "source": "telephony"
}
```

`version` increases on every committed change. `state` and `reasonCode` match the scenario.

---

## Scenarios and sample payloads

IDs below are examples. Substitute the real org and the `agent_id` returned from ext lookup.

### 1. Agent reached and answered → Busy

Agent is on the live call. Stop offering more live work.

**JSON**

```json
{
  "organization_id": 1000,
  "agent_id": 501,
  "presence_state": "busy",
  "source": "telephony",
  "reason_code": "on_call"
}
```

**SQL**

```sql
SELECT ccass.set_agent_presence_from_telephony(
  1000,
  501,
  'busy',
  'telephony',
  'on_call'
);
```

---

### 2. Agent not reached → Not Ready

Tried the extension; could not get the agent (not a ring-timeout). Agent stays logged in but takes no new work until they click Ready in the workspace.

**JSON**

```json
{
  "organization_id": 1000,
  "agent_id": 501,
  "presence_state": "not_ready",
  "source": "telephony",
  "reason_code": "not_reached"
}
```

**SQL**

```sql
SELECT ccass.set_agent_presence_from_telephony(
  1000,
  501,
  'not_ready',
  'telephony',
  'not_reached'
);
```

---

### 3. Dial-out timeout → Away

Rang the agent; no answer within the dial-out timer. Same presence as a CCaaS missed ringing offer.

**JSON**

```json
{
  "organization_id": 1000,
  "agent_id": 501,
  "presence_state": "away",
  "source": "telephony",
  "reason_code": "offer_timeout"
}
```

**SQL**

```sql
SELECT ccass.set_agent_presence_from_telephony(
  1000,
  501,
  'away',
  'telephony',
  'offer_timeout'
);
```

---

## Payloads to reject

| Payload | Why |
|---------|-----|
| `"presence_state": "ready"` | Media node must not make the agent available. |
| `"presence_state": "offline"` | Logout is CCaaS auth, not telephony. |
| `"presence_state": "Busy"` | Must be lowercase `busy`. |
| `"presence_state": "not_ready"` with null / missing `reason_code` | Not Ready always needs a reason. |
| Missing `agent_id` or only `ext` | Resolve ext first; SP keys on `agent_id`. |
| `agent_id` that does not belong to `organization_id` | Tenant isolation. |

---

## Out of scope for media node

- Workspace / monitoring UI and sockets (`presence.updated`).
- Releasing in-flight ringing offers (that happens on the CCaaS presence API).
- Setting Ready after hangup. After these three outcomes the agent (or supervisor) sets Ready.

---

## Quick flow

```text
ext → agent_id (media node lookup, unique per org)

answered            →  busy       + on_call
not reached         →  not_ready  + not_reached
dial-out timeout    →  away       + offer_timeout

Then: UMN upserts agent_presence and history when the state changed. It does not write Redis presence keys.
```
