# Auto bot call trigger

CRM calls this API to start a lead-nurturing voice bot call. cc-core publishes one message on Redis channel `CAMPAIGN_ACD_QA_70`. It does not use the live-call channel.

## URLs

| Where | Method | URL |
|-------|--------|-----|
| Local | `POST` | `http://localhost:3000/internal/v1/voice/auto-bot-call` |
| QA server | `POST` | `https://rebuild-ccaas-api.worktual.com/cc-core-api/internal/v1/voice/auto-bot-call` |

## Headers

| Header | Value |
|--------|--------|
| `Content-Type` | `application/json` |
| `x-internal-service-key` | `dev-internal-key` |

## Request

```json
{
  "organizationId": "1012",
  "number": "919150911820",
  "data": {
    "customer_name": "Subaz Bharathi",
    "phone": "919150911820",
    "email": "subazkumar4@gmail.com"
  },
  "instruction": "Greet the customer and confirm the recent order."
}
```

`organizationId` is the organization id. `number` is the customer number and is published as `ddi`. `data` is a JSON object. `instruction` is the text the CRM wants the bot to follow.

cc-core fills the rest and publishes `data` as that same object.

| Published field | Source |
|-----------------|--------|
| `domainId` | `organizationId` |
| `domainName` | `accounts.organizations.sip_domain_name` |
| `session_id` | Generated UUID |
| `req_type` | `AUTO_BOT_CALL` |
| `ddi` | `number` |
| `cli` | First active setup DID attached to an active queue |
| `data` | Request `data` object |
| `instruction` | Request `instruction` |

## Response

```json
{
  "ok": true,
  "sessionId": "ea54ca84-dbee-4f49-8f7b-3985c7c90b7b",
  "channel": "CAMPAIGN_ACD_QA_70",
  "domainName": "1012.call.worktual.com",
  "cli": "+919003009126"
}
```

## Published Redis message

```json
{
  "domainId": "1012",
  "domainName": "1012.call.worktual.com",
  "session_id": "ea54ca84-dbee-4f49-8f7b-3985c7c90b7b",
  "req_type": "AUTO_BOT_CALL",
  "ddi": "919150911820",
  "cli": "+919003009126",
  "data": {
    "customer_name": "Subaz Bharathi",
    "phone": "919150911820",
    "email": "subazkumar4@gmail.com"
  },
  "instruction": "Greet the customer and confirm the recent order."
}
```

## Errors

| Status | When |
|--------|------|
| `401` | Missing or invalid `x-internal-service-key` |
| `404` | Organization has no SIP domain, or no active DID on an active queue |
| `503` | Redis is not configured |
