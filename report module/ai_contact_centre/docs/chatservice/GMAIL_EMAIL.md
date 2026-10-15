# Chat Service — Gmail Email Integration

Gmail inbound uses **Gmail API + GCP Pub/Sub pull subscription**. No webhook URL or ngrok is required.

## Architecture

```text
Gmail inbox
  → users.watch() → Pub/Sub topic Gmail_Mcp
  → subscription mcp (pull)
  → chat-service inbound processor
  → cc-core POST /internal/v1/email/conversations
  → mailbox policy + approved queue-profile snapshot
  → guarded email NLP (shadow, bot reply, or deterministic handoff)
  → email-enabled queue (`handles_email`) + live-agent offer
```

Outbound bot and agent messages are persisted to the delivery outbox before Gmail delivery:

```text
cc-core / other services
cc-core email_delivery_outbox
  → chat-service POST /internal/v1/email/deliver  (immediate attempt)
  → chat-service delivery worker               (bounded retry)
  → chat-service POST /internal/v1/email/send      (generic send API)
  → Gmail API messages.send
```

## GCP setup (existing prototype resources)

| Resource | Name |
|----------|------|
| Project | `gmail-test-502808` |
| Pub/Sub topic | `Gmail_Mcp` |
| Pub/Sub subscription | `mcp` (Pull — not Push) |
| Gmail publisher IAM | `gmail-api-push@system.gserviceaccount.com` → Pub/Sub Publisher on topic |

**No webhook URL** is configured in Google Console for pull subscriptions.

## Environment variables

Copy from [`apps/chat-service/.env.example`](../../apps/chat-service/.env.example):

```bash
GMAIL_PUBSUB_PROJECT_ID=gmail-test-502808
GMAIL_PUBSUB_TOPIC=projects/gmail-test-502808/topics/Gmail_Mcp
GMAIL_PUBSUB_SUBSCRIPTION=mcp
GMAIL_PUBSUB_CREDENTIALS=/path/to/cred.json
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
MS_TOKEN_ENCRYPTION_KEY=...
INTERNAL_SERVICE_KEY=...
CC_CORE_URL=http://localhost:3000
TICKETING_ATTACHMENTS_ROOT=/absolute/local/or/nfs/mount
```

Defaults: if `GMAIL_PUBSUB_TOPIC` / `GMAIL_PUBSUB_SUBSCRIPTION` are omitted, they fall back to `Gmail_Mcp` / `mcp`.

Inbound Gmail files are written below the repository's local `storage` directory by default,
and tickets receive relative paths such as
`Ticketing/attachments/<organization>/<thread>/<message>/<file>`. Point this variable at the
shared NFS mount in server environments by setting `TICKETING_ATTACHMENTS_ROOT`; the environment
value replaces the local default.

## Credentials

Setup Workspace **Contact Centre** email channels are the canonical credential source for CCaaS Gmail ingest/send:

```text
accounts.setup_channel_configs (channel_type = 'email', status = 'active', product_ids contains contact-center)
  → accounts.setup_email_configs (third_party_mode = 'oauth', oauth_provider = 'google')
    → accounts.mail_oauth_connections (access_token_encrypted, refresh_token_encrypted)
```

| Credential | Source | Purpose |
|------------|--------|---------|
| GCP service account JSON | `GMAIL_PUBSUB_CREDENTIALS` | Pub/Sub pull client only |
| OAuth tokens | `accounts.mail_oauth_connections` via `setup_email_configs.oauth_connection_id` | Gmail API read/send/watch |
| Mailbox identity | `accounts.setup_channel_configs.id` | `connectionId` / `mailbox_connection_id` in cc-core |
| Routing intent | `accounts.setup_email_configs.ccaas_handler` | Default mailbox policy when no `ccass.email_mailbox_policies` row exists |
| Encryption key | `MS_TOKEN_ENCRYPTION_KEY` | Decrypt `*_encrypted` DB columns |

CCaaS ingest/watch loads only channels whose `product_ids` includes `contact-center`. CRM-only
mailboxes are skipped unless looked up by explicit `connectionId` (for example
`POST /internal/v1/email/send` with `"source": "crm"`).

