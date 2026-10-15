# Public ticket intake API (P0)

How **customer-channel** tickets are created from chatbot, email, web forms, and related integrations. Org tenant comes from the **API key** or **widget/portal auth** — not staff login.

Implementation: all paths below (except staff UI) call **`createTicketFromIntake`** in `ui-backend/src/server/intake.ts`.

Full integration overview: **`docs/INTEGRATIONS_README.md`**.

---

## How this relates to co-worker and support portal

| Surface | HTTP API | Auth |
|--------|----------|------|
| Staff co-worker / Create Ticket UI | `POST /api/tickets` | Session or co-worker service headers — **not** this doc |
| Support portal (logged-in customer) | `POST /api/portal/tickets` | Portal session cookie |
| **Generic intake (chatbot, CRM, telephony)** | **`POST /api/intake/tickets`** | Org API key |
| **Webchat / CCaaS (fixed JSON shape)** | **`POST /api/webchat/tickets`** | Org API key |
| **Inbound email provider** | **`POST /api/intake/email`** | Org API key |
| **Embedded help widget** | **`POST /api/public/widgets/:publicId/tickets`** | Public widget id + CORS (no secret in browser) |

Shared rules for intake-backed creates:

1. **Customer must already exist** in that org (CDP person + active `ticketing.contact_profile`). APIs do not register new customers.
2. Ticket stores **subject**, **description**, **channel**. Optional business entities go in **`references[]`** (persisted in `ticketing.ticket_references`). Org allowed types live in **`org_settings.intake_reference_policy`**.
3. **After insert**, triage (queue, assignee, resolver, category) runs asynchronously — same pattern as portal filing.
4. Provider routes (`/api/intake/tickets`, `/api/intake/email`, `/api/webchat/tickets` create) use **`skipDssa: true`** (no KB deflect on create). Portal UI may deflect before create unless the customer forces filing.

---

## Auth (server-to-server API keys)

Used by: **`POST /api/intake/tickets`**, **`POST /api/intake/tickets/status`**, **`POST /api/intake/email`**, **`POST /api/webchat/*`**.

| Header | Value |
|--------|--------|
| `Authorization` | `Bearer wt_live_…` |
| or `X-Api-Key` | `wt_live_…` |

- Create keys: Ticketing → Org preferences → Integration keys, or admin **`POST /api/integration/keys`** `{ "name": "Chatbot" }`.
- List: **`GET /api/integration/keys`**
- Revoke: **`DELETE /api/integration/keys/:id`**
- Secret shown **once** on create.

Optional internal auth (automation only): **`X-Internal-Service-Key`** + **`X-Ticketing-Org-Id`** on **`POST /api/intake/tickets`** when `INTERNAL_SERVICE_KEY` is configured.

If the JSON body includes **`organizationId`** / **`organization_id`**, it must match the key’s org (**403** otherwise).

---

## Optional `references[]` (all intake JSON bodies)

Canonical field. Each item is `{ "type": "order"|"product"|…, "id": "…" }`. Omit the array for a general ticket.

```json
"references": [
  { "type": "order", "id": "ORD-8821" },
  { "type": "product", "id": "SKU-123" },
  { "type": "product", "id": "SKU-456" }
]
```

B2B SaaS (product only — **order is not required**):

```json
"references": [{ "type": "product", "id": "PROD-456" }]
```

**Legacy aliases** (still accepted; normalized into `references[]`): `orderId` / `order_id` / `orderNumber` / `order_number`, `productId` / `product_id` / `productNumber` / `product_number`.

**Org policy** (`ticketing.org_settings.intake_reference_policy`):

```json
{
  "allowedTypes": ["order", "product"],
  "requiredTypes": [],
  "productRequiresOrder": false
}
```

Unknown `type` for that org → **400**. Empty `requiredTypes` → tickets with no references allowed.

**Validation**

- `order` must exist in **CDP** for this customer.
- `product` with order(s) on the same request: match a line on any of those orders when possible; otherwise org catalog (CDP products, then inventory).
- `product` without order: org catalog only.
- Duplicate ticket for the same customer + **order** ref → **409**.

**201** includes `references[]`. `orderId` / `productId` on the JSON are the first order / first product (compat aliases; not ticket columns).

---

## 1. Generic intake — chatbot, API channel, phone, etc.

**`POST /api/intake/tickets`**

| | |
|--|--|
| Content-Type | `application/json` |
| Auth | Org API key |

### Request — required

| Field | Notes |
|-------|--------|
| `channel_type` or `channel` | `email` → Email; `webchat` / `chat` → Webchat; `whatsapp` / `instagram` / `facebook` as those labels; `phone` → Phone; `web_form` / `web` / `api` → Web. Also accepts flat `name` / `email` / `mobile` / `issue` like webchat. |
| `requester.name` | Or flat **`customerName`** |
| `requester.email` **or** `requester.phone` | Or **`customerEmail`** / **`customerPhone`** — at least one contact required |

