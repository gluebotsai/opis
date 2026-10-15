# Instagram reconnect — handoff for My Account

**Audience:** My Account / channel-setup engineer  
**Goal:** Fix broken Instagram Meta token so CCaaS `social-service` can process Instagram DM webhooks.

---

## Problem summary

Instagram webhook verify on QA is working, but inbound DMs cannot be processed because the stored Instagram access token is **invalid**.

Graph API check against the decrypted `access_token_encrypted` for `provider = 'instagram'` returns:

```text
Invalid OAuth access token - Cannot parse access token  (OAuthException code 190)
```

The Facebook Page token for the same org still works and was used to confirm the IG username.

---



## Target Instagram account (for testing after fix)


| Field                         | Value               |
| ----------------------------- | ------------------- |
| Instagram username (DM this)  | `worktual_mcp`      |
| IG display name               | Masthon babu        |
| `ig_business_account_id`      | `17841440688586752` |
| Linked Facebook Page          | **Worktual tpi**    |
| Page `page_id`                | `1205028332698224`  |
| Meta app (Instagram webhooks) | `2065771691480864`  |


Tester accounts must DM: [https://www.instagram.com/worktual_mcp/](https://www.instagram.com/worktual_mcp/)

---



## DB row to fix

Table: `accounts.setup_social_configs`


| Field                    | Current value                          | Expected after fix                        |
| ------------------------ | -------------------------------------- | ----------------------------------------- |
| `provider`               | `instagram`                            | `instagram`                               |
| `channel_config_id`      | `2ceb816f-7caf-4b18-a771-41cacd7b876b` | same                                      |
| `ig_business_account_id` | `17841440688586752`                    | same (or refreshed if Meta returns new)   |
| `page_id`                | **empty / null**                       | should be set (likely `1205028332698224`) |
| `meta_user_name`         | `worktual_mcp`                         | ok                                        |
| `meta_connection_status` | `connected` (stale)                    | `connected` after real reconnect          |
| `access_token_encrypted` | present but **unusable**               | new AES-256-GCM ciphertext from reconnect |


Related Facebook row (token OK — do not break):


| Field                    | Value                                  |
| ------------------------ | -------------------------------------- |
| `provider`               | `facebook`                             |
| `channel_config_id`      | `b9cf92a5-92ec-42e0-90be-fc935723ab31` |
| `page_id`                | `1205028332698224`                     |
| `meta_connection_status` | `connected`                            |


---



## What My Account must do



### 1) Reconnect Instagram OAuth for this channel

Use the existing Meta social OAuth path (see [CHANNEL_CONFIGURATIONS_AND_CONNECTORS.md](./CHANNEL_CONFIGURATIONS_AND_CONNECTORS.md) §5.3):

1. Open channel setup for org that owns `channel_config_id = 2ceb816f-7caf-4b18-a771-41cacd7b876b`.
2. For Instagram provider row:
  - Prefer **Disconnect** then **Connect with Meta** (cleanest).
  - Or force reconnect if UI has “Reconnect / Needs reauth”.
3. Meta authorize must grant Instagram Messaging + Page access for:
  - IG: `@worktual_mcp`
  - Page: **Worktual tpi**
4. On callback, `saveSocialMetaConnection` must persist:
  - valid long-lived / Page access token → `access_token_encrypted`
  - `page_id`
  - `ig_business_account_id`
  - `meta_connection_status = 'connected'`
  - `meta_connected_at = now()`
  - `token_expires_at` if available



### 2) Encryption key must match CCaaS

`access_token_encrypted` is AES-256-GCM using `MS_TOKEN_ENCRYPTION_KEY`.

- My Account encrypts with this key.
- `social-service` decrypts with the **same** key from QA `.env`.
- If keys diverge, token will decrypt to garbage → Graph `Cannot parse access token` (what we see now can also be a corrupted/wrong-format token).

Confirm QA My Account and QA CCaaS share the same `MS_TOKEN_ENCRYPTION_KEY`.

### 3) App / product alignment

Instagram webhooks are configured on Meta app:

- App ID: `2065771691480864`
- Webhook (QA): `https://rebuild-ccaas-api.worktual.com/social-api/webhooks/instagram`
- Verify token: same as WhatsApp verify token used in CCaaS `.env` (`META_INSTAGRAM_VERIFY_TOKEN`)

OAuth connect should use an app that can issue a Page token valid for that IG business account (same Business / Page / IG link).

### 4) Do **not** manually paste a raw token into DB

Unless you use the exact My Account encrypt helper (`iv:tag:ciphertext` AES-256-GCM format). Prefer OAuth reconnect.

---



## Acceptance checks (My Account)

After reconnect, run:

```sql
SELECT
  provider,
  channel_config_id,
  page_id,
  ig_business_account_id,
  meta_connection_status,
  meta_connected_at,
  token_expires_at,
  length(access_token_encrypted) AS token_len,
  updated_at
FROM accounts.setup_social_configs
WHERE channel_config_id = '2ceb816f-7caf-4b18-a771-41cacd7b876b'
   OR provider = 'instagram';
```

**Pass criteria:**

1. `meta_connection_status = 'connected'`
2. `page_id` is **not null** (expect `1205028332698224` if still linked to Worktual tpi)
3. `ig_business_account_id = '17841440688586752'` (or updated if Meta changed — tell CCaaS team)
4. `updated_at` / `meta_connected_at` is recent
5. Optional Graph sanity (with decrypted token, do **not** log the token):

```http
GET https://graph.facebook.com/v26.0/17841440688586752?fields=username,name,id
Authorization: Bearer <decrypted_page_or_ig_token>
```

Expected: `"username": "worktual_mcp"`

---



1. 
  -  `received`
  - `messenger inbound message received`
  - **not** `could not resolve messenger webhook connection`
  - **not** token / decrypt errors

Webhook URL (already verified working for GET):

```text
https://rebuild-ccaas-api.worktual.com/social-api/webhooks/instagram
```

---



## Why CCaaS needs this

Inbound Instagram webhook flow in `social-service`:

1. Meta POST → signature verify (`META_INSTAGRAM_APP_SECRET`)
2. Resolve credentials by `ig_business_account_id` (fallback Instagram `page_id`) from `setup_social_configs`
3. Decrypt `access_token_encrypted` with `MS_TOKEN_ENCRYPTION_KEY`
4. Forward to cc-core / bot / agent reply path (uses same token for send)

Broken token = webhook may arrive, but channel resolve / reply / renewal fails.

### Meta console “Test” vs real DM

Meta Developer Console **Test** for Instagram often sends `entry.id = "0"`. That is a placeholder — it will **never** match a real `ig_business_account_id` / `page_id`. CCaaS ignores it with:

`ignored meta webhook test placeholder entry id`

Use a **real DM** to `@worktual_mcp` from a tester account. Real payloads use `entry.id = 17841440688586752`.

---