`accounts.setup_app_connections` remains for Connected Apps only; chat-service no longer reads Gmail tokens from that table.

Verify an active channel resolves:

```bash
npx tsx apps/chat-service/scripts/verify-gmail-oauth.ts support@yourdomain.com
```

Inspect channels and enable bot policy:

```bash
npx tsx apps/cc-core/scripts/enable-email-channel-bot.ts
npx tsx apps/cc-core/scripts/enable-email-channel-bot.ts --shadow
npx tsx apps/cc-core/scripts/enable-email-channel-bot.ts --live --queue-id <ccass-queue-uuid>
```

## HTTP APIs (internal)

### `POST /internal/v1/email/send`

Send email from any product (CRM, campaigns, etc.).

```json
{
  "organizationId": "uuid",
  "connectionId": "setup_channel_configs.id",
  "to": "customer@example.com",
  "subject": "Hello",
  "body": "Message body",
  "threadId": "optional-for-reply",
  "inReplyTo": "optional-message-id-header",
  "references": "optional-rfc-references-header",
  "source": "crm"
}
```

Headers: `x-internal-service-key`, `x-tenant-id`

### `POST /internal/v1/email/deliver`

Used by cc-core when an agent replies in the workspace (requires conversation context).

## Bot and live-agent routing

Mailbox policy is managed through `GET/PUT /api/v1/email/mailbox-policy`. Queue classifier
profiles are managed through `PUT /api/v1/queues/:id/routing-profile`.

1. `email_bot_enabled=false` preserves direct-to-agent routing.
2. Shadow mode classifies and audits without sending; direct routing remains active.
3. Auto-send mode starts in bot state and sends only grounded, guarded answers at or above
   the mailbox confidence threshold.
4. Explicit human requests, low confidence, missing grounding, guard failure, and provider
   failure hand off without sending generated text.
5. cc-core validates the selected queue against the tenant, mailbox allowlist, active state,
   and `handles_email` membership before channel-aware round-robin routing.
6. Follow-ups after handoff append without reactivating the bot. Resolved-thread replies
   restart according to mailbox policy.

If no email-enabled queue exists, the conversation remains queued without assignment and
cc-core logs `email conversation queued without an email-enabled queue`.

### Required queue setup

- The Accounts queue must be published to `ccass.queues` and be active.
- At least one queue member must have `handlesEmail=true` and `emailConcurrency >= 1`.
- The workspace user must have a linked `ccass.agents` profile.
- The agent must set presence to `ready` to receive offers.

The mailbox default queue is the rollback route. Empty allowlists retain the compatible
tenant-local email-queue fallback; production mailboxes should configure an explicit allowlist.

## Reliability and MIME

- Provider IDs are deduplicated in `ccass.email_provider_events`; the local JSON cache is removed.
- Pub/Sub ACKs only committed success and non-retryable malformed notifications; transient
  failures are NACKed. Configure a Pub/Sub dead-letter topic on the subscription.
- RFC `Message-ID`, `In-Reply-To`, and `References` are persisted separately from Gmail API IDs.
- Plain text and sanitized HTML are extracted. Attachment metadata has count/size limits and
  enters `scanState=pending`; blocked content must not be exposed until the scanner promotes it.
- Bot and agent replies use multipart plain-text/HTML messages and explicit mailbox connections.
- Delivery retries are bounded at five attempts; exhausted outbox rows are retained as failed
  dead letters for supervisor recovery.

## Health check

`GET /health` returns gmail block:

```json
{
  "gmail": {
    "enabled": true,
    "deliveryMode": "pubsub_pull",
    "webhookRequired": false,
    "topic": "projects/gmail-test-502808/topics/Gmail_Mcp",
    "subscription": "mcp",
    "liveAgentRouting": true
  }
}
```

## Run

```bash
npm run dev:chat-service
npm run dev:cc-core
```

Send a test email to the connected Gmail inbox and verify conversation in agent workspace.

See [Deferred Enterprise Work](../ccaas/DEFERRED_ENTERPRISE_WORK.md) for later email and
webchat hardening.
