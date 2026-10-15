# Digital Marketing social OAuth (Accounts contract)

CRM Digital Marketing publish (LinkedIn, Facebook, Instagram) **reads** org-level
OAuth from the **Onboarding internal connected-apps API** when
`PRODUCT_MCP_CONNECTORS_TOKEN` is set (`GET …/internal/connected-apps/{app_key}/credentials?organization_id=`).
Legacy local dev may set `ONBOARDING_ALLOW_SETUP_APP_CONNECTIONS_FALLBACK=true` to
SELECT `accounts.setup_app_connections`. CRM never `CREATE`/`ALTER`s `accounts.*`.

Same token crypto as mailbox OAuth (`docs/table-schemas.md` →
`accounts.mail_oauth_connections`, `backend/src/service/account/accounts-token-crypto.ts`).

## SELECT path (existing columns only)

CRM looks up rows for the current `organization_id` where `provider` /
`app_key` / `display_name` match:

| Platform | Match |
|---|---|
| LinkedIn | `linkedin` |
| Facebook | `facebook` or `meta` |
| Instagram | `instagram` (or Meta row with IG user metadata) |

Required existing columns (already used for Semrush MCP):

- `access_token_encrypted` / `refresh_token_encrypted`
- `status` (`active` / `connected` / `ok`, or `reauth` / `expired`)
- `external_account_id`
- `scopes`
- `metadata` JSON

## LinkedIn (MyAccounts)

Personal-profile posting only (`openid profile w_member_social`). Company-page
posting is not implemented.

MyAccounts must:

1. Enable those three scopes on the LinkedIn app / connect flow.
2. Store the access token on `accounts.setup_app_connections` for the org.
3. Optionally set `metadata.personUrn` / `authorUrn` to `urn:li:person:…`. If
   missing, CRM calls `GET /v2/userinfo` and uses `sub`.

CRM publish sequence (see team guide `LINKEDIN_POSTING_API_INTEGRATION.md`):

```text
GET /v2/userinfo
  → urn:li:person:{sub}
POST /rest/images?action=initializeUpload   (caption + image only)
PUT  signed upload URL
POST /rest/posts   Linkedin-Version: 202608
```

## Metadata Accounts should set (no DDL)

| Platform | `metadata` / `external_account_id` |
|---|---|
| LinkedIn | Person URN (`urn:li:person:…`) in `personUrn` / `authorUrn` |
| Facebook | Page id in `pageId` / `page_id` |
| Instagram | IG user id in `igUserId` / `instagram_user_id` |

## CRM behavior

- Generate / save / schedule work **without** tokens.
- `seo_publish_post` and the due-`scheduled_at` cron decrypt the token and call
  LinkedIn Posts / Meta Graph. Missing row or empty token → status
  `needs_reauth` and a connect message. **No accounts migration from CRM.**

Configuration → Email shows a read-only **Social publishing** card for orgs
that can access Digital Marketing.