### Request — issue text

Send **`subject`** and **`description`** when possible. If one is missing, intake may derive it from the other.

### Request — optional

| Field | Notes |
|-------|--------|
| `priority` | `low` \| `medium` \| `high` \| `urgent` — default **medium** |
| `category` | Label string |
| `externalRef` / `external_ref` | External case / session id |
| `metadata` | Arbitrary JSON for tracing |
| `idempotencyKey` | Retry-safe: same key → **200** with existing ticket |
| `references` | See **Optional `references[]`** above |

### Sample — chatbot, general issue

```json
{
  "channel": "chat",
  "requester": {
    "name": "Riya Sharma",
    "email": "riya@clienta.com"
  },
  "subject": "VPN not connecting",
  "description": "Unable to connect since this morning on home Wi‑Fi.",
  "externalRef": "chat_session_9f2a1c",
  "metadata": {
    "source": "ccaas_bot"
  }
}
```

### Sample — chatbot, order + products

```json
{
  "channel": "chat",
  "requester": {
    "name": "Riya Sharma",
    "email": "riya@clienta.com"
  },
  "subject": "Wrong item received",
  "description": "Ordered blue jacket; received red.",
  "references": [
    { "type": "order", "id": "ORD-8821" },
    { "type": "product", "id": "SKU-JACKET-BLUE" },
    { "type": "product", "id": "SKU-LINER" }
  ]
}
```

### Sample — B2B SaaS (product only)

```json
{
  "channel": "chat",
  "requester": {
    "name": "Riya Sharma",
    "email": "riya@clienta.com"
  },
  "subject": "Cannot provision PROD-456",
  "description": "Seat add failed after checkout.",
  "references": [{ "type": "product", "id": "PROD-456" }]
}
```

### Sample — phone requester

```json
{
  "channel": "chat",
  "requester": {
    "name": "Riya Sharma",
    "phone": "+919876543210"
  },
  "description": "Need help resetting my portal password."
}
```

### Sample — flat customer aliases

```json
{
  "channel": "api",
  "customerName": "Riya Sharma",
  "customerEmail": "riya@clienta.com",
  "subject": "Billing question",
  "description": "Charged twice on last invoice.",
  "priority": "high",
  "externalRef": "crm_case_98213"
}
```

### `curl`

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

---

## 2. Webchat / CCaaS (narrow contract)

Same backend as generic intake; channel is always **Chat**. Browsable HTML docs: **`GET /api/webchat/tickets/docs`**.

| API | Method | Purpose |
|-----|--------|---------|
| `/api/webchat/tickets` | POST | Create ticket |
| `/api/webchat/tickets/lookup` | POST | One ticket by id+email, or last 5 by email/phone |
| `/api/webchat/articles/search` | POST | KB related-article check (`query`) |
| `/api/webchat/customers/verify` | POST | Verify org + customer exists |

Auth: org API key (same as generic intake).

### Create — **`POST /api/webchat/tickets`**

| Field | Required | Notes |
|-------|----------|--------|
| `name` | yes | Requester name |
| `email` **or** `mobile` / `phone` | yes (one) | Must match existing customer |
| `issue` | yes | Becomes subject + description |
| `references` | no | Same `references[]` as generic intake |
| `orderId` / `orderNumber`, `productId` / `productNumber` | no | Legacy aliases, merged into `references[]`. Product does **not** require order. |

**Sample**

```json
{
  "name": "Riya Sharma",
  "email": "riya@clienta.com",
  "issue": "VPN not connecting since morning"
}
```

**Sample with references**

```json
{
  "name": "Riya Sharma",
  "email": "riya@clienta.com",
  "issue": "Wrong item on order ORD-8821",
  "references": [
    { "type": "order", "id": "ORD-8821" },
    { "type": "product", "id": "SKU-JACKET-BLUE" }
  ]
}
```

**Success `201`**

```json
{
  "success": true,
  "ticketId": "184291038472",
  "ticketNumber": "#12899",
  "status": "Open",
  "channel": "Chat",
  "subject": "VPN not connecting since morning",
  "assignee": "Unassigned",
  "assigneeId": null,
  "resolver": null,
  "resolverId": null,
  "orderId": null,
  "productId": null,
  "references": [],
  "createdAt": "2026-09-26T10:30:00.000Z",
  "updatedAt": "2026-09-26T10:30:00.000Z"
}
```

**Customer not found `404`**

```json
{
  "success": false,
  "error": "there is no account for this customer"
}
```

