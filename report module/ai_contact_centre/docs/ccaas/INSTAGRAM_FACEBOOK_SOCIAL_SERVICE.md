# Instagram + Facebook Messenger (social-service)

Parallel Meta Messenger adapters in `apps/social-service` (port **3004**). WhatsApp stays on its own webhook and APIs; these channels are additive.

## Webhook URLs

| Channel | Path | Example (ngrok) | Example (QA) |
|---------|------|-----------------|--------------|
| WhatsApp (unchanged) | `/webhooks/whatsapp` | `https://<ngrok>/webhooks/whatsapp` | `https://rebuild-ccaas-api.worktual.com/social-api/webhooks/whatsapp` |
| Facebook | `/webhooks/facebook` | `https://<ngrok>/webhooks/facebook` | `https://rebuild-ccaas-api.worktual.com/social-api/webhooks/facebook` |
| Instagram | `/webhooks/instagram` | `https://<ngrok>/webhooks/instagram` | `https://rebuild-ccaas-api.worktual.com/social-api/webhooks/instagram` |

Configure each product in Meta Developer Console to its own callback URL. Verify tokens:

- `META_FACEBOOK_VERIFY_TOKEN` (falls back to `META_MESSENGER_VERIFY_TOKEN` / WhatsApp verify token)
- `META_INSTAGRAM_VERIFY_TOKEN` (same fallbacks)

App secrets:

- Facebook / shared: `META_MESSENGER_APP_SECRET` or `META_FACEBOOK_APP_SECRET` (fallback `META_WHATSAPP_APP_SECRET`)
- Instagram (separate Meta app supported): `META_INSTAGRAM_APP_SECRET` + `META_INSTAGRAM_APP_ID` (fallback to messenger/WhatsApp)

## Credential resolution

From `accounts.setup_social_configs` (AES-256-GCM via `MS_TOKEN_ENCRYPTION_KEY`):

| Channel | Lookup key | `provider` |
|---------|------------|------------|
| Facebook | `page_id` | `facebook` |
| Instagram webhook | `ig_webhook_account_id` (then Graph/Login identities for first-webhook binding) | `instagram` |
| Instagram Graph API | `ig_business_account_id` | `instagram` |

Facebook requires `page_id` + encrypted Page access token.

Instagram supports:
- **Page token** (`EAA…`, primary) → send via `graph.facebook.com/{pageId}/messages`
- **Instagram Login token** (`IGAA…`) → send via `graph.instagram.com/me/messages`

My Account persists `meta_auth_type`; CCaaS uses it to choose the API host
(token-prefix inference is legacy compatibility only). Page-token auth requires
`instagram_manage_messages`; Instagram Login requires
`instagram_business_manage_messages`.

Meta may send a webhook `entry.id` that differs from Graph
`instagram_business_account.id`. On first mismatch, social-service writes it to
`ig_webhook_account_id`; it never overwrites `ig_business_account_id`.

## Inbound flow

Thin route → signature verify → channel normalize → shared ingest/bot path:

1. `POST cc-core /internal/v1/social/conversations` with `channelType: "facebook" | "instagram"`
2. If `botEligible`: NLP `POST /api/v1/social/turn` → reply or handoff
3. Optional test auto-reply via `META_MESSENGER_AUTO_REPLY=true` (+ quick replies)

Normalize maps Meta PSID/IGSID → `customerRef` / `externalThreadId`, message mid → `externalMessageId`.

## Internal send APIs

```http
POST /internal/v1/facebook/messages
POST /internal/v1/instagram/messages
x-internal-service-key: <key>
```

```json
{
  "channelConfigId": "11111111-1111-4111-8111-111111111111",
  "to": "<PSID or IGSID>",
  "body": "Hello from Worktual"
}
```

Agent replies from the workspace use the same paths via cc-core `social-delivery`.

## Routing

cc-core `RoutableChannel` includes `instagram` and `facebook`. Queue members must set `handles_instagram` / `handles_facebook` (and concurrency columns).

## Channel logs

Instagram has a dedicated end-to-end log:

```text
logs/webhooks/instagram.log
```

It includes webhook verification, the exact Meta callback payload, signature and
credential failures, normalized inbound messages, cc-core ingest, bot/handoff
results, auto-replies, and internal outbound sends. Facebook uses
`logs/webhooks/facebook.log`; WhatsApp remains in `logs/webhooks/whatsapp.log`.

In Docker:

```bash
docker exec -it worktual-social-service sh -c 'tail -f logs/webhooks/instagram.log'
```

## Env (see `apps/social-service/.env.example`)

```bash
META_FACEBOOK_VERIFY_TOKEN=
META_INSTAGRAM_VERIFY_TOKEN=
# or META_MESSENGER_VERIFY_TOKEN=
# META_MESSENGER_APP_SECRET=   # optional; defaults to META_WHATSAPP_APP_SECRET
META_INSTAGRAM_APP_ID=
META_INSTAGRAM_APP_SECRET=
# META_MESSENGER_AUTO_REPLY=false
```

## Out of scope (v1)

- WhatsApp template approval for Messenger/IG
- Instagram Content Publishing APIs (DMs only)
- Changing WhatsApp webhook behavior
