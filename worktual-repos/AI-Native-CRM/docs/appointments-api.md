# Appointments API

CRM booking API for CCaaS webchat and other machine integrations.

**Base path:** `/api/appointments`  
**Host:** your CRM API URL (same host as other `/api/*` routes)

---

## Auth

Use **one** of the two modes below — not both.

### Internal server (CCaaS / spoke → CRM)

For service-to-service calls from CCaaS (or another internal Worktual spoke). **No Bearer API key.**

**Required headers on every request:**

| Header | Required | Value |
|--------|----------|--------|
| `x-internal-secret` | **yes** | Shared secret — must match CRM env `ENRICH_INTERNAL_SECRET` (fallback: `CRON_SECRET`) |
| `x-organization-id` | **yes** | Tenant org id, e.g. `1000` (`accounts.organizations.id`) |
| `Content-Type` | yes for `POST` / `PATCH` | `application/json` |

**No other auth headers.** Do not send `Authorization` for internal mode.

```http
x-internal-secret: <shared-secret-from-CRM-ops>
x-organization-id: 1000
Content-Type: application/json
```

**CRM side:** set `ENRICH_INTERNAL_SECRET` on the CRM API process (same value you give CCaaS).  
**CCaaS side:** store that secret in its env/config and send it on every appointments call.

**Errors**

| Status | Cause |
|--------|--------|
| `401` | Missing or wrong `x-internal-secret` |
| `400` | Valid secret but missing/empty `x-organization-id` |

Tenant scope comes **only** from `x-organization-id` — the secret does not encode the tenant.

---

### Bearer API key (tenant integrator)

```http
Authorization: Bearer crm_live_….…
Content-Type: application/json
```

API key must include scope **`appointments`** (create in CRM **Configuration → Developers**). Org is inferred from the key — **do not** send `x-organization-id`.

---

### Quick comparison

| | Internal server | API key |
|---|-----------------|---------|
| `x-internal-secret` | **Required** | Omit |
| `x-organization-id` | **Required** | Omit |
| `Authorization: Bearer …` | Omit | **Required** |
| Tenant | From header | From key |

---

## Response envelope

Success:

```json
{ "statusCode": 200, "message": "…", …payload }
```

Create returns `statusCode: 201` with appointment fields at the top level.

Errors:

```json
{ "statusCode": 400, "message": "…", "code": "optional_error_code" }
```

---

## Rules

| Rule | Detail |
|------|--------|
| `contactId` | CDP person id (`cdp_id`). Contact must **already exist** and have an **email**. |
| One live booking | At most one future `scheduled` appointment per contact per tenant. |
| Availability v1 | Single datetime check only (not a full-day slot list). |
| Assignment | CRM picks a sales rep (territory rules + Google Calendar free/busy) and sends a Google Meet invite. |
| Default duration | 30 minutes if `durationMinutes` is omitted. |

