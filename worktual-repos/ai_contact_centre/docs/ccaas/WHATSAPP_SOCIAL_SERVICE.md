# WhatsApp social-service (CCaaS)

`social-service` (`apps/social-service`, port **3004**) is the Meta WhatsApp Cloud API adapter for the contact center platform.

Customer OAuth tokens are stored in `accounts.setup_social_configs`. The service decrypts them in memory with `MS_TOKEN_ENCRYPTION_KEY` (AES-256-GCM) and never writes tokens back to the database.

Contact-center conversation ingestion and agent delivery are out of scope for this service.

## Authentication

All internal routes require:

```http
x-internal-service-key: <INTERNAL_SERVICE_KEY>
```

## Configuration

See `apps/social-service/.env.example`.

| Variable | Purpose |
|----------|---------|
| `MS_TOKEN_ENCRYPTION_KEY` | 64-char hex key for decrypting tenant tokens |
| `META_WHATSAPP_VERIFY_TOKEN` | Meta webhook verification token |
| `META_WHATSAPP_APP_SECRET` | Validates `x-hub-signature-256` |
| `META_WHATSAPP_APP_ID` | Meta app ID for token exchange |
| `META_GRAPH_API_VERSION` | Graph API version (default `v26.0`) |
| `META_WHATSAPP_AUTO_REPLY` | Send test auto-reply on inbound webhook (default on) |
| `META_WHATSAPP_AUTO_REPLY_BUTTONS` | Send 2-button interactive test message after auto-reply (default on) |

Tenant `phone_number_id`, `waba_id`, and access tokens come from `accounts.setup_social_configs` — not from environment variables.

## Webhook

```text
GET/POST https://<host>/webhooks/whatsapp
```

Meta verifies with `hub.mode=subscribe`, `hub.verify_token`, and `hub.challenge`.

On inbound messages the service:

1. Verifies signature
2. Resolves tenant by `metadata.phone_number_id`
3. Logs normalized inbound payload
4. Optionally sends text auto-reply
5. Optionally sends interactive 2-button test message
6. Optionally sends an approved template (when `META_WHATSAPP_AUTO_REPLY_TEMPLATE_NAME` is set)

Webhook response:

```json
{
  "accepted": true,
  "inboundMessages": 1,
  "statusUpdates": 0,
  "unresolvedChanges": 0,
  "repliesSent": 1,
  "templateRepliesSent": 0,
  "buttonRepliesSent": 1
}
```

## Internal APIs

### Send text

```http
POST /internal/v1/whatsapp/messages
Content-Type: application/json
x-internal-service-key: <key>
```

```json
{
  "channelConfigId": "11111111-1111-4111-8111-111111111111",
  "to": "919876543210",
  "body": "Hello from Worktual",
  "previewUrl": false
}
```

### Send approved template message

Template must already be **APPROVED** in the customer's Meta WABA.

```http
POST /internal/v1/whatsapp/templates
Content-Type: application/json
x-internal-service-key: <key>
```

```json
{
  "channelConfigId": "11111111-1111-4111-8111-111111111111",
  "to": "919876543210",
  "templateName": "order_update",
  "languageCode": "en_US",
  "components": [
    {
      "type": "body",
      "parameters": [{ "type": "text", "text": "ORD-1234" }]
    }
  ]
}
```

### Submit template for Meta approval

Creates a new message template in the tenant's WABA and submits it to Meta for review.

Requires `waba_id` on the channel config.

```http
POST /internal/v1/whatsapp/templates/submit-approval
Content-Type: application/json
x-internal-service-key: <key>
```

```json
{
  "channelConfigId": "11111111-1111-4111-8111-111111111111",
  "name": "worktual_test_buttons",
  "language": "en",
  "category": "UTILITY",
  "allowCategoryChange": false,
  "components": [
    {
      "type": "BODY",
      "text": "Thanks for contacting Worktual. How can we help?"
    },
    {
      "type": "BUTTONS",
      "buttons": [
        { "type": "QUICK_REPLY", "text": "Sales" },
        { "type": "QUICK_REPLY", "text": "Support" }
      ]
    }
  ]
}
```

