# Setup — email channels

## Purpose

Configure outbound/inbound **email channels** mapped to purchased products (Contact Centre and/or Campaign). My Account stores provider connection, domain, and CCaaS handler mode; spokes send/receive mail using this config.

## Auth

Customer Bearer + org admin for writes.

## Source map

| Layer | Path |
|-------|------|
| Client | [`src/lib/setup/setupApi.js`](../../src/lib/setup/setupApi.js) |
| Product allowlist | [`src/lib/productCatalog.js`](../../src/lib/productCatalog.js) → `EMAIL_CHANNEL_PRODUCT_IDS` |
| Server | [`server/setupChannels.js`](../../server/setupChannels.js) |
| Repo | [`server/repositories/raw/setupChannels.repo.js`](../../server/repositories/raw/setupChannels.repo.js) |
| OAuth helpers | `server/googleOAuth.js`, `server/yahooOAuth.js`, Microsoft Graph helpers |

## Endpoints

| Method | Path | Client helper | Body / query | Response | Notes |
|--------|------|---------------|--------------|----------|-------|
| GET | `/api/v1/me/setup/channels?type=email` | `listChannelConfigs("email")` | `type` | `{ channels }` | Also used without type for mixed lists |
| GET | `/api/v1/me/setup/channels/email/:id` | `getEmailChannelConfig` | — | `{ config }` → client returns `config` | |
| POST | `/api/v1/me/setup/channels/email` | `createEmailChannelConfig` | products, provider, addresses, … | `{ config }` | Creates channel + email row |
| PATCH | `/api/v1/me/setup/channels/email/:id` | `updateEmailChannelConfig` | partial wizard fields | `{ config }` | |
| DELETE | `/api/v1/me/setup/channels/email/:id` | `deleteEmailChannelConfig` | — | `204` | |
| POST | `/api/v1/me/setup/channels/email/:id/verify` | `verifyEmailChannelConfig` | — | `{ config }` | Connection verify |
| POST | `/api/v1/me/setup/channels/email/:id/confirm-domain` | `confirmEmailDomain` | — | `{ config }` | DNS / domain confirmation |
| GET | `/api/v1/me/setup/channels/email/:id/oauth/connect` | `startEmailOAuthConnect` | `provider` query | `{ authorizeUrl }` or redirect | **Fetch with Bearer first**, then redirect browser to `authorizeUrl` — do not navigate straight to this API URL (drops auth) |

Helpers:

- `emailOAuthConnectUrl(id, { provider, redirect })` — builds URL string when needed
- OAuth callbacks: `/auth/google/callback`, `/auth/microsoft/callback`, `/auth/yahoo/callback`

## Key body fields (create / patch)

| Field | Meaning |
|-------|---------|
| `productIds` | Subset of `["contact-center","campaign"]` |
| `providerType` | e.g. third_party / custom_domain / hosted |
| `oauthProvider` | `google` / `microsoft` / `yahoo` / other |
| `ccaasHandler` | `bot` \| `human` \| `bot_then_human` (CCaaS only) |
| SMTP / IMAP fields | When third-party SMTP mode |

## Dependencies / gates

- At least one of Contact Centre or Campaign purchased.
- Server enforces `EMAIL_CHANNEL_PRODUCT_IDS`.

## Reuse notes

- **Campaign / CCaaS:** load config by id; use `senderEmail`, OAuth connection, and handler mode — do not store duplicate mailbox secrets in the spoke.
- Distinct from **internal** staff mail API (`/api/mail/*`) — see [internal/mail.md](../internal/mail.md).
