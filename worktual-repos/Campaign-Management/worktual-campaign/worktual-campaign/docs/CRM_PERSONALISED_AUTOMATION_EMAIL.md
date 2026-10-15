# Email to CRM team — Personalised CRM backend automation

Copy the sections below into your mail client. Adjust LAN vs production URLs for the recipient environment.

---

**Subject:** Worktual Campaign — Personalised CRM monitor/agent API (keys + curl)

**To:** CRM engineering / integration

**Cc:** Campaign team (as needed)

---

Hi team,

Campaign now supports **backend-only Personalised CRM sends** for your monitor/agent: one shared integration key plus **`organization_id`** in the JSON body. No end-user login and no CRM access JWT on this path.

The existing **iframe / logged-in user** flow is unchanged (`Authorization: Bearer <CRM access JWT>` on `POST /api/campaigns/personalised-crm`).

---

## 1. Base URLs

| Environment | Campaign API (CRM calls this) | Campaign UI (operators) |
|-------------|-------------------------------|-------------------------|
| **LAN (current dev)** | `http://192.168.13.91:3001` | `http://192.168.13.91:5173` |
| **Production** | `https://rebuild-campaign-api.worktual.com` | `https://rebuild-campaign.worktual.com` |

CRM must **not** call Agents (`:8005`), A2A, or Hub on-demand endpoints for this feature.

Health check: `GET {API}/health` → 200.

---

## 2. Keys and secrets (what CRM stores vs what Campaign stores)

### CRM monitor/agent — **send this on every automation request**

| Name | Value (current LAN / shared with CRM) | HTTP usage |
|------|----------------------------------------|------------|
| **`CRM_INTEGRATION_KEY`** | `crm-int-9Kp4Wm2Rx7Nv8sL3tYc5HdaB6uQ1eZ` | Header: **`X-Crm-Integration-Key: crm-int-9Kp4Wm2Rx7Nv8sL3tYc5HdaB6uQ1eZ`** |

Alternative (same value): `Authorization: Bearer crm-int-9Kp4Wm2Rx7Nv8sL3tYc5HdaB6uQ1eZ`

Store `CRM_INTEGRATION_KEY` in CRM server env (agent/worker). **Do not** expose in browser or mobile apps.

### Server-side only — **do not put in Authorization for automation**

| Name | Value (must match CRM ↔ Campaign) | Purpose |
|------|-----------------------------------|---------|
| **`CRM_JWT_ACCESS_SECRET`** | `7noyifG2Pj61_cPAv04F88xDSq3jlOXF6kROV0c-AwgfFan6W9r44o4WZUQ7J_OJ` | Same as CRM **`JWT_ACCESS_SECRET`**. Used to **sign** user access JWTs (embed + UI API). **Not** the automation Bearer token. |
| **`CRM_JWT_ISSUER`** | `worktual-crm` | Claim on user JWTs (embed path). |
| **`CRM_JWT_USER_ID_CLAIM`** | `sub` | Accounts `setup_users.id` on user JWTs. |
| **`CRM_JWT_ALGORITHM`** | `HS256` | User JWT algorithm. |

Campaign backend `.env` must include `CRM_INTEGRATION_KEY` and the `CRM_JWT_*` vars above. Restart API after changes.

**Do not use** Campaign `INTERNAL_SERVICE_KEY` or `JWT_SECRET` for CRM Personalised CRM.

---

## 3. Automation endpoint (monitor/agent)

```http
POST /api/campaigns/personalised-crm/automation
X-Crm-Integration-Key: crm-int-9Kp4Wm2Rx7Nv8sL3tYc5HdaB6uQ1eZ
Content-Type: application/json
```

### Required JSON fields