---

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/availability` | Check if a slot can be booked |
| `POST` | `/` | Create booking |
| `GET` | `/by-contact/:contactId` | Get live booking for a contact |
| `PATCH` | `/:id` | Reschedule |
| `POST` | `/:id/cancel` | Cancel live booking |

---

## 1. Check availability

```http
GET /api/appointments/availability?contactId={cdp_id}&startsAt={ISO8601}&timezone={IANA}&durationMinutes=30
```

| Query | Required | Description |
|-------|----------|-------------|
| `contactId` | yes | CDP person id |
| `startsAt` | yes | ISO-8601 instant, e.g. `2026-08-25T15:00:00.000Z` |
| `timezone` | yes | IANA timezone, e.g. `America/New_York` |
| `durationMinutes` | no | Default `30` |

**200 — available**

```json
{
  "statusCode": 200,
  "message": "Success",
  "available": true,
  "hostUserId": "1006"
}
```

**200 — not available**

```json
{
  "statusCode": 200,
  "message": "Success",
  "available": false,
  "reason": "no_slots_available",
  "availableSlots": [
    {
      "startsAt": "2026-08-25T11:00:00.000Z",
      "hostUserId": "1006"
    },
    {
      "startsAt": "2026-08-25T14:30:00.000Z",
      "hostUserId": "1006"
    }
  ]
}
```

When the requested instant is busy, CRM scans the **same local calendar day** (business hours in `timezone`) and returns up to **8** alternative slots. Each entry includes the assigned rep (`hostUserId`). Omitted when no alternatives exist (e.g. `contact_not_found`).

`reason` values: `no_slots_available`, `no_candidates`, `contact_not_found`.

---

## 2. Create appointment

```http
POST /api/appointments
Content-Type: application/json
```

**Body**

| Field | Required | Description |
|-------|----------|-------------|
| `contactId` | yes | CDP person id |
| `title` | yes | Meeting title shown to the guest |
| `startsAt` | yes | ISO-8601 instant |
| `timezone` | yes | IANA timezone |
| `durationMinutes` | no | Default `30` |
| `guestEmails` | no | Extra invite emails (contact email is always included) |

**Example**

```json
{
  "contactId": "9",
  "title": "Product consultation",
  "startsAt": "2026-08-25T15:00:00.000Z",
  "timezone": "America/New_York",
  "durationMinutes": 30
}
```

**201**

```json
{
  "statusCode": 201,
  "message": "Appointment created.",
  "appointment": { },
  "activityId": "cmt7…"
}
```

**409**

| `code` | Meaning |
|--------|---------|
| `appointment_exists` | Contact already has a live future booking |
| `no_slots_available` | No rep free at that time |

**404** — contact not found  
**400** — validation (past time, missing contact email, etc.)

---

## 3. Get live appointment for contact

```http
GET /api/appointments/by-contact/{contactId}
```

**200**

```json
{
  "statusCode": 200,
  "message": "Success",
  "appointment": { }
}
```

**404** — no live future booking

---

## 4. Reschedule

```http
PATCH /api/appointments/{appointmentId}
Content-Type: application/json
```

**Body**

| Field | Required | Description |
|-------|----------|-------------|
| `startsAt` | yes | New ISO-8601 instant |
| `timezone` | yes | IANA timezone |
| `title` | no | Updated title |
| `durationMinutes` | no | Slot length (defaults to existing) |

**Example**

```json
{
  "startsAt": "2026-08-26T15:00:00.000Z",
  "timezone": "America/New_York"
}
```

**200**

```json
{
  "statusCode": 200,
  "message": "Success",
  "appointment": { },
  "activityId": "cmt7…"
}
```

**404** — no live appointment with that id

---

## 5. Cancel

```http
POST /api/appointments/{appointmentId}/cancel
```

**200**

```json
{
  "statusCode": 200,
  "message": "Success",
  "appointment": { }
}
```

**404** — no live appointment with that id

---

## Appointment object

Returned on create, get, reschedule, and cancel.

```json
{
  "id": "cmt7eqq9m00001a1grg865vdw",
  "organizationId": "1000",
  "contactId": "9",
  "hostUserId": "1006",
  "activityId": "cmt7eqr3500011a1gff36qucm",
  "source": "ccaas_webchat",
  "status": "scheduled",
  "title": "Product consultation",
  "startsAt": "2026-08-25T15:00:00.000Z",
  "endsAt": "2026-08-25T15:30:00.000Z",
  "timezone": "America/New_York",
  "provider": "google_meet",
  "joinUrl": "https://meet.google.com/abc-defg-hij",
  "calendarEventId": "…",
  "guestEmails": ["guest@example.com"],
  "assignmentReason": "matched to the us sales territory (open deals=1; maturity=ramping)",
  "canceledAt": null,
  "completedAt": null,
  "createdAt": "2026-08-24T15:00:00.000Z",
  "updatedAt": "2026-08-24T15:00:00.000Z"
}
```

| Field | Notes |
|-------|-------|
| `status` | `scheduled`, `canceled`, `completed`, `no_show` |
| `source` | `ccaas_webchat` for this API |
| `joinUrl` | Google Meet link — show in chat |
| `hostUserId` | Assigned CRM rep |

---

## Example flow (curl)

```bash
API="https://your-crm-api-host"
KEY="crm_live_…"

# 1. Check slot
curl -sS "$API/api/appointments/availability\
?contactId=9&startsAt=2026-08-25T15:00:00.000Z&timezone=America/New_York" \
  -H "Authorization: Bearer $KEY"

# 2. Book
curl -sS -X POST "$API/api/appointments" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"contactId":"9","title":"Product consultation","startsAt":"2026-08-25T15:00:00.000Z","timezone":"America/New_York"}'

# 3. Show existing booking in chat
curl -sS "$API/api/appointments/by-contact/9" \
  -H "Authorization: Bearer $KEY"

# 4. Reschedule
curl -sS -X PATCH "$API/api/appointments/<appointment-id>" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"startsAt":"2026-08-26T15:00:00.000Z","timezone":"America/New_York"}'

# 5. Cancel
curl -sS -X POST "$API/api/appointments/<appointment-id>/cancel" \
  -H "Authorization: Bearer $KEY"
```

Internal auth example (CCaaS — **only these headers**):

```bash
curl -sS -X POST "$API/api/appointments" \
  -H "x-internal-secret: $ENRICH_INTERNAL_SECRET" \
  -H "x-organization-id: 1000" \
  -H "Content-Type: application/json" \
  -d '{"contactId":"9","title":"Product consultation","startsAt":"2026-08-25T15:00:00.000Z","timezone":"America/New_York"}'
```

API key example:

---

## OpenAPI

Interactive docs: `GET /docs` on the CRM API host (search for `appointments`).
