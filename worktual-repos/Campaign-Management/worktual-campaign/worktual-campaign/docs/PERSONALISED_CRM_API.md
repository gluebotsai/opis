# Personalised CRM API (CRM → Campaign)

Campaign API for CRM to request a send for **named people**, on **named channels**, at a **named time**.

This is **not** Hub on-demand. Do **not** call `POST /api/campaigns/on-demand` or `POST /api/campaigns/on-demand/accept`.

Runs are stored separately. They do **not** appear in Campaign Live / Scheduled / Past. Operators see them under Campaign monitoring → **Personalised CRM** (`/campaigns?tab=personalised-crm`).

Auth:

- **CRM UI / logged-in user:** Bearer CRM access JWT — [CRM_CAMPAIGN_HANDOFF.md](CRM_CAMPAIGN_HANDOFF.md).
- **CRM monitor/agent (backend, org-scoped):** `X-Crm-Integration-Key` + `organization_id` — see **Backend automation** below.

## Hosts (live)

| Who | Call this | Do not call |
|-----|-----------|-------------|
| **CRM** | Campaign REST: `https://rebuild-campaign-api.worktual.com` | A2A, Hub, agents `:8005` |
| **CRM LAN** | `http://192.168.13.91:3001` | — |
| **Campaign operators** | UI: `https://rebuild-campaign.worktual.com/campaigns?tab=personalised-crm` | — |

**A2A** runs on the Campaign server (`campaign@worktual.tech`). Campaign API talks to it **inside Docker** (`AGENTS_PREPARE_URL=http://a2a:8040`) to generate templates (`POST /personalised-crm/prepare`). CRM never sends traffic to A2A.

After this feature is deployed, that host must recreate **`backend` + `a2a`** so `/personalised-crm/prepare` exists. Until then, POST returns 502 from prepare.

---

## Backend automation (CRM monitor/agent)

Use this when **no human is logged in**. Tenant is **`organization_id` in the body**, not a JWT `sub`.

```
POST /api/campaigns/personalised-crm/automation
X-Crm-Integration-Key: <CRM_INTEGRATION_KEY>
Content-Type: application/json
```

You may instead send `Authorization: Bearer <CRM_INTEGRATION_KEY>` (the **integration key**, not `CRM_JWT_ACCESS_SECRET` and not a user JWT).

### Keys CRM must use

| Env var (Campaign backend) | Value | How CRM uses it |
|----------------------------|-------|-----------------|
| **`CRM_INTEGRATION_KEY`** | `crm-int-9Kp4Wm2Rx7Nv8sL3tYc5HdaB6uQ1eZ` | Header **`X-Crm-Integration-Key`** (or Bearer of this same string) |
| **`CRM_JWT_ACCESS_SECRET`** | `7noyifG2Pj61_cPAv04F88xDSq3jlOXF6kROV0c-AwgfFan6W9r44o4WZUQ7J_OJ` | **Do not send.** CRM server signing secret for **user JWTs** / embed only. Same as CRM `JWT_ACCESS_SECRET`. |
| **`INTERNAL_SERVICE_KEY`** | (Campaign/CCaaS internal) | **Do not send** on this route. |

### Required body fields

| Field | Meaning |
|--------|---------|
| `organization_id` | Accounts org to send as (e.g. `"1003"`). Must exist; org must have Campaign product. |
| `acting_user_id` | **Optional.** Active `setup_users.id` in that org. Omit or `null` → Campaign uses the first active user in the org for `created_by`. |
| `channels` | Same as user JWT path |
| Audience | `people` / `contact_ids` / `emails` / `phones` — same as user JWT path |

```json
{
  "organization_id": "1003",
  "name": "Monitor trigger",
  "brief": "Follow up after the pricing call.",
  "channels": ["email"],
  "people": [{ "email": "priya@acme.com" }],
  "timezone": "Asia/Kolkata"
}
```

```bash
curl -sS -X POST 'http://192.168.13.91:3001/api/campaigns/personalised-crm/automation' \
  -H 'X-Crm-Integration-Key: crm-int-9Kp4Wm2Rx7Nv8sL3tYc5HdaB6uQ1eZ' \
  -H 'Content-Type: application/json' \
  -d '{
    "organization_id": "1003",
    "name": "Monitor trigger",
    "brief": "Follow up after the pricing call.",
    "channels": ["email"],
    "people": [{ "email": "priya@acme.com" }]
  }'
```

HTTP **202** is the same as the JWT create path (`run_id`, `status`, `send_at`, …).

