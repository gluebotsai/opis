# WhatsApp template APIs (final)

**Audience:** My Account  
**Service:** CCaaS `social-service`  
**Prerequisite:** WhatsApp OAuth done — you have numeric `channelConfigId`.

Auth on **every** request:

```http
x-internal-service-key: <INTERNAL_SERVICE_KEY>
Content-Type: application/json
```

Missing key → **401** `{ "error": { "code": "unauthorized" } }`.

---

## Environments

| Env | Base URL | Notes |
|-----|----------|--------|
| **QA** | `https://rebuild-ccaas-api.worktual.com/social-api` | Public prefix `/social-api` |
| **ngrok (dev)** | `https://uninvited-skinless-eel.ngrok-free.dev` | Gateway → `:8080`; add `ngrok-skip-browser-warning: true` on free tier |

Paths after base are the same: `/internal/v1/whatsapp/templates...`

```bash
# QA
export BASE=https://rebuild-ccaas-api.worktual.com/social-api

# ngrok
export BASE=https://uninvited-skinless-eel.ngrok-free.dev
# -H "ngrok-skip-browser-warning: true"

export KEY=<INTERNAL_SERVICE_KEY>
export CHANNEL=1032   # org 1003 WhatsApp (numeric — not a UUID)
```

### Full URLs

| API | Method | QA | ngrok |
|-----|--------|----|-------|
| Submit for approval | `POST` | `https://rebuild-ccaas-api.worktual.com/social-api/internal/v1/whatsapp/templates/submit-approval` | `https://uninvited-skinless-eel.ngrok-free.dev/internal/v1/whatsapp/templates/submit-approval` |
| List templates | `GET` | `https://rebuild-ccaas-api.worktual.com/social-api/internal/v1/whatsapp/templates` | `https://uninvited-skinless-eel.ngrok-free.dev/internal/v1/whatsapp/templates` |
| Approval status | `GET` | `https://rebuild-ccaas-api.worktual.com/social-api/internal/v1/whatsapp/templates/approval-status` | `https://uninvited-skinless-eel.ngrok-free.dev/internal/v1/whatsapp/templates/approval-status` |
| Template detail | `GET` | `https://rebuild-ccaas-api.worktual.com/social-api/internal/v1/whatsapp/templates/detail` | `https://uninvited-skinless-eel.ngrok-free.dev/internal/v1/whatsapp/templates/detail` |
| Send template | `POST` | `https://rebuild-ccaas-api.worktual.com/social-api/internal/v1/whatsapp/templates` | `https://uninvited-skinless-eel.ngrok-free.dev/internal/v1/whatsapp/templates` |

---

## Enums

### Template category (submit)

| Value | Use |
|-------|-----|
| `UTILITY` | Reports, reminders (My Account) |
| `MARKETING` | Promotions |
| `AUTHENTICATION` | OTP |

### Meta / poll status

| Value | Can send? |
|-------|-----------|
| `PENDING` | No |
| `APPROVED` | Yes |
| `REJECTED` | No — resubmit with a **new** `name` |

### Submit component `type`

| Value | Notes |
|-------|--------|
| `BODY` | Required. `{{n}}` variables cannot be at start or end of text |
| `HEADER` | Optional |
| `FOOTER` | Optional |
| `BUTTONS` | Optional, 1–3 buttons |

### Header `format`

| Value |
|-------|
| `TEXT` (default) |
| `IMAGE` |
| `VIDEO` |
| `DOCUMENT` |

### Button `type` (submit)

| Value | Extra fields |
|-------|----------------|
| `QUICK_REPLY` | `text` (max 25) |
| `URL` | `text`, `url` |
| `PHONE_NUMBER` | `text`, `phone_number` |

### Send component `type` (lowercase)

| Value |
|-------|
| `header` |
| `body` |
| `button` |

### Send button `sub_type`

| Value |
|-------|
| `quick_reply` |
| `url` |

### Send parameter `type`

