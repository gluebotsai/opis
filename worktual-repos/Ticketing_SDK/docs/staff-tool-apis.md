# Staff tool APIs

HTTP calls for the 15 coworker tools. These hit Express. They are staff APIs, not the public intake API in `docs/intake-api.md`.

The server listens on **`0.0.0.0`** (this machine and the LAN).

## Host and ports

| Use | Base URL |
|---|---|
| This machine | `http://127.0.0.1:3001` |
| LAN (example from this network) | `http://192.168.13.42:3001` |
| Full app process (UI + API together) | `http://127.0.0.1:3000` |
| Vite UI (proxies `/api` to 3001) | `http://127.0.0.1:5173` |
| Docker API | port **4000** |
| Docker web | port **3355** |

`192.168.13.42` is the LAN address recorded for this machine. If the address changes, use the current LAN IP with the same port.

Start the API-only server:

```bash
cd ui-backend
npm run dev:api
```

That binds **`http://0.0.0.0:3001`**.

Other processes, not required for the calls below:

| Process | Port |
|---|---|
| Coworker agents | `8012` |
| MCP tool bridge (`POST /invoke`) | `8020` |

Replace `BASE` in the samples with one of the base URLs above.

```bash
BASE=http://127.0.0.1:3001
```

## Auth

Most routes accept either a staff session or the coworker service headers.

**Staff session** (after login):

```http
Authorization: Bearer <staff JWT>
```

The browser sends the session cookie instead. `GET /api/analytics/export` accepts the session only, not the service headers.

**Service actor** (server to server):

```http
X-Coworker-Tasks-Key: <COWORKER_TASKS_SECRET>
X-Coworker-Actor-Id: <numeric staff user id>
X-Coworker-Org-Id: <organization id>
X-Coworker-Actor-Role: admin
```

The actor must already be a staff user in that org. Admin-only routes reject agents and resolvers.

Ticket numbers in the path include `#`. Encode it as `%23`. Example: `#1042` → `%231042`.

---

## 1. create_ticket

`POST /api/tickets`

Who: staff who can create tickets.

```bash
curl -sS -X POST "$BASE/api/tickets" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Ada Lovelace",
    "customerEmail": "ada@example.com",
    "subject": "VPN down",
    "description": "Cannot connect since this morning.",
    "channel": "Email",
    "priority": "high",
    "queue": "Bug Solvers",
    "assignee": "Agent Name",
    "assigneeId": "123",
    "resolver": "Resolver Name",
    "resolverId": "456"
  }'
```

Required in practice: subject, description, an existing customer (name plus email or phone), channel, priority, queue, and assignee. Resolver is optional.

## 2. verify_ticket_customer

There is no `/verify` route. The tool looks the person up with one of these:

```bash
curl -sS "$BASE/api/customers?exactEmail=ada@example.com" \
  -H "Authorization: Bearer $TOKEN"

curl -sS "$BASE/api/customers?exactPhone=9876543210" \
  -H "Authorization: Bearer $TOKEN"
```

Send **one** of `exactEmail`, `exactPhone`, or `customerId`. Not two.

| Result | Meaning |
|---|---|
| One customer | On file. Safe to file a ticket for them. |
| No customer | Not on file. Do not create a ticket. |
| More than one | Contact is ambiguous. Ask which person. |

Who: a role that can open Customers.

## 3. escalate_ticket

`POST /api/tickets/:ticketNumber/escalate`

Who: staff who can change tickets. Resolvers cannot call this.

```bash
curl -sS -X POST "$BASE/api/tickets/%231042/escalate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assignee": "Resolver Name",
    "assigneeId": "456",
    "agent": "Agent Name",
    "agentId": "123",
    "rationale": "Needs L2"
  }'
```

`ticketNumber` is required. Assignee and agent fields are optional.

## 4. add_ticket_note

`POST /api/tickets/:ticketNumber/notes`

Who: staff who can change tickets. The note is stored as internal.

```bash
curl -sS -X POST "$BASE/api/tickets/%231042/notes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "text": "Called the customer. Waiting on logs." }'
```

`text` is required.

## 5. create_queue

`POST /api/queues`

Who: admin.

```bash
curl -sS -X POST "$BASE/api/queues" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "Billing",
    "description": "Invoices and refunds",
    "members": ["Ashika A"]
  }'
```

