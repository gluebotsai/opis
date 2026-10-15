# Appointments API — booking scenarios

CRM appointment booking on **`82.113.92.49`**.

| Item | Value |
|------|--------|
| **Server IP** | `82.113.92.49` |
| **API base** | `http://82.113.92.49:4000` |
| **OpenAPI** | `http://82.113.92.49:4000/docs` |
| **Web UI** | `http://82.113.92.49:5173/login` |

> CCaaS and integrations call the API on port **4000**. The browser UI runs on port **5173** (same as local Vite dev).

---

## Auth & test data

### Internal auth (CCaaS → CRM)

```http
x-internal-secret: 2b179c0d739539750168566ca295a7df
x-organization-id: 1000
Content-Type: application/json
```

| Field | Value |
|-------|--------|
| Internal secret | `2b179c0d739539750168566ca295a7df` |
| Org id | `1000` |
| Test contact (`cdp_id`) | `9` |
| Typical rep | `1006` |

No `Authorization` header for internal mode.

---

## Endpoints

| Method | URL |
|--------|-----|
| `GET` | `http://82.113.92.49:4000/api/appointments/availability` |
| `POST` | `http://82.113.92.49:4000/api/appointments` |
| `GET` | `http://82.113.92.49:4000/api/appointments/by-contact/{contactId}` |
| `PATCH` | `http://82.113.92.49:4000/api/appointments/{id}` |
| `POST` | `http://82.113.92.49:4000/api/appointments/{id}/cancel` |

---

## Scenario 1 — Check availability

```bash
curl -sS "http://82.113.92.49:4000/api/appointments/availability?contactId=9&startsAt=2026-09-01T16:00:00.000Z&timezone=Asia/Kolkata&durationMinutes=30" \
  -H "x-internal-secret: 2b179c0d739539750168566ca295a7df" \
  -H "x-organization-id: 1000"
```

**200 — available**

```json
{
  "statusCode": 200,
  "message": "Success",
  "available": true,
  "hostUserId": "1006"
}
```

---

## Scenario 2 — Create booking

```bash
curl -sS -X POST "http://82.113.92.49:4000/api/appointments" \
  -H "x-internal-secret: 2b179c0d739539750168566ca295a7df" \
  -H "x-organization-id: 1000" \
  -H "Content-Type: application/json" \
  -d '{
    "contactId": "9",
    "title": "Product consultation — webchat",
    "startsAt": "2026-09-01T16:00:00.000Z",
    "timezone": "Asia/Kolkata",
    "durationMinutes": 30
  }'
```

**201**

```json
{
  "statusCode": 201,
  "message": "Appointment created.",
  "appointment": {
    "id": "cmt7…",
    "organizationId": "1000",
    "contactId": "9",
    "hostUserId": "1006",
    "source": "ccaas_webchat",
    "status": "scheduled",
    "joinUrl": "https://meet.google.com/abc-defg-hij"
  },
  "activityId": "cmt7…"
}
```

---

## Scenario 3 — Get live booking for contact

```bash
curl -sS "http://82.113.92.49:4000/api/appointments/by-contact/9" \
  -H "x-internal-secret: 2b179c0d739539750168566ca295a7df" \
  -H "x-organization-id: 1000"
```

**200** — returns live `scheduled` appointment.  
**404** — no live booking.

---

## Scenario 4 — Reschedule

Replace `{appointmentId}` with id from Scenario 2.

```bash
curl -sS -X PATCH "http://82.113.92.49:4000/api/appointments/{appointmentId}" \
  -H "x-internal-secret: 2b179c0d739539750168566ca295a7df" \
  -H "x-organization-id: 1000" \
  -H "Content-Type: application/json" \
  -d '{
    "startsAt": "2026-09-02T16:00:00.000Z",
    "timezone": "Asia/Kolkata",
    "title": "Rescheduled — product consultation"
  }'
```

**200** — updated `startsAt`, `endsAt`, `activityId`.

---

## Scenario 5 — Cancel

```bash
curl -sS -X POST "http://82.113.92.49:4000/api/appointments/{appointmentId}/cancel" \
  -H "x-internal-secret: 2b179c0d739539750168566ca295a7df" \
  -H "x-organization-id: 1000"
```

**200**

```json
{
  "statusCode": 200,
  "appointment": { "status": "canceled" }
}
```

---

## Scenario 6 — Duplicate booking (409)

Book again without canceling → **`409`**

```json
{ "statusCode": 409, "code": "appointment_exists" }
```

One live `scheduled` appointment per contact per org.

---

## Scenario 7 — Slot unavailable (409)

```bash
curl -sS "http://82.113.92.49:4000/api/appointments/availability?contactId=9&startsAt=2026-08-25T03:00:00.000Z&timezone=Asia/Kolkata" \
  -H "x-internal-secret: 2b179c0d739539750168566ca295a7df" \
  -H "x-organization-id: 1000"
```

**200** — `"available": false, "reason": "no_slots_available"`

Create at that time → **409** `"code": "no_slots_available"`

---

## Scenario 8 — Auth errors

**Wrong secret → 401**

```bash
curl -sS "http://82.113.92.49:4000/api/appointments/by-contact/9" \
  -H "x-internal-secret: wrong-secret" \
  -H "x-organization-id: 1000"
```

**Missing org → 400**

```bash
curl -sS "http://82.113.92.49:4000/api/appointments/by-contact/9" \
  -H "x-internal-secret: 2b179c0d739539750168566ca295a7df"
```

---

## Scenario 9 — API key auth (optional)

```bash
curl -sS "http://82.113.92.49:4000/api/appointments/by-contact/9" \
  -H "Authorization: Bearer crm_live_<your-key>" \
  -H "Content-Type: application/json"
```

Key must have **`appointments`** scope. Omit `x-organization-id`.

---

## CCaaS flow

1. `GET /availability` — pick slot  
2. `POST /appointments` — book, show `joinUrl` in chat  
3. `GET /by-contact/:id` — show existing booking on return visit  
4. `PATCH /:id` — reschedule  
5. `POST /:id/cancel` — cancel  

---

## Rules

| Rule | Detail |
|------|--------|
| Contact | Must exist in CDP with email |
| One booking | One live `scheduled` row per contact per org |
| Duration | Default 30 min |
| Calendar | Rep needs Google Calendar connected for Meet link |
