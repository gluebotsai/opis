# External tool APIs

HTTP APIs for the coworker write tools. Every call uses an organization API key. No staff JWT and no session cookie.

```http
Authorization: Bearer wt_live_YOUR_KEY
Content-Type: application/json
```

`X-Api-Key: wt_live_YOUR_KEY` is the same key.

Replace `https://YOUR_API_HOST` with the Express host (for example `http://127.0.0.1:3000`).

Create the key in Ticketing → Org preferences → Integration keys. The raw value is shown once and starts with `wt_live_`.

If the JSON body includes `organizationId` or `organization_id`, it must match the key’s organization (**403** otherwise).

The key runs as one **Active agent** in that organization. Escalate, notes, and knowledge-base calls follow that agent’s permissions. Queue, priority, and status writes are **admin-only** on the staff handlers, so an agent key receives **403** for those.

MCP `/invoke` and coworker chat are separate. These routes do not change them.

Ticket numbers in the URL include `#`. Encode it as `%23`. Example: `#12899` → `%2312899`.

---

## 1. verify_ticket_customer

| | |
|--|--|
| **Method** | `POST` |
| **URL** | `/api/webchat/customers/verify` |

One of email or phone is required.

```json
{ "email": "riya@clienta.com" }
```

```json
{ "mobile": "+919876543210" }
```

```bash
curl -X POST "https://YOUR_API_HOST/api/webchat/customers/verify" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "email": "riya@clienta.com" }'
```

---

## 2. create_ticket

| | |
|--|--|
| **Method** | `POST` |
| **URL** | `/api/intake/tickets` |

The customer must already exist for that email or phone.

```json
{
  "channel": "chat",
  "requester": {
    "name": "Riya Sharma",
    "email": "riya@clienta.com"
  },
  "subject": "VPN not connecting",
  "description": "Unable to connect since morning",
  "priority": "high"
}
```

```bash
curl -X POST "https://YOUR_API_HOST/api/intake/tickets" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "chat",
    "requester": { "name": "Riya Sharma", "email": "riya@clienta.com" },
    "subject": "VPN not connecting",
    "description": "Unable to connect since morning"
  }'
```

**201**

```json
{
  "ticketId": "184291038472",
  "ticketNumber": "#12899",
  "status": "Open",
  "channel": "Chat",
  "subject": "VPN not connecting",
  "assignee": "Unassigned",
  "assigneeId": null,
  "createdAt": "2026-09-26T10:30:00.000Z",
  "updatedAt": "2026-09-26T10:30:00.000Z"
}
```

More fields (references, phone, aliases): [intake-api.md](./intake-api.md).

---

## Ticket status

Not one of the write tools. Same key, read-only.

| | |
|--|--|
| **Method** | `POST` |
| **URL** | `/api/intake/tickets/status` |

```json
{
  "ticketNumber": "#12899",
  "email": "riya@clienta.com"
}
```

```bash
curl -X POST "https://YOUR_API_HOST/api/intake/tickets/status" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "ticketNumber": "#12899", "email": "riya@clienta.com" }'
```

Wrong email → **404** `{ "error": "Ticket not found" }`.

---

## Update ticket status

Changes the status on an existing ticket. Same org API key as create. This is not `POST /api/integration/statuses` (that creates a status label and is admin-only).

| | |
|--|--|
| **Method** | `PUT` |
| **URL** | `/api/integration/tickets/:ticketNumber` |

`status` is required. It must already exist for the organization (`Open`, `Resolved`, `Closed`, or a custom label). Only `status` is applied. Other fields in the body are ignored.

```json
{ "status": "Resolved" }
```

```bash
curl -X PUT "https://YOUR_API_HOST/api/integration/tickets/%2312899" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "status": "Resolved" }'
```

The response is the updated ticket. Any ticket in the API key’s organization can be updated. Unknown ticket → **404**.

---

## 3. escalate_ticket

| | |
|--|--|
| **Method** | `POST` |
| **URL** | `/api/integration/tickets/:ticketNumber/escalate` |

`assignee_id`, `assignee`, `agent_id`, `agent`, and `rationale` are optional.

```json
{
  "assignee_id": "456",
  "assignee": "Resolver Name",
  "agent_id": "123",
  "agent": "Agent Name",
  "rationale": "Needs L2"
}
```

```bash
curl -X POST "https://YOUR_API_HOST/api/integration/tickets/%2312899/escalate" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "assignee_id": "456", "rationale": "Needs L2" }'
```

A resolver cannot escalate. The response is the staff escalate payload.

---

## 4. add_ticket_note

| | |
|--|--|
| **Method** | `POST` |
| **URL** | `/api/integration/tickets/:ticketNumber/notes` |

`text` is required. The stored note is internal.

```json
{ "text": "Called the customer. Waiting on logs." }
```

```bash
curl -X POST "https://YOUR_API_HOST/api/integration/tickets/%2312899/notes" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "text": "Called the customer. Waiting on logs." }'
```

---

## 5. create_queue

Admin. At least one member is required by the staff handler.

