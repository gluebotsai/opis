# Instagram OAuth requirements for CCaaS

**Audience:** My Account / channel setup team  
**Environment:** QA  
**Purpose:** Ensure an Instagram connection created by My Account works automatically in CCaaS without manual database updates.

## Current CCaaS problem

Meta successfully delivers Instagram webhooks to:

```text
https://rebuild-ccaas-api.worktual.com/social-api/webhooks/instagram
```

Webhook signature verification also succeeds. The remaining failures are caused by
the OAuth data saved in `accounts.setup_social_configs`.

### Values observed during testing

| Item | Observed value |
|---|---|
| Instagram username | `worktual_mcp` |
| Linked Facebook Page | `Worktual tpi` |
| Page ID | `1205028332698224` |
| Graph Instagram business ID | `17841440688586752` |
| Instagram Login `/me.id` | `37074541055526421` |
| Instagram Login `/me.user_id` | `17841440688586752` |
| Messaging webhook `entry.id` | `17841471968897622` |
| Instagram webhook Meta app ID | `2065771691480864` |

These are different Meta identifier namespaces. In particular, the live webhook
`entry.id` does **not** equal either `/me.id` or `/me.user_id`.

### Failures seen by CCaaS

1. My Account saved `ig_business_account_id = 17841440688586752`, but Meta sent
   `entry.id = 17841471968897622`. CCaaS could not find the channel:

   ```text
   instagram configuration not found
   ```

2. A previous OAuth reconnect used Meta app `2041435029824740`
   (`W_bot_backup`) while the Instagram webhook belongs to app
   `2065771691480864`.

3. The Page token did not include `instagram_manage_messages`, so conversation
   lookup failed:

   ```text
   (#230) Requires instagram_manage_messages permission
   ```

4. A later reconnect saved an Instagram Login token (`IGAA...`). This token is
   valid on `graph.instagram.com`, but is rejected by `graph.facebook.com`.
   Token type and API host must therefore be stored/handled consistently.

5. Reconnects created new `channel_config_id` values. Reconnect must update the
   existing channel rather than create a replacement row, because CCaaS
   conversations and routing refer to the original channel configuration.

6. Meta currently sends new tester DMs as `message_edit` containing only `mid`
   and `num_edit: 0`, without sender or text. This is a Meta delivery issue.
   Correct messaging permissions and app/product alignment are required before
   treating the connection as fully operational.

## Required My Account implementation

### 1. Use one Meta app consistently

Instagram OAuth, webhook subscription, and messaging permissions must belong to:

```text
META_INSTAGRAM_APP_ID=2065771691480864
```

Do not obtain the Instagram channel token from app `2041435029824740`.

### 2. Request the correct permissions

For Facebook Login / Page-token integration, request and verify at least:

```text
instagram_basic
instagram_manage_messages
pages_show_list
pages_messaging
pages_read_engagement
pages_manage_metadata
```

For Instagram Login, request the equivalent Instagram Business messaging
permission supported by the configured Meta product (for example,
`instagram_business_manage_messages`).

Do not mark the channel `connected` only because OAuth returned a token. Verify
that the granted permissions include the messaging permission required by the
chosen integration type.

### 3. Save token type and use the matching API

My Account must distinguish these integration modes:

| Token | API host | Send endpoint |
|---|---|---|
| Page token (`EAA...`) | `graph.facebook.com` | `/{page_id}/messages` |
| Instagram Login token (`IGAA...`) | `graph.instagram.com` | `/me/messages` |

Recommended: persist an explicit value such as:

```text
meta_auth_type = facebook_page | instagram_login
```

Do not infer this permanently from a token prefix alone.

### 4. Preserve all Instagram identifiers

Do not overload `ig_business_account_id` with multiple identifier types.

Recommended persistence:

```text
ig_business_account_id     = Graph/Page Instagram business ID
ig_login_user_id           = Instagram Login /me.user_id
ig_login_scoped_id         = Instagram Login /me.id
ig_webhook_account_id      = messaging webhook entry.id
```

For the current QA account:

```text
ig_business_account_id = 17841440688586752
ig_login_user_id       = 17841440688586752
ig_login_scoped_id     = 37074541055526421
ig_webhook_account_id  = 17841471968897622
```