`queueName` (or `name`) is required. At least one member is required. `members` are staff display names. `memberIds` are numeric staff ids.

## 6. update_queue

`PATCH /api/queues/:id`

Who: admin.

```bash
curl -sS -X PATCH "$BASE/api/queues/42" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "Billing",
    "description": "Invoices, refunds, and credits",
    "members": ["Priya Moorthy"],
    "addMembers": true
  }'
```

`:id` is the team id from `GET /api/queues`. `addMembers: true` adds people and keeps the current roster. Without it, `members` / `memberIds` replace the roster.

## 7. create_kb_article

`POST /api/kb`

Who: staff who can edit the knowledge base. Resolvers are read-only.

```bash
curl -sS -X POST "$BASE/api/kb" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Reset VPN",
    "content": "Open the VPN client and choose Reconnect.",
    "category": "Network",
    "status": "Published"
  }'
```

`title`, `content`, and `category` are required. Title at least 2 characters. Content at least 10. Omit `status` and the article is published.

## 8. draft_kb_article

Same path as create. Set status to draft.

```bash
curl -sS -X POST "$BASE/api/kb" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Reset VPN",
    "content": "Open the VPN client and choose Reconnect.",
    "category": "Network",
    "status": "Draft"
  }'
```

## 9. update_kb_article

`PATCH /api/kb/:id`

`:id` is the article id or external id.

```bash
curl -sS -X PATCH "$BASE/api/kb/KB-ARTICLE-ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Reset VPN",
    "content": "Updated steps.",
    "category": "Network"
  }'
```

Send only the fields that change.

## 10. publish_kb_article

`PATCH /api/kb/:id` with published status.

```bash
curl -sS -X PATCH "$BASE/api/kb/KB-ARTICLE-ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "Published" }'
```

`status` is `Draft` or `Published`.

## 11. create_priority

`POST /api/priorities`

Who: admin.

```bash
curl -sS -X POST "$BASE/api/priorities" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "displayName": "P1", "resolutionHours": 4 }'
```

`displayName` and `resolutionHours` are required.

## 12. update_priority

`PATCH /api/priorities/:id`

```bash
curl -sS -X PATCH "$BASE/api/priorities/7" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "displayName": "P1", "resolutionHours": 2, "active": true }'
```

`:id` comes from `GET /api/priorities`.

## 13. create_status

`POST /api/statuses`

Who: admin.

```bash
curl -sS -X POST "$BASE/api/statuses" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "displayName": "Waiting on customer" }'
```

## 14. update_status

`PATCH /api/statuses/:id`

```bash
curl -sS -X PATCH "$BASE/api/statuses/3" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "displayName": "Waiting on customer", "active": true }'
```

`:id` comes from `GET /api/statuses`.

## 15. export_analytics

`GET /api/analytics/export?range=7days`

Who: staff session with analytics access. Service headers are not accepted on this route.

```bash
curl -sS -L "$BASE/api/analytics/export?range=7days" \
  -H "Authorization: Bearer $TOKEN" \
  -o analytics.csv
```

`range` is `24hours`, `7days`, or `30days`. Default is `7days`. The response is a CSV file download, not JSON.

The coworker tool of the same name only returns the path `/api/analytics/export?range=…`. This GET is the call that returns the file.

---

## Quick list

| Tool | Method and path |
|---|---|
| create_ticket | `POST /api/tickets` |
| verify_ticket_customer | `GET /api/customers?exactEmail=` or `?exactPhone=` |
| escalate_ticket | `POST /api/tickets/:ticketNumber/escalate` |
| add_ticket_note | `POST /api/tickets/:ticketNumber/notes` |
| create_queue | `POST /api/queues` |
| update_queue | `PATCH /api/queues/:id` |
| create_kb_article | `POST /api/kb` |
| draft_kb_article | `POST /api/kb` with `"status": "Draft"` |
| update_kb_article | `PATCH /api/kb/:id` |
| publish_kb_article | `PATCH /api/kb/:id` with `"status": "Published"` |
| create_priority | `POST /api/priorities` |
| update_priority | `PATCH /api/priorities/:id` |
| create_status | `POST /api/statuses` |
| update_status | `PATCH /api/statuses/:id` |
| export_analytics | `GET /api/analytics/export?range=7days` |