| Value | Shape |
|-------|--------|
| `text` | `{ "type": "text", "text": "..." }` |
| `currency` | `{ "type": "currency", "currency": { "fallback_value", "code", "amount_1000" } }` |
| `date_time` | `{ "type": "date_time", "date_time": { "fallback_value" } }` |
| `image` | `{ "type": "image", "image": { "link": "https://..." } }` |
| `document` | `{ "type": "document", "document": { "link": "https://..." } }` |
| `video` | `{ "type": "video", "video": { "link": "https://..." } }` |
| `payload` | `{ "type": "payload", "payload": "..." }` |

### Error `code`

| HTTP | `error.code` | When |
|------|--------------|------|
| 401 | `unauthorized` | Missing / wrong `x-internal-service-key` |
| 400 | `invalid_request` | Validation (e.g. non-numeric `channelConfigId`) |
| 404 | `template_not_found` | Detail: no match |
| 404 | `configuration_not_found` | No WhatsApp channel for id |
| 422 | `needs_reauth` | WhatsApp disconnected |
| 502 | `meta_provider_error` | Meta reject — read `error.message` / `providerCode` |
| 503 | `database_unavailable` | CCaaS DB timeout |

---

## 1. Submit for Meta approval

```http
POST {BASE}/internal/v1/whatsapp/templates/submit-approval
```

### Sample payload (UTILITY — My Account)

```json
{
  "channelConfigId": "1032",
  "name": "worktual_daily_report",
  "language": "en",
  "category": "UTILITY",
  "allowCategoryChange": false,
  "components": [
    {
      "type": "BODY",
      "text": "Your Worktual daily report for {{1}} is ready. Open: {{2}}"
    }
  ]
}
```

### Sample payload (BODY + buttons)

```json
{
  "channelConfigId": "1032",
  "name": "worktual_help",
  "language": "en",
  "category": "UTILITY",
  "components": [
    {
      "type": "BODY",
      "text": "Thanks for contacting Worktual. How can we help you today?"
    },
    {
      "type": "BUTTONS",
      "buttons": [
        { "type": "QUICK_REPLY", "text": "Sales" },
        { "type": "QUICK_REPLY", "text": "Support" },
        { "type": "URL", "text": "Open app", "url": "https://app.worktual.com" }
      ]
    }
  ]
}
```

| Field | Type | Required | Rules |
|-------|------|----------|--------|
| `channelConfigId` | string (digits) | Yes | e.g. `"1032"` |
| `name` | string | Yes | `^[a-z0-9_]+$`, unique per WABA + language |
| `language` | string | Yes | e.g. `en`, `en_US` |
| `category` | enum | Yes | `UTILITY` \| `MARKETING` \| `AUTHENTICATION` |
| `allowCategoryChange` | boolean | No | |
| `components` | array | Yes | At least one; include `BODY` |

### Sample 200

```json
{
  "submitted": true,
  "channelConfigId": "1032",
  "templateId": "1276647717872390",
  "templateName": "worktual_daily_report",
  "status": "PENDING",
  "category": "UTILITY"
}
```

`status` may already be `REJECTED` if Meta rejects immediately.

```bash
curl -sS -X POST "$BASE/internal/v1/whatsapp/templates/submit-approval" \
  -H "Content-Type: application/json" \
  -H "x-internal-service-key: $KEY" \
  -d '{
    "channelConfigId": "1032",
    "name": "worktual_daily_report",
    "language": "en",
    "category": "UTILITY",
    "components": [
      { "type": "BODY", "text": "Your Worktual daily report for {{1}} is ready. Open: {{2}}" }
    ]
  }'
```

Do **not** submit `hello_world` — that is Meta’s stock sample and is not available on this WABA.

---

## 2. List templates

```http
GET {BASE}/internal/v1/whatsapp/templates?channelConfigId=1032
GET {BASE}/internal/v1/whatsapp/templates?channelConfigId=1032&status=APPROVED
GET {BASE}/internal/v1/whatsapp/templates?channelConfigId=1032&return_template=true
```

| Query | Required | Notes |
|-------|----------|--------|
| `channelConfigId` | Yes | Numeric string |
| `templateName` | No | Filter |
| `language` | No | Filter |
| `status` | No | `PENDING` \| `APPROVED` \| `REJECTED` |
| `return_template` | No | `true` / `false` / `1` / `0` — include `components` |

