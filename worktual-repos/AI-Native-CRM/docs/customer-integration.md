# Customer integration API

For tenants who buy Worktual CRM and want to connect a chatbot, website, or ERP.

## Auth

1. Sign in as a tenant **admin**.
2. Open **Configuration → Developers**.
3. Create an API key and copy the secret **once**.
4. Call the API with:

```http
Authorization: Bearer crm_live_….…
Content-Type: application/json
```

Browser UI sessions still use cookies. Machine integrations should use Bearer keys only.

## Response envelope

Success and errors use:

```json
{ "statusCode": 200, "message": "…", "…payload fields" }
```

Interactive OpenAPI: `GET /docs` on the API host (same origin as `/api` when using the Vite proxy).

## Scopes

| Scope | Typical routes |
|---|---|
| `contacts` | `/api/contacts` (existing — no new contact APIs) |
| `companies` | `/api/companies` |
| `deals` | `/api/sales/deals`, proposals |
| `quotes` | `/api/sales/quotes` |
| `activities` | `/api/activities` |
| `appointments` | `/api/appointments` (CCaaS webchat bookings) |
| `products` | `/api/products` |
| `invoices` | `/api/finance/invoices` |
| `commerce` | `/api/commerce/orders` |

A key missing a scope receives `403`.

## Contacts and leads (already available)

Do **not** invent parallel contact endpoints. Use what CRM already exposes:

- `POST /api/contacts` — create contact (needs `contacts` scope on the key)
- `GET /api/contacts`, `GET /api/contacts/:id`, `PATCH /api/contacts/:id`
- `POST /api/marketing/leads` — inbound lead upsert (marketing shared token; see Marketing MS setup)

## Examples (non-contact)

### Create a company

```bash
curl -sS -X POST "$API/api/companies" \
  -H "Authorization: Bearer $CRM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Corp","domain":"acme.com"}'
```

### Create a deal

```bash
curl -sS -X POST "$API/api/sales/deals" \
  -H "Authorization: Bearer $CRM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"Acme renewal","companyId":"<company-id>"}'
```

### Log an activity

```bash
curl -sS -X POST "$API/api/activities" \
  -H "Authorization: Bearer $CRM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contactId":"<contact-id>","type":"note","subject":"Chat summary","body":"…"}'
```

Exact bodies follow OpenAPI at `/docs` and existing CRM UI payloads.

## Appointments (CCaaS webchat)

**Shareable API reference:** [`docs/appointments-api.md`](appointments-api.md) — auth, endpoints, request/response shapes, and curl examples for booking only.

Summary: bookings use **`/api/appointments`**. Contact must already exist in CDP (`contactId` = `cdp_id`) with an email. One live future booking per contact. Auth: Bearer key with **`appointments`** scope, or `x-internal-secret` + `x-organization-id`.

## Not for customers

- `/api/internal/*`, `/api/cron/*`
- Coworker MCP (`/mcp/v1`) — agent infrastructure
- Managing API keys without an admin session

## Outbound webhooks

Platform events (`activity.logged`, `deal.stage_changed`, `appointment.scheduled`, …) are defined for the Worktual combine; partner webhook delivery is not part of this surface yet.