| Status | Meaning |
|--------|---------|
| **401** | Missing/wrong `X-Crm-Integration-Key` (or `CRM_INTEGRATION_KEY` unset on Campaign) |
| **400** | Unknown `organization_id`, `acting_user_id` not in that org, or missing audience/channels |
| **403** | Org has no Campaign product / no branch; or acting user inactive |
| **202** | Accepted |

**v1:** this route **creates** only. List/GET still use CRM user JWT (or Campaign SPA).

Restart Campaign API after setting `CRM_INTEGRATION_KEY`.

**Copy-paste email for CRM team (keys + curl):** [CRM_PERSONALISED_AUTOMATION_EMAIL.md](CRM_PERSONALISED_AUTOMATION_EMAIL.md)

---

## Create a send (logged-in CRM user JWT)

```
POST /api/campaigns/personalised-crm
Authorization: Bearer <CRM access JWT>
Content-Type: application/json
```

Org and branch come from the JWT user. **Do not** send `organization_id` or `tenantId` on this JWT route (use **/automation** if you need org id in the body).

HTTP **202** means Campaign accepted the request and queued send workers. Sending finishes asynchronously.

### Recommended payload

Use `people` + `channels` + `brief`. This is the shape CRM should send.

```json
{
  "name": "Post-demo follow-up",
  "brief": "Priya joined the product demo. Recap next steps and offer a short walkthrough. Keep it personal, not a blast.",
  "channels": ["email"],
  "people": [
    {
      "email": "priya@acme.com"
    }
  ],
  "send_at": "2026-09-30T10:00:00+05:30",
  "timezone": "Asia/Kolkata"
}
```

Send now (omit `send_at`):

```json
{
  "name": "Post-demo follow-up",
  "brief": "Priya joined the product demo. Recap next steps.",
  "channels": ["email", "whatsapp"],
  "people": [
    {
      "email": "priya@acme.com",
      "phone": "+919876543210"
    }
  ]
}
```

People already in this org’s CDP (prefer this when CRM has Campaign/CDP ids):

```json
{
  "name": "Deal follow-up",
  "brief": "Follow up after the pricing call. Confirm the quote is still valid.",
  "channels": ["email"],
  "contact_ids": ["182938475610"],
  "send_at": "2026-09-30 10:00",
  "timezone": "Asia/Kolkata"
}
```

### Required

| Field | Type | Rules |
|-------|------|--------|
| `channels` | string[] | **Required.** Min 1, max 8. Only: `email`, `whatsapp`, `push`, `web`. Campaign sends **every** channel listed (not “email only”). |
| Audience | — | **Required.** At least one of: `people[]`, `emails[]`, `phones[]`, `contact_ids[]`, `customer_ids[]`. |

`customer_ids` is an alias of `contact_ids`.

### Optional copy (Campaign generates templates)

If CRM does not pass template ids (not supported yet), Campaign generates recipient-facing copy from these fields.

| Field | Max | Notes |
|-------|-----|--------|
| `name` | 200 | Campaign title in monitoring. Default: `Personalised CRM — <first contact>`. |
| `brief` | 8000 | **Use this.** Operator/CRM intent. Never sent as the recipient body. |
| `goal` | 400 | Optional extra for generation. |
| `objective` | 800 | Optional extra for generation. |

### Optional audience

| Field | Max | Notes |
|-------|-----|--------|
| `people` | 200 | Preferred. Each item may include `email`, `phone`, `contact_id`, `customer_id`, or `id`. At least one identity per used item. |
| `emails` | 200 | Valid emails. |
| `phones` | 200 | Min 5 characters. |
| `contact_ids` | 200 | CDP / Campaign contact id: digits, UUID, or `CDP-…`. Must resolve **in this org**. |
| `customer_ids` | 200 | Same as `contact_ids`. |

Unknown CRM-only ids that are not in this org’s CDP → **400**. Pass email (and phone if WhatsApp) as well when the id may not exist in Campaign yet.

### Optional schedule

| Field | Default | Rules |
|-------|---------|--------|
| `timezone` | `Asia/Kolkata` | IANA name, e.g. `Asia/Kolkata`, `Europe/London`. |
| `send_at` | send now | ISO-8601 (`2026-09-30T10:00:00+05:30`) **or** `YYYY-MM-DD HH:mm` in `timezone`. |

`send_at` behaviour:

- omitted / null / `""` → send now (`status: live`)
- future → scheduled (`status: scheduled`); workers wait until that instant
- past by **≤ 2 minutes** → send now
- past by **> 2 minutes** → **400**
- unparseable → **400**

### 202 body

