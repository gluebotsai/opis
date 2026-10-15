# CRM ↔ Ticketing handoff

How Worktual CRM hosts the **Ticketing module** (full console parity in iframe).

## UX

1. CRM nav item **Ticketing** opens iframe:
   `https://<ticketing-spa>/dashboard?embed=1`
2. CRM parent sends auth via `postMessage` (see [TICKETING_AUTH_HANDOFF.md](./TICKETING_AUTH_HANDOFF.md)).
3. Staff see the same Ticketing console with role gates (admin/agent/resolver/viewer).

## Path A — REST from CRM BFF

CRM session → mint CRM JWT → call Ticketing API directly:

```
Authorization: Bearer <CRM JWT>
GET https://<ticketing-api>/api/tickets
```

Ticketing verifies CRM JWT (`CRM_JWT_*` env vars). Product entitlement required.

## Path B — iframe embed

Preferred for full UI parity without re-building screens in CRM.

| Step | Action |
|------|--------|
| Load | iframe `?embed=1` |
| Auth | `postMessage { type: "worktual:ticketing-auth", token }` |
| API | SPA uses Bearer JWT on `/api/*` |

Set `TICKETING_FRAME_ANCESTORS` on Ticketing SPA/API to allow CRM origin in production.

### Local dev — CRM host mock

Open `http://127.0.0.1:3000/dev/crm-embed-host.html` (monolith) or point SPA URL to `http://127.0.0.1:5173/dashboard?embed=1` when using split mode. Paste a staff or CRM JWT and click **Send auth postMessage**.

## Outbound events (screen-pop / automations)

Subscribe to signed webhooks from Ticketing outbox:

| Event | When |
|-------|------|
| `ticket.created` | New ticket |
| `ticket.assigned` | Assignee set |
| `ticket.escalated` | Escalated |
| `ticket.status_changed` | Status change |
| `ticket.updated` | Other field updates |

Configure `TICKETING_WEBHOOK_URL` on Ticketing API. Verify `X-Worktual-Signature: sha256=<hmac>`.

## CRM responsibilities

- Mint CRM JWT with correct `sub` + org claim
- Ensure user has `ticketing` product in Accounts before embed/API
- Provide iframe parent origin in CSP / postMessage target

## Ticketing responsibilities

- Verify CRM JWT; enforce RBAC + product entitlement
- Serve embed mode SPA with frozen `/api/*` contract
- Emit outbound ticket events via outbox
