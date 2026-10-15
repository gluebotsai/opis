# Public ticket intake API (P0)

Canonical B2B intake — all channels post here. Org is taken from the API key (not staff login).

## Help widget (web form)

Browser-safe embed — **no API secret** on the page. Uses a public `wgt_…` id.

1. Admin → Org preferences → Create Help widget (or `POST /api/integration/widgets`)
2. Paste the embed snippet on the customer site:

```html
<script src="https://YOUR_HOST/embed/worktual-help.js" data-widget-id="wgt_…" async></script>
```

3. Form posts to `POST /api/public/widgets/:publicId/tickets` → creates ticket with `channel: web_form` in that org.

Optional: set allowed origins (CORS). Empty = any origin (dev only).

---

## Public help center

Customers search published Knowledge Base articles (no login).

- Page: `https://YOUR_HOST/hc/{org-slug}` (e.g. `/hc/worktual`)
- Article: `/hc/{org-slug}/a/{articleId}`
- APIs (public):
  - `GET /api/public/help/:slug`
  - `GET /api/public/help/:slug/articles?q=&category=`
  - `GET /api/public/help/:slug/articles/:articleId`
- Only `status = Published` articles. Admin copies URL from Org preferences.

---

## Auth (server-to-server API keys)

- Header: `Authorization: Bearer wt_live_…` **or** `X-Api-Key: wt_live_…`
- Create keys (admin, Org preferences module): `POST /api/integration/keys` `{ "name": "Help widget" }`
- List: `GET /api/integration/keys`
- Revoke: `DELETE /api/integration/keys/:id`
- Secret is returned **once** on create.

## Create ticket

`POST /api/intake/tickets`

```json
{
  "channel": "web_form",
  "requester": { "name": "Riya Sharma", "email": "riya@clienta.com" },
  "subject": "VPN not connecting",
  "description": "Unable to connect since morning",
  "priority": "high",
  "externalRef": "crm_case_98213",
  "metadata": { "sourcePage": "/support" }
}
```

Channels: `email` | `web_form` | `chat` | `api` | `phone` (mapped to Email/Web/Chat/Phone on the ticket).

Optional `organizationId` must match the API key’s org if sent.

## Email adapter

Point your inbound provider (SendGrid Inbound Parse, Mailgun route, or a custom forwarder) at:

`POST /api/intake/email`  
Auth: same org API key (`Authorization: Bearer wt_live_…`)

Canonical JSON:

```json
{
  "from": { "name": "Riya Sharma", "email": "riya@clienta.com" },
  "subject": "VPN not connecting",
  "text": "Unable to connect since morning",
  "messageId": "<abc@mail.example>",
  "inReplyTo": "<previous@mail.example>",
  "references": ["<previous@mail.example>"]
}
```

Also accepts common SendGrid / Mailgun field names (`body-plain`, `stripped-text`, etc.).

Behavior:

- **New mail** → creates ticket (`channel: Email`), stores `messageId` for threading
- **Reply** (`In-Reply-To` / `References` match, or subject contains `#12345`) → appends a **public** note on that ticket

## Webchat (create + fetch)

Full docs with URL, payload, and sample output: **[README.md — Webchat integration APIs](./README.md#webchat-integration-apis)**.

| API | Method | Full URL |
|-----|--------|----------|
| Docs (browser) | `GET` | `http://192.168.13.42:3000/api/webchat/tickets/docs` |
| Create ticket | `POST` | `http://192.168.13.42:3000/api/webchat/tickets` |
| Lookup tickets | `POST` | `http://192.168.13.42:3000/api/webchat/tickets/lookup` |
| Verify customer | `POST` | `http://192.168.13.42:3000/api/webchat/customers/verify` |

Auth: `Authorization: Bearer wt_live_…`  
Create payload: `{ "name", "email"|"mobile", "issue" }`  
Lookup payload: `{ "email"|"mobile" }`  
Customer must exist; otherwise `{ "success": false, "error": "there is no account for this customer" }`.

## Response `201`

```json
{
  "ticketId": "…",
  "ticketNumber": "#12899",
  "status": "Open",
  "channel": "Web",
  "subject": "VPN not connecting",
  "createdAt": "…",
  "updatedAt": "…"
}
```

## Outbound customer email

Automatic emails to the requester when:

- Ticket created (intake / widget / portal)
- Staff posts a **public** note
- Status set to **Resolved**

Configure with `MAIL_MODE` + SMTP env vars — see `docs/INTEGRATIONS_README.md` §6.

---

Full how-to + status of all P0 integration work: **`docs/INTEGRATIONS_README.md`**.