Response:

```json
{
  "submitted": true,
  "channelConfigId": "11111111-1111-4111-8111-111111111111",
  "templateId": "123456789012345",
  "templateName": "worktual_test_buttons",
  "status": "PENDING",
  "category": "UTILITY"
}
```

`category` values: `MARKETING`, `UTILITY`, `AUTHENTICATION`.

Component `type` values for submission use Meta's uppercase names: `BODY`, `HEADER`, `FOOTER`, `BUTTONS`.

Button types: `QUICK_REPLY`, `URL`, `PHONE_NUMBER`.

### Fetch template approval status

```http
GET /internal/v1/whatsapp/templates/approval-status?channelConfigId=<uuid>&templateName=worktual_test_buttons&language=en
x-internal-service-key: <key>
```

Query parameters:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `channelConfigId` | yes | Tenant WhatsApp channel config UUID |
| `templateName` | one of name/id | Filter by template name |
| `templateId` | one of name/id | Fetch a single template by Meta template ID |
| `language` | no | Filter results by language code |

Response:

```json
{
  "channelConfigId": "11111111-1111-4111-8111-111111111111",
  "templates": [
    {
      "id": "123456789012345",
      "name": "worktual_test_buttons",
      "language": "en",
      "status": "APPROVED",
      "category": "UTILITY",
      "rejectedReason": null
    }
  ]
}
```

Common Meta `status` values: `PENDING`, `APPROVED`, `REJECTED`, `PAUSED`, `DISABLED`.

### List all templates and status

```http
GET /internal/v1/whatsapp/templates?channelConfigId=<uuid>
x-internal-service-key: <key>
```

Optional query filters: `templateName`, `language`, `status`, `return_template=true`. Follows Meta Graph pagination and returns every template on the WABA. When `return_template=true`, each item includes Meta `components`.

Response:

```json
{
  "channelConfigId": "11111111-1111-4111-8111-111111111111",
  "count": 2,
  "templates": [
    {
      "id": "123456789012345",
      "name": "worktual_test_buttons",
      "language": "en",
      "status": "APPROVED",
      "category": "UTILITY",
      "rejectedReason": null
    }
  ]
}
```

### Fetch one template (full by default)

```http
GET /internal/v1/whatsapp/templates/detail?channelConfigId=<uuid>&templateName=<name>
x-internal-service-key: <key>
```

Provide `templateName` or `templateId`. Optional: `language`, `status`, `return_template` (default `true`).

```json
{
  "channelConfigId": "11111111-1111-4111-8111-111111111111",
  "template": {
    "id": "123456789012345",
    "name": "worktual_test_buttons",
    "language": "en",
    "status": "APPROVED",
    "category": "UTILITY",
    "rejectedReason": null,
    "components": [
      { "type": "BODY", "text": "Thanks for contacting Worktual." }
    ]
  }
}
```

### Mark message as read

```http
POST /internal/v1/whatsapp/messages/wamid-inbound/read
Content-Type: application/json
x-internal-service-key: <key>
```

```json
{
  "channelConfigId": "11111111-1111-4111-8111-111111111111"
}
```

## Error format

```json
{
  "error": {
    "code": "meta_provider_error",
    "message": "Human-readable message",
    "retryable": false
  }
}
```

## Logs

| File | Content |
|------|---------|
| `apps/social-service/logs/webhooks/whatsapp.log` | Inbound webhook events |
| `apps/social-service/logs/messages/outbound.log` | Outbound sends and auto-replies |
| `apps/social-service/logs/app/social-service.log` | General service logs |

## Local development

```bash
npm run -w social-service dev
npm run -w social-service verify-decryption -- <phone_number_id>
npm run -w social-service test
```

## Related docs

- Service env example: `apps/social-service/.env.example`
- Top-level overview: `docs/WHATSAPP_SOCIAL_SERVICE.md`