```json
{
  "statusCode": 202,
  "message": "Personalised CRM request received",
  "run_id": "1234567890",
  "status": "scheduled",
  "send_at": "2026-09-30T04:30:00.000Z",
  "timezone": "Asia/Kolkata",
  "channels": ["email"],
  "audience_count": 1,
  "warnings": []
}
```

| Field | Meaning |
|-------|---------|
| `run_id` | Campaign id. Use this on GET. |
| `status` | `live` (send now) or `scheduled`. |
| `send_at` | UTC ISO Campaign will use. |
| `warnings` | Non-fatal planner notes. Empty on a clean accept. |

---

## Poll status

Same auth header.

```
GET /api/campaigns/personalised-crm
GET /api/campaigns/personalised-crm/:run_id
GET /api/campaigns/personalised-crm/:run_id/recipients
```

Recipients query (optional): `?channel=email&limit=200` (`limit` max 500).

### GET one run (`run`)

Campaign status plus totals. `origin` is always `crm`.

Useful fields: `id`, `title`, `status`, `channels`, `audienceCount`, `sent`, `failed`, `pending`, `sendAt`, `timezone`, `brief`, `warnings`.

`status` values match Campaign: `live`, `scheduled`, `completed`, `cancelled`.

### GET recipients (grid)

One row per **contact × channel**.

| Field | Meaning |
|-------|---------|
| `recipients[].name` / `email` / `phone` / `contact_id` | Who |
| `recipients[].channels[].channel` | `email` / `whatsapp` / `push` / `web` |
| `recipients[].channels[].scheduled_for` | Planned send time (ISO) |
| `recipients[].channels[].sent_at` | When the worker recorded a send (ISO), else null |
| `recipients[].channels[].outcome` | `pending` · `sent` · `failed` · `skipped` · `stub` · `not_sent` |

`stub` means a local stub id was recorded — the contact did **not** get a live provider send.

---

## Sample curl (live)

```bash
API=https://rebuild-campaign-api.worktual.com

# Create (202)
curl -sS -X POST "$API/api/campaigns/personalised-crm" \
  -H 'Authorization: Bearer <CRM_ACCESS_JWT>' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Post-demo follow-up",
    "brief": "Priya joined the product demo. Recap next steps.",
    "channels": ["email"],
    "people": [{ "email": "priya@acme.com" }],
    "send_at": "2026-09-30T10:00:00+05:30",
    "timezone": "Asia/Kolkata"
  }'

# List
curl -sS "$API/api/campaigns/personalised-crm" \
  -H 'Authorization: Bearer <CRM_ACCESS_JWT>'

# One run
curl -sS "$API/api/campaigns/personalised-crm/<run_id>" \
  -H 'Authorization: Bearer <CRM_ACCESS_JWT>'

# Contact × channel grid
curl -sS "$API/api/campaigns/personalised-crm/<run_id>/recipients" \
  -H 'Authorization: Bearer <CRM_ACCESS_JWT>'
```

Local API (if you run Fastify on this machine): `http://127.0.0.1:3001`. Do not point CRM at A2A.

---

## Fail-closed (400 / 502)

Campaign will not pretend a send happened.

| Situation | Result |
|-----------|--------|
| Missing `channels` | 400 |
| No people / emails / phones / ids | 400 |
| Contact not in this org’s CDP | 400 |
| `email` in `channels` but contact has no email on file | 400 |
| `email` in `channels` but My Accounts mailbox is not send-ready | 400 |
| `whatsapp` in `channels` but WhatsApp is not configured for the org | 400 |
| `send_at` too far in the past or invalid | 400 |
| Template generation failed | 502 |

Push / web still require the contact to have a device / browser subscription at send time; missing endpoints fail on that recipient, not the whole POST, unless no channel can be planned.

---

## What CRM must not send

On **JWT** `POST /api/campaigns/personalised-crm`:

- `request_text` (Hub on-demand only)
- `organization_id` / `tenantId` (taken from the JWT) — use **/automation** for org-id tenant
- Hub `orchestration_mode` / `broadcast_confirmed` (CRM `channels` list is the send set)
- Library `template_ids` (not accepted yet; Campaign generates from `brief` / `name`)
- `CRM_JWT_ACCESS_SECRET` as Bearer (signing secret, not a token)

On **automation** `POST /api/campaigns/personalised-crm/automation`:

- User CRM access JWTs are not required
- Do not send `CRM_JWT_ACCESS_SECRET` as the integration key
- Do send `organization_id` + audience; `acting_user_id` is optional

---

## Operator UI

Campaign monitoring → tab **Personalised CRM**.

Live: `https://rebuild-campaign.worktual.com/campaigns?tab=personalised-crm`

Deep link after create: `/campaigns?tab=personalised-crm&id=<run_id>`