### Sample 200

```json
{
  "channelConfigId": "1032",
  "count": 1,
  "templates": [
    {
      "id": "1746243980387808",
      "name": "worktual_org1003_test_1789821443",
      "language": "en",
      "status": "PENDING",
      "category": "UTILITY",
      "rejectedReason": "NONE"
    }
  ]
}
```

```bash
curl -sS -H "x-internal-service-key: $KEY" \
  "$BASE/internal/v1/whatsapp/templates?channelConfigId=$CHANNEL&status=APPROVED"
```

---

## 3. Approval status (poll)

```http
GET {BASE}/internal/v1/whatsapp/templates/approval-status?channelConfigId=1032&templateName=worktual_daily_report&language=en
```

Provide `templateName` **or** `templateId`. Prefer `language`.

| Query | Required |
|-------|----------|
| `channelConfigId` | Yes |
| `templateName` | One of name / id |
| `templateId` | One of name / id |
| `language` | No |
| `status` | No |

### Sample 200

```json
{
  "channelConfigId": "1032",
  "templates": [
    {
      "id": "1746243980387808",
      "name": "worktual_daily_report",
      "language": "en",
      "status": "APPROVED",
      "category": "UTILITY",
      "rejectedReason": null
    }
  ]
}
```

My Account stores this status (scheduler). CCaaS does not persist it.

```bash
curl -sS -H "x-internal-service-key: $KEY" \
  "$BASE/internal/v1/whatsapp/templates/approval-status?channelConfigId=$CHANNEL&templateName=worktual_daily_report&language=en"
```

---

## 4. Template detail

```http
GET {BASE}/internal/v1/whatsapp/templates/detail?channelConfigId=1032&templateName=worktual_daily_report&language=en
```

`return_template` defaults to **true** (full `components`). Pass `false` for status only.

```bash
curl -sS -H "x-internal-service-key: $KEY" \
  "$BASE/internal/v1/whatsapp/templates/detail?channelConfigId=$CHANNEL&templateName=worktual_daily_report&language=en"
```

---

## 5. Send (APPROVED only)

```http
POST {BASE}/internal/v1/whatsapp/templates
```

### Sample payload (two body variables)

```json
{
  "channelConfigId": "1032",
  "to": "919150911820",
  "templateName": "worktual_daily_report",
  "languageCode": "en",
  "components": [
    {
      "type": "body",
      "parameters": [
        { "type": "text", "text": "19 Sep 2026" },
        { "type": "text", "text": "https://app.worktual.com/reports/abc" }
      ]
    }
  ]
}
```

| Field | Required | Rules |
|-------|----------|--------|
| `channelConfigId` | Yes | Same numeric id |
| `to` | Yes | Country code + digits, **no** `+` |
| `templateName` | Yes | Must be `APPROVED` |
| `languageCode` | Yes | Must match submit language (`en` ≠ `en_US`) |
| `components` | If template has `{{n}}` | Send types are **lowercase** |

### Sample 200

```json
{
  "sent": true,
  "providerMessageId": "wamid....",
  "channelConfigId": "1032"
}
```

```bash
curl -sS -X POST "$BASE/internal/v1/whatsapp/templates" \
  -H "Content-Type: application/json" \
  -H "x-internal-service-key: $KEY" \
  -d '{
    "channelConfigId": "1032",
    "to": "919150911820",
    "templateName": "worktual_daily_report",
    "languageCode": "en",
    "components": [
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "19 Sep 2026" },
          { "type": "text", "text": "https://app.worktual.com/reports/abc" }
        ]
      }
    ]
  }'
```

---

## Flow

```text
1. POST submit-approval     → PENDING
2. GET  approval-status     → poll until APPROVED | REJECTED
3. POST templates           → send (APPROVED only)
```

Related: [WHATSAPP_UTILITY_TEMPLATE_FLOW.md](./WHATSAPP_UTILITY_TEMPLATE_FLOW.md) · [WHATSAPP_TEMPLATE_PRESETS.md](./WHATSAPP_TEMPLATE_PRESETS.md)