| Field | Required | Notes |
|-------|----------|--------|
| `organization_id` | Yes | Accounts org id string, e.g. `"1012"`. Tenant for the send. |
| `channels` | Yes | e.g. `["email"]`, `["email","whatsapp"]`. |
| Audience | Yes | At least one of: `people[]`, `emails[]`, `phones[]`, `contact_ids[]`, `customer_ids[]`. |
| `acting_user_id` | No | Active `setup_users.id` **in that org**. If omitted, Campaign picks the first active user in the org for audit (`created_by`). |
| `name`, `brief` | Recommended | Campaign generates copy from `brief`. |
| `send_at`, `timezone` | Optional | Omit `send_at` = send now. |

**Do not** send `organization_id` on the **user JWT** route. **Do not** send `request_text` (Hub on-demand).

### Example (send now, org 1012)

```bash
curl -sS -X POST 'http://192.168.13.91:3001/api/campaigns/personalised-crm/automation' \
  -H 'X-Crm-Integration-Key: crm-int-9Kp4Wm2Rx7Nv8sL3tYc5HdaB6uQ1eZ' \
  -H 'Content-Type: application/json' \
  -d '{
    "organization_id": "1012",
    "name": "Monitor trigger",
    "brief": "Follow up after the pricing call.",
    "channels": ["email"],
    "people": [{ "email": "contact@example.com" }]
  }'
```

Use **ASCII straight quotes** in JSON (not curly “ ” from Word/Slack).

### Success response (202)

```json
{
  "statusCode": 202,
  "message": "Personalised CRM request received",
  "run_id": "1484",
  "status": "live",
  "send_at": "2026-10-01T05:42:15.313Z",
  "timezone": "Asia/Kolkata",
  "channels": ["email"],
  "audience_count": 1,
  "warnings": []
}
```

Keep **`run_id`** for support. Operators see the run under Campaign → monitoring → **Personalised CRM** (`/campaigns?tab=personalised-crm`).

### HTTP errors (automation)

| Code | Typical cause |
|------|----------------|
| **401** | Wrong/missing `X-Crm-Integration-Key` or `CRM_INTEGRATION_KEY` not set on Campaign API |
| **400** | Invalid JSON, unknown org, acting user not in org, no audience, contact not in org CDP |
| **403** | Org has no active Campaign product, no branch, or inactive acting user |
| **502** | Template prepare (A2A) failure — ops: check `backend` + `a2a` on Campaign host |

---

## 4. User JWT path (CRM Marketing UI — unchanged)

For iframe / logged-in user:

```http
POST /api/campaigns/personalised-crm
Authorization: Bearer <CRM access JWT>
```

JWT = minted CRM access token (`eyJ…` three parts), **not** `CRM_JWT_ACCESS_SECRET`. Org comes from JWT user, not body.

Embed: `postMessage` `{ type: "worktual:campaign-auth", token }`. See `docs/CRM_CAMPAIGN_HANDOFF.md`.

---

## 5. Preconditions per org

Before automation succeeds for an org:

1. Org exists in Accounts.
2. Active **Campaign** product on org (`campaign.organization_products`).
3. For **email** channel: org **My Accounts** mailbox send-ready.
4. Contact email/phone/id must resolve in **that org’s** CDP (same org as `organization_id`).

---

## 6. Docs in Campaign repo

- `docs/PERSONALISED_CRM_API.md` — full API
- `docs/CRM_CAMPAIGN_HANDOFF.md` — JWT + embed + automation summary
- `docs/CRM_CAMPAIGN_INTEGRATION.md` — topology

---

## 7. Verified on LAN

- `POST …/personalised-crm/automation` with `CRM_INTEGRATION_KEY` + `organization_id` **1012** → **202**, email sent, run visible in Personalised CRM tab.
- Optional `acting_user_id` tested; omitting it uses default active user in org.

Please confirm CRM agent env uses **`CRM_INTEGRATION_KEY`** as above and targets the correct API base URL for your environment.

Thanks,  
Campaign team

---

*Internal reference — Campaign backend env (ops): `CRM_INTEGRATION_KEY`, `CRM_JWT_ACCESS_SECRET`, `CRM_JWT_ISSUER`, `CRM_JWT_USER_ID_CLAIM`, `CRM_JWT_ALGORITHM`. Deploy template: `deploy/server/backend.env`.*
