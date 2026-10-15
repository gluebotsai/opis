# Live conversations lookup

CRM calls this before a nurture call or chat. The response says whether that person already has an open Contact Center conversation, and on which channels.

A conversation is open while its status is `bot_active`, `queued`, `assigned`, or `active`. `resolved` and `closed` are not returned.

## URLs

| Where | Method | URL |
|-------|--------|-----|
| Local | `POST` | `http://localhost:3000/internal/v1/contacts/live-conversations` |
| QA server | `POST` | `https://rebuild-ccaas-api.worktual.com/cc-core-api/internal/v1/contacts/live-conversations` |

## Headers

| Header | Value |
|--------|--------|
| `Content-Type` | `application/json` |
| `x-internal-service-key` | The configured `INTERNAL_SERVICE_KEY` |

Do not send `x-tenant-id`. The organization id is in the body. A missing or wrong service key returns 401.

## Request

```json
{
  "organizationId": "1003",
  "identifier": "9876543210"
}
```

`organizationId` is the numeric organization id. `identifier` is one value. Send any of these in that same field:

| Identifier | Examples |
|------------|----------|
| Mobile or phone, with or without country code | `9876543210`, `919876543210`, `+91 98765 43210`, `00919876543210` |
| WhatsApp number | Same phone forms as above |
| Web chat visitor id | The visitor id stored on the chat |
| Instagram id | The Instagram user id |
| Facebook id | The Facebook user id |
| CDP id | `cdp_1003_suji` |

Phone matching ignores `+`, spaces, and dashes. A national number matches the same person stored with a country code when both sides have at least 10 digits.

A missing `organizationId` or `identifier`, or an organization id that is not numeric, returns 400.

## Response

HTTP 200. An unknown identifier is not a 404. It is the empty shape below.

Nothing open, and the person was found:

```json
{
  "contactId": "cdp_1003_suji",
  "matchedAs": "whatsapp_phone",
  "live": false,
  "channels": [],
  "conversations": []
}
```

Open on one or more channels:

```json
{
  "contactId": "cdp_1003_suji",
  "matchedAs": "whatsapp_phone",
  "live": true,
  "channels": ["whatsapp", "webchat"],
  "conversations": [
    {
      "conversationId": "104821",
      "channel": "whatsapp",
      "status": "active",
      "with": "agent",
      "assignedUserId": "5012",
      "startedAt": "2026-10-08T08:15:00.000Z",
      "updatedAt": "2026-10-08T08:22:10.000Z"
    },
    {
      "conversationId": "104900",
      "channel": "webchat",
      "status": "bot_active",
      "with": "bot",
      "assignedUserId": null,
      "startedAt": "2026-10-08T08:21:40.000Z",
      "updatedAt": "2026-10-08T08:21:40.000Z"
    }
  ]
}
```

The identifier matches nobody and nothing is open:

```json
{
  "contactId": null,
  "matchedAs": null,
  "live": false,
  "channels": [],
  "conversations": []
}
```

`live` is true only when `conversations` is not empty. `channels` is the distinct `channel` values from that list, in the same order.

| Field | Values |
|-------|--------|
| `matchedAs` | `cdp_id`, `phone`, `phone_secondary`, `whatsapp_phone`, `webchat_visitor`, `instagram_user`, `facebook_user`, `email` |
| `channel` | `webchat`, `email`, `voice`, `whatsapp`, `instagram`, `facebook` |
| `status` | `bot_active`, `queued`, `assigned`, `active` |
| `with` | `bot` when status is `bot_active`, `queue` when status is `queued`, `agent` when status is `assigned` or `active` |

`assignedUserId` is the setup user id when a person is assigned. It is null while the bot or the queue still owns the conversation.

## How CRM should use it

Call this before starting a nurture conversation. If `live` is true, `channels` lists the channels that are already open. CRM decides whether to skip those channels. This API does not block the nurture call.