| | |
|--|--|
| **Method** | `POST` |
| **URL** | `/api/integration/queues` |

```json
{
  "name": "Billing",
  "description": "Invoices and refunds",
  "members": ["Ada Lovelace"]
}
```

`member_ids` may be sent instead of, or with, display names. Those ids come from the staff roster.

```bash
curl -X POST "https://YOUR_API_HOST/api/integration/queues" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Billing", "description": "Invoices and refunds", "members": ["Ada Lovelace"] }'
```

---

## 6. update_queue

Admin.

| | |
|--|--|
| **Method** | `PATCH` |
| **URL** | `/api/integration/queues/:queueId` |

`queueId` is the numeric team id from create or from the queues list. `add_members: true` adds people and keeps the current roster. Without it, `members` replaces the roster.

```json
{
  "description": "Invoices, refunds, and credits",
  "members": ["Priya Moorthy"],
  "add_members": true
}
```

```bash
curl -X PATCH "https://YOUR_API_HOST/api/integration/queues/42" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "description": "Invoices, refunds, and credits", "members": ["Priya Moorthy"], "add_members": true }'
```

---

## 7. create_kb_article

Title at least 2 characters. Content at least 10. Status becomes Published.

| | |
|--|--|
| **Method** | `POST` |
| **URL** | `/api/integration/kb` |

```json
{
  "title": "Reset VPN",
  "content": "Open the VPN client and choose Reconnect.",
  "category": "Network"
}
```

```bash
curl -X POST "https://YOUR_API_HOST/api/integration/kb" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Reset VPN",
    "content": "Open the VPN client and choose Reconnect.",
    "category": "Network"
  }'
```

---

## 8. draft_kb_article

Same body as create. Status becomes Draft.

| | |
|--|--|
| **Method** | `POST` |
| **URL** | `/api/integration/kb/draft` |

```json
{
  "title": "Reset VPN",
  "content": "Open the VPN client and choose Reconnect.",
  "category": "Network"
}
```

```bash
curl -X POST "https://YOUR_API_HOST/api/integration/kb/draft" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Reset VPN",
    "content": "Open the VPN client and choose Reconnect.",
    "category": "Network"
  }'
```

---

## 9. update_kb_article

| | |
|--|--|
| **Method** | `PATCH` |
| **URL** | `/api/integration/kb/:articleId` |

`articleId` is the id or `KB-…` external id from create, draft, or the article list. Send only the fields that change.

```json
{
  "title": "Reset VPN",
  "content": "Updated steps.",
  "category": "Network"
}
```

```bash
curl -X PATCH "https://YOUR_API_HOST/api/integration/kb/KB-1" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Updated steps." }'
```

---

## 10. publish_kb_article

| | |
|--|--|
| **Method** | `PATCH` |
| **URL** | `/api/integration/kb/:articleId/publish` |

No body fields are required. Status becomes Published.

```bash
curl -X PATCH "https://YOUR_API_HOST/api/integration/kb/KB-1/publish" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## 11. create_priority

Admin. `display_name` and `resolution_hours` are required. Hours must be greater than 0.

| | |
|--|--|
| **Method** | `POST` |
| **URL** | `/api/integration/priorities` |

```json
{ "display_name": "P1", "resolution_hours": 4 }
```

```bash
curl -X POST "https://YOUR_API_HOST/api/integration/priorities" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "display_name": "P1", "resolution_hours": 4 }'
```

---

## 12. update_priority

Admin. `priorityId` comes from the priorities list or from create.

| | |
|--|--|
| **Method** | `PATCH` |
| **URL** | `/api/integration/priorities/:priorityId` |

```json
{ "displayName": "P1", "resolutionHours": 2, "active": true }
```

```bash
curl -X PATCH "https://YOUR_API_HOST/api/integration/priorities/7" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "displayName": "P1", "resolutionHours": 2, "active": true }'
```

---

## 13. create_status

Admin.

| | |
|--|--|
| **Method** | `POST` |
| **URL** | `/api/integration/statuses` |

```json
{ "display_name": "Waiting on customer" }
```

```bash
curl -X POST "https://YOUR_API_HOST/api/integration/statuses" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "display_name": "Waiting on customer" }'
```

---

## 14. update_status

Admin. `statusId` comes from the statuses list or from create.

| | |
|--|--|
| **Method** | `PATCH` |
| **URL** | `/api/integration/statuses/:statusId` |

```json
{ "displayName": "Waiting on customer", "active": true }
```

```bash
curl -X PATCH "https://YOUR_API_HOST/api/integration/statuses/3" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "displayName": "Waiting on customer", "active": true }'
```

---

## Common errors

| HTTP | Meaning |
|------|---------|
| **401** | Missing or invalid API key |
| **400** | Required field missing (ticket number, note text, title, queue name, hours) |
| **403** | Body org does not match the key, no Active agent in the org, or the agent is not allowed (admin-only queue / priority / status) |
| **404** | Ticket, article, queue, priority, or status not in this org |
| **502** | Staff handler could not be reached |
