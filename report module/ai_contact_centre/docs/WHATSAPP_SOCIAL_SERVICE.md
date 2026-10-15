# WhatsApp social-service

> **Canonical CCaaS documentation:** [docs/ccaas/WHATSAPP_SOCIAL_SERVICE.md](./ccaas/WHATSAPP_SOCIAL_SERVICE.md)

`social-service` is an independent Meta WhatsApp Cloud API adapter. Customer
OAuth tokens remain stored in `accounts.setup_social_configs`; the service reads
them under staff RLS context and decrypts them only in memory with AES-256-GCM.

Contact-center conversation ingestion and agent delivery are intentionally not
part of this service yet.

## Configuration

See `apps/social-service/.env.example`. Required settings:

- `INTERNAL_SERVICE_KEY`: authenticates callers of social-service internal APIs.
- `MS_TOKEN_ENCRYPTION_KEY`: 32-byte hexadecimal key used by My Account to encrypt
  `access_token_encrypted` (AES-256-GCM: `base64(iv):base64(authTag):base64(ciphertext)`).
- `META_WHATSAPP_VERIFY_TOKEN`: shared callback verification token configured in Meta.
- `META_WHATSAPP_APP_SECRET`: validates `x-hub-signature-256`.
- `META_WHATSAPP_APP_ID`: required for long-lived user-token exchange.
- `META_GRAPH_API_VERSION`: Graph API version, default `v26.0`.

Tenant access tokens and phone number IDs must not be set in environment
variables. They come from `accounts.setup_social_configs`.

## Optional Accounts API credential source

When direct database decryption is not configured, the service can instead use
`ACCOUNTS_INTERNAL_API_URL` and `ACCOUNTS_INTERNAL_SERVICE_KEY`.

Every route requires `x-internal-service-key`.

- `GET /internal/v1/social/whatsapp/configs/by-phone-number/:phoneNumberId`
- `GET /internal/v1/social/whatsapp/configs/:channelConfigId`
- `POST /internal/v1/social/whatsapp/configs/:channelConfigId/renew`
- `POST /internal/v1/social/whatsapp/configs/:channelConfigId/needs-reauth`

Credential lookup and renewal responses:

```json
{
  "channelConfigId": "11111111-1111-4111-8111-111111111111",
  "organizationId": "22222222-2222-4222-8222-222222222222",
  "provider": "whatsapp",
  "connectionStatus": "connected",
  "phoneNumberId": "123456789",
  "wabaId": "987654321",
  "accessToken": "decrypted-runtime-token",
  "tokenExpiresAt": "2026-09-01T00:00:00.000Z"
}
```

Accounts must only return connected WhatsApp configs. It must perform token
exchange, encryption, persistence, and atomic `needs_reauth` transitions.

## Meta webhook

Configure the Meta callback URL as:

```text
https://your-social-service.example.com/webhooks/whatsapp
```

Meta verifies it with:

```http
GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
```

Inbound events are posted to the same path. The service verifies the body
signature before parsing, resolves `metadata.phone_number_id` through Accounts,
and normalizes inbound messages and status updates. Valid events are acknowledged
without requiring cc-core.

## Send text

```http
POST /internal/v1/whatsapp/messages
Content-Type: application/json
x-internal-service-key: replace-me
```

```json
{
  "channelConfigId": "11111111-1111-4111-8111-111111111111",
  "to": "919876543210",
  "body": "Hello from Worktual",
  "previewUrl": false
}
```

## Send template

The template must already be approved in the selected customer's Meta account.

```http
POST /internal/v1/whatsapp/templates
Content-Type: application/json
x-internal-service-key: replace-me
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
      "parameters": [
        { "type": "text", "text": "ORD-1234" }
      ]
    }
  ]
}
```

## Template approval

Submit a new template to Meta for review and poll approval status. See
[docs/ccaas/WHATSAPP_SOCIAL_SERVICE.md](./ccaas/WHATSAPP_SOCIAL_SERVICE.md#submit-template-for-meta-approval).

- `POST /internal/v1/whatsapp/templates/submit-approval`
- `GET /internal/v1/whatsapp/templates/approval-status`

## Mark read

```http
POST /internal/v1/whatsapp/messages/wamid-inbound/read
Content-Type: application/json
x-internal-service-key: replace-me
```

```json
{
  "channelConfigId": "11111111-1111-4111-8111-111111111111"
}
```

## Token lifecycle

Meta does not issue a conventional refresh token for this flow. Before expiry,
social-service asks Accounts to exchange the still-valid user token for a
long-lived token. On Meta OAuth error `190`, the service evicts cached credentials,
requests one renewal, and retries the original request once.

If renewal or the retry confirms that the token is invalid or expired, Accounts
marks the connection `needs_reauth`. The customer must reconnect their Meta
account; the service does not continue retrying.

Errors use:

```json
{
  "error": {
    "code": "needs_reauth",
    "message": "The WhatsApp connection must be reconnected",
    "retryable": false
  }
}
```