Important: OAuth `/me?fields=id,user_id,username` did **not** return the live
webhook `entry.id` in our test. Therefore, My Account must not assume
`user_id == webhook entry.id`.

If Meta does not expose `ig_webhook_account_id` during OAuth, leave it null and
allow CCaaS to bind it automatically when the first signed webhook arrives.
Persist that mapping in a dedicated field/table. This first-webhook binding is
automatic and is not a manual database correction.

### 5. Update the existing channel on reconnect

Reconnect must update the existing Instagram social configuration:

```text
UPDATE existing provider='instagram' row for the selected channel_config_id
```

It must not create a new `setup_channel_configs` row or a new
`channel_config_id` every time OAuth is repeated.

Use a transaction and enforce one active Instagram provider row per channel.

### 6. Persist the complete OAuth result

On a successful callback, `saveSocialMetaConnection` must atomically save:

```text
provider = instagram
page_id
ig_business_account_id
ig_login_user_id
ig_login_scoped_id
ig_webhook_account_id (when available)
meta_user_name
meta_app_id
meta_auth_type
granted_scopes
access_token_encrypted
token_expires_at
meta_connected_at
meta_connection_status
```

Requirements:

- Encrypt with the same `MS_TOKEN_ENCRYPTION_KEY` used by CCaaS QA.
- Never log or return the raw access token.
- Save `meta_connection_status = connected` only after validation succeeds.
- On missing messaging permission, save `needs_reauth` and return a clear UI
  error listing the missing permission.

## Validation required before marking connected

### Instagram Login token

Call:

```http
GET https://graph.instagram.com/v26.0/me?fields=id,username,account_type,user_id
Authorization: Bearer <token>
```

Expected:

```text
username = worktual_mcp
account_type = BUSINESS (or CREATOR)
```

Also verify that the token can access the messaging API appropriate to the
Instagram Login product.

### Facebook Page token

Validate the token and granted scopes, then call:

```http
GET https://graph.facebook.com/v26.0/1205028332698224
    ?fields=id,name,instagram_business_account{id,username}
Authorization: Bearer <page-token>
```

Expected:

```text
Page ID = 1205028332698224
Instagram ID = 17841440688586752
username = worktual_mcp
```

The granted scopes must include `instagram_manage_messages`.

## Required database/API contract for CCaaS

The runtime credential returned to CCaaS should include:

```json
{
  "channelConfigId": "<existing stable channel UUID>",
  "organizationId": "<organization UUID>",
  "provider": "instagram",
  "connectionStatus": "connected",
  "pageId": "1205028332698224",
  "igBusinessAccountId": "17841440688586752",
  "igWebhookAccountId": "17841471968897622",
  "instagramLoginScopedId": "37074541055526421",
  "authType": "instagram_login",
  "accessToken": "<decrypted only in trusted internal response>",
  "tokenExpiresAt": "<ISO timestamp>"
}
```

The internal response must never be exposed to the browser or public API.

## Acceptance criteria

My Account work is complete only when all checks pass:

1. Reconnect updates the existing `channel_config_id`; it does not create a new
   channel.
2. The stored token decrypts with the CCaaS QA encryption key.
3. OAuth/token belongs to Meta app `2065771691480864`.
4. The token has the required Instagram messaging permission.
5. Token type matches the API host used for messaging.
6. All Graph, Login-scoped, and webhook identifiers are preserved separately.
7. A real tester DM generates a signed webhook and resolves to the correct
   organization/channel without manual SQL.
8. The webhook contains a normal `message` event with sender and text, or the
   message can be retrieved by `mid`.
9. CCaaS logs:

   ```text
   messenger inbound message received
   messenger inbound message forwarded to cc-core
   ```

10. Bot response is successfully sent back to the Instagram conversation.

## Do not do

- Do not manually paste or update encrypted tokens in the database.
- Do not replace `ig_business_account_id` with a webhook ID.
- Do not assume `/me.user_id` always equals webhook `entry.id`.
- Do not create a new channel configuration on each reconnect.
- Do not mix an OAuth token from one Meta app with webhooks from another app.
- Do not mark the connection `connected` without checking messaging permission.
