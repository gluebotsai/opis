# CCaaS ↔ Ticketing handoff

How Worktual CCaaS integrates with the Ticketing spoke.

## Module UX

| Surface | Purpose |
|---------|---------|
| **Full module** | iframe `?embed=1` — same as CRM (see [CRM_TICKETING_HANDOFF.md](./CRM_TICKETING_HANDOFF.md)) |
| **Call-time panel** | Lightweight ticket context beside active call |
| **Intake on interaction** | Create/link ticket when call or chat starts |

## Inbound — create tickets

### Org API key (standard)

```
POST /api/intake/tickets
Authorization: Bearer wt_live_…
Content-Type: application/json

{
  "channel": "phone",
  "requester": { "name": "...", "phone": "..." },
  "subject": "Inbound call",
  "description": "…",
  "externalRef": "call-session-id"
}
```

### Internal service key (spoke-to-spoke)

When CCaaS core already authenticated the tenant:

```
POST /api/intake/tickets
X-Internal-Service-Key: <INTERNAL_SERVICE_KEY>
X-Ticketing-Org-Id: <ticketing org uuid>
Content-Type: application/json

{ "channel": "call", "requester": { ... }, "subject": "…" }
```

`organizationId` in body must match header org if present.

## Outbound — screen-pop / automations

Same webhook outbox as CRM. Set `TICKETING_WEBHOOK_URL` on Ticketing API.

Useful events for CCaaS:

- `ticket.created` — pop ticket panel on new intake
- `ticket.assigned` — update agent desktop
- `ticket.escalated` — supervisor alerts
- `ticket.status_changed` / `ticket.updated` — sync call disposition

## Auth for embedded module

Identical to CRM embed:

1. `?embed=1`
2. `postMessage { type: "worktual:ticketing-auth", token }`
3. Bearer JWT on API calls

Or Path A CRM-style JWT on REST calls from CCaaS BFF.

## CCaaS responsibilities

- Map call/chat metadata to intake payload (`channel`, `externalRef`, `metadata`)
- Mint or relay JWT with ticketing product entitlement
- Handle signed outbound webhooks

## Ticketing responsibilities

- Intake → same ticket table as staff UI
- RBAC unchanged for agents working tickets
- SLA/mail automation outside CCaaS process

See [intake-api.md](./intake-api.md) and [INTEGRATIONS_README.md](./INTEGRATIONS_README.md).