More examples: **[README.md — Webchat integration APIs](./README.md#webchat-integration-apis)**.

---

## 3. Email adapter

**`POST /api/intake/email`**

Point SendGrid Inbound Parse, Mailgun, or a custom forwarder at this URL. Auth: org API key.

### Canonical JSON (new ticket)

```json
{
  "from": { "name": "Riya Sharma", "email": "riya@clienta.com" },
  "subject": "VPN not connecting",
  "text": "Unable to connect since morning",
  "messageId": "<abc@mail.example>",
  "priority": "medium",
  "category": "Access",
  "attachments": ["/uploads/screenshot.png"],
  "references": [
    { "type": "order", "id": "ORD-8821" },
    { "type": "product", "id": "SKU-12345" }
  ]
}
```

Also accepts SendGrid / Mailgun shapes (`from`, `text`, `html`, `body-plain`, `stripped-text`, …). Optional fields match generic intake: `priority`, `category`, `attachments` (`/uploads/…` only), `accountId`, `externalRef`, `idempotencyKey`, `metadata`, `phone`, plus ticket `references[]` / `orderId` / `productId`. MIME thread ids stay in `inReplyTo` / string `references`, not in `{ type, id }` objects.

### Behavior

| Result | HTTP | Meaning |
|--------|------|---------|
| New mail | **201** | Ticket created (`channel: Email`); `messageId` stored for threading |
| Reply threaded | **200** | Public note appended to existing ticket |
| Ignored | **200** | Duplicate message, ack mail, or no thread match |
| Deflected | **200** | Rare on this route (`skipDssa: true` on HTTP adapter) |

Replies match **`In-Reply-To` / `References`**, or subject contains **`#12345`** on an existing ticket number.

---

## 4. Help widget (embedded web form)

Browser embed — **no API secret** on the page. Public id: `wgt_…`.

1. Admin → Org preferences → Create Help widget (or **`POST /api/integration/widgets`**).
2. Embed:

```html
<script src="https://YOUR_HOST/embed/worktual-help.js" data-widget-id="wgt_…" async></script>
```

3. Form posts to **`POST /api/public/widgets/:publicId/tickets`** → `channel: web_form`.

Optional allowed origins (CORS). Empty = any origin (dev only).

### Sample body (same shape as intake requester + issue)

```json
{
  "name": "Riya Sharma",
  "email": "riya@clienta.com",
  "subject": "Cannot log in",
  "description": "Password reset link expired.",
  "requester": {
    "name": "Riya Sharma",
    "email": "riya@clienta.com"
  },
  "priority": "medium",
  "externalRef": "widget_submit_1",
  "references": [{ "type": "order", "id": "ORD-8821" }]
}
```

Response: **201** — same **`IntakeTicketResult`** shape as generic intake (no `success` wrapper).

---

## 5. Support portal (browser, not API key)

Customers logged into **`/support/{slug}`** file via:

**`POST /api/portal/tickets`**

Auth: portal session (OTP/password flow) — not for chatbot server-to-server use.

### Sample (portal client)

```json
{
  "subject": "VPN not connecting",
  "description": "Unable to connect since morning",
  "orderId": "ORD-8821",
  "productId": "SKU-12345",
  "forceCreate": false,
  "attachments": ["/uploads/file.pdf"]
}
```

| Field | Notes |
|-------|--------|
| `issue` | Alias for `description` |
| `forceCreate` | After KB guidance, customer insists on a ticket |
| `orderId` / `productId` | Same CDP validation as intake |

Portal may return **409** with **`deflected: true`** and KB **`reply`** before create when `forceCreate` is false.

---

## Check ticket status (intake)

**`POST /api/intake/tickets/status`**  
Auth: same org API key. Read-only.

```json
{
  "ticketNumber": "#12899",
  "email": "riya@clienta.com"
}
```

Also: `ticketId` / `ticket_id`, `customerEmail` / `customer_email`.

Ticket, org, and email must match; wrong email → **404** `{ "error": "Ticket not found" }` (no existence leak).

**Response `200`** — same fields as create (`ticketId`, `ticketNumber`, `status`, `channel`, `subject`, timestamps, optional `orderId` / `productId`).

---

## Success response (generic intake / widget / email create)

**`201 Created`** — **`POST /api/intake/tickets`**, widget, email create:

```json
{
  "ticketId": "184291038472",
  "ticketNumber": "#12899",
  "status": "Open",
  "channel": "Chat",
  "subject": "VPN not connecting",
  "orderId": null,
  "productId": null,
  "assignee": "Unassigned",
  "assigneeId": null,
  "resolver": null,
  "resolverId": null,
  "createdAt": "2026-09-26T10:30:00.000Z",
  "updatedAt": "2026-09-26T10:30:00.000Z"
}
```

Idempotent duplicate (`idempotencyKey`): **200** with the same ticket.

### Common errors (intake / webchat create)

| HTTP | Meaning |
|------|---------|
| **401** | Missing or invalid API key |
| **403** | Body `organizationId` ≠ key tenant; widget origin not allowed |
| **400** | Validation (channel, requester, order/product rules) |
| **404 / 422** | Customer not found for email/phone |
| **409** | Duplicate order ticket; portal DSSA deflect |
| **500** | Server error |

---

## Public help center (no ticket create)

KB search only — no login:

- Page: `https://YOUR_HOST/hc/{org-slug}`
- **`GET /api/public/help/:slug`**
- **`GET /api/public/help/:slug/articles?q=&category=`**
- **`GET /api/public/help/:slug/articles/:articleId`**

Published articles only.

---

## Outbound customer email

Automatic mail to the requester when:

- Ticket created (intake / widget / portal)
- Staff posts a **public** note
- Status set to **Resolved**

Configure **`MAIL_MODE`** + SMTP — see **`docs/INTEGRATIONS_README.md`** §6.

---

## Staff tool APIs (same org API key)

Sample payloads and `curl` for every tool: **[external-tool-apis.md](./external-tool-apis.md)**.

These routes use the same **`Authorization: Bearer wt_live_…`** (or `X-Api-Key`) as intake. No staff JWT and no session cookie. They call the existing staff handlers in-process. MCP `/invoke` and coworker chat are unchanged.

Already covered elsewhere in this doc:

| Tool | API |
|------|-----|
| `create_ticket` | `POST /api/intake/tickets` |
| ticket status | `POST /api/intake/tickets/status` |
| `verify_ticket_customer` | `POST /api/webchat/customers/verify` |

The key runs as one **Active agent** in the org (same rule as MCP session). Queue, priority, and status-catalog writes stay **admin-only** on the staff handlers, so an agent key receives **403** for those. Updating a ticket’s status, escalate, notes, and KB follow the agent rules already on those staff routes.

| Tool | Method | Path |
|------|--------|------|
| Update ticket status | PUT | `/api/integration/tickets/:ticketNumber` |
| `escalate_ticket` | POST | `/api/integration/tickets/:ticketNumber/escalate` |
| `add_ticket_note` | POST | `/api/integration/tickets/:ticketNumber/notes` |
| `create_queue` | POST | `/api/integration/queues` |
| `update_queue` | PATCH | `/api/integration/queues/:queueId` |
| `create_kb_article` | POST | `/api/integration/kb` |
| `draft_kb_article` | POST | `/api/integration/kb/draft` |
| `update_kb_article` | PATCH | `/api/integration/kb/:articleId` |
| `publish_kb_article` | PATCH | `/api/integration/kb/:articleId/publish` |
| `create_priority` | POST | `/api/integration/priorities` |
| `update_priority` | PATCH | `/api/integration/priorities/:priorityId` |
| `create_status` | POST | `/api/integration/statuses` |
| `update_status` | PATCH | `/api/integration/statuses/:statusId` |

Encode `#` in the ticket number as `%23`. Example: `#12899` → `%2312899`.

**Escalate**

```bash
curl -X POST "https://YOUR_API_HOST/api/integration/tickets/%2312899/escalate" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "assignee_id": "456", "rationale": "Needs L2" }'
```

**Note** (stored as internal, same as the staff notes route)

```bash
curl -X POST "https://YOUR_API_HOST/api/integration/tickets/%2312899/notes" \
  -H "Authorization: Bearer wt_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "text": "Called the customer. Waiting on logs." }'
```

**KB create** (draft uses `POST /api/integration/kb/draft` with the same body)

```json
{
  "title": "Reset VPN",
  "content": "Open the VPN client and choose Reconnect.",
  "category": "Network"
}
```

**KB update / publish**

```json
{ "content": "Updated steps." }
```

Publish sends no fields; status becomes Published.

**Queue** (admin)

```json
{ "name": "Billing", "description": "Invoices and refunds", "members": ["Ada Lovelace"] }
```

Update: `PATCH /api/integration/queues/42` with `add_members: true` to append members.

**Priority / status** (admin)

```json
{ "display_name": "P1", "resolution_hours": 4 }
```

```json
{ "display_name": "Waiting on customer" }
```

Updates use `displayName`, `resolutionHours`, and `active` on the patch routes.

---

## QA checklist (integrations)

1. Valid **`wt_live_…`** key; Ticketing product enabled for the org.
2. Test customer exists with the email/phone you send.
3. Order scenarios: order (+ SKU/product id) in CDP for that customer.
4. After **201**, ticket visible in Ticketing UI; assignee/queue may update after triage.

Related: [`ticketing-storage.md`](./ticketing-storage.md) (customers, orders, ticket fields).
