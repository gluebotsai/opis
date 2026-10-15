# Worktual integrations — what we built & how to use it

This README covers the **P0 B2B intake / channel** work.  
Related detail docs: `intake-api.md`, `hybrid-onboarding-build-guide_integeration.md`, `ticketing-competitive-plan.md`.

---

## 1. What we have done (status)

| Item | Status | Where |
|------|--------|--------|
| Canonical intake API | **Done** | `POST /api/intake/tickets` |
| Org API keys | **Done** | `GET/POST/DELETE /api/integration/keys` + Org preferences UI |
| Help widget (web form) | **Done** | Embed + `POST /api/public/widgets/:id/tickets` |
| Email → ticket adapter | **Done** | `POST /api/intake/email` (+ reply threading) |
| Outbound customer email | **Done** | Create / public reply / resolve (SMTP or log mode) |
| Automation / triggers | **Done (MVP)** | `automation_rules` + run after create/update |
| Agent collision | **Done (MVP)** | Heartbeat presence + “X is viewing” banner |
| Public help center | **Done (MVP)** | `/hc/:slug` search + article pages |

**Model:** one org tenant + one intake door. Chatbot, Help, email, and phone are adapters into the same ticket table, scoped by `organization_id`.

```
Their product (Help / chatbot / email / call)
              ↓
     Intake API  OR  public widget  OR  email adapter
              ↓
     Ticketing portal (agents work tickets)
              ↓
     Optional outbound email to the requester
```

---

## Dual Agent + Resolver assignment

On create / intake:

| Created by | Agent (L1 `assignee_*`) | Resolver (L2 `resolver_*`) |
|------------|-------------------------|----------------------------|
| Customer / intake / widget / email | Auto by team + skills | Auto if skill confidence ≥ `RESOLVER_AUTO_ASSIGN_MIN_CONFIDENCE` (default **0.75**) |
| Admin | Same as customer (honor explicit agent if set) | Same |
| Agent | Creating agent (forced) | Same confidence gate (excludes self) |

Escalate sets **resolver** and **keeps** the L1 agent. Resolvers’ My Tickets include `resolver_*` (and legacy assignee matches). Agents stay on `assignee_*`.

Confidence comes from the LLM triage JSON field `confidence` (0–1). If missing, skill-score fallback is used (2 → `1.0`, General → `0.5`, none → `0.0`). Default threshold **0.75**.

Env: `RESOLVER_AUTO_ASSIGN_MIN_CONFIDENCE=0.75`

Automation action: `assignResolverId` / `assignResolverName` (does not clobber L1 assignee).

---

## 2. Prerequisites

1. Ticketing server running (`npm run dev` → port 3000).
2. Admin login (role with **Org preferences**).
3. For real SMTP outbound: set env vars (see §6). Default is **log mode** (safe for local).

---

## 2b. Admin guide — login → create API key (step by step)

This is the **client org admin** using **your Ticketing app** (same product agents use).

### Step 1 — Open Ticketing
Go to your Ticketing URL (local: `http://127.0.0.1:3000`).

### Step 2 — Log in as admin
- Email / password for that org’s **admin** user  
- Example smoke user: `jane.smith@worktual.com` (dev only)  
- After login you are in the agent workspace (Home, tickets, etc.)

### Step 3 — Create an org API key (UI)
1. Open **Org preferences** (sidebar).  
2. Find the **API keys** section.  
3. Enter a name (e.g. `Website + email integrations`).  
4. Click **Create API key**.

Advanced (API / curl) while logged in:

```bash
curl -b cookies.txt -X POST http://127.0.0.1:3000/api/integration/keys \
  -H 'Content-Type: application/json' \
  -d '{"name":"Website + email integrations"}'
```

### Step 4 — Copy the secret once
A modal shows the full `wt_live_…` secret **once**:
- Click **Copy secret**, store it securely, then **I've copied it** / **Done**.  
- Later the list only shows a **prefix** (e.g. `wt_live_aCUV…`), not the full secret again.  

### Step 5 — Give the key to integrators
Share `wt_live_…` with:
- Their backend / chatbot  
- Email inbound provider (SendGrid / Mailgun → `/api/intake/email`)  

**Do not** put this key in a public website page. For the website Help button use a **widget id** (`wgt_…`) instead (Org preferences → Help widget).

### Step 6 — (Optional) Create Help widget in UI
Still logged in as admin → **Org preferences → Help widget** → create → copy embed snippet to their site.  

### Step 7 — Test
```bash
curl -X POST http://127.0.0.1:3000/api/intake/tickets \
  -H "Authorization: Bearer wt_live_YOUR_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{
    "channel": "api",
    "requester": { "name": "Test User", "email": "test@client.com" },
    "subject": "Test ticket",
    "description": "Created with API key"
  }'
```

Ticket should appear in **that org’s** Ticketing lists.

### Step 8 — Revoke if leaked
In **Org preferences → API keys**, click **Revoke** next to the key (or `DELETE /api/integration/keys/:id`). Then create a new key (Step 3).

---

## 3. Org API keys (server-to-server)

Used by: intake API, email adapter, any backend integration.

### Create a key

**Preferred:** Org preferences → **API keys** → Create → copy secret once.

Or via API after login:

```bash
curl -b cookies.txt -X POST http://127.0.0.1:3000/api/integration/keys \
  -H 'Content-Type: application/json' \
  -d '{"name":"Production integrations"}'
```

Response includes `secret` **once** (`wt_live_…`). Store it securely.

### Use a key

```http
Authorization: Bearer wt_live_…
# or
X-Api-Key: wt_live_…
```

### List / revoke

- `GET /api/integration/keys`
- `DELETE /api/integration/keys/:id`

---

## 4. Intake API — create a ticket from anything

`POST /api/intake/tickets`

```bash
curl -X POST http://127.0.0.1:3000/api/intake/tickets \
  -H "Authorization: Bearer wt_live_…" \
  -H 'Content-Type: application/json' \
  -d '{
    "channel": "api",
    "requester": { "name": "Riya", "email": "riya@client.com" },
    "subject": "VPN not connecting",
    "description": "Since this morning",
    "priority": "high"
  }'
```

**Channels:** `email` | `web_form` | `chat` | `api` | `phone`  
Mapped on the ticket to: Email / Web / Chat / Phone.

Optional: `externalRef`, `metadata`, `accountId`, `category`.  
Optional `organizationId` must match the API key’s org.

**Response:** `ticketId`, `ticketNumber`, `status`, `channel`, `subject`, timestamps.

Code: `ui-backend/src/server/intake.ts`, `orgApiKeys.ts`

---

## 5. Help widget (website Help button)

Browser-safe: **public widget id only** (no API secret on the page).

### Create widget (admin)

1. Open **Org preferences** in the portal, or:

```bash
curl -b cookies.txt -X POST http://127.0.0.1:3000/api/integration/widgets \
  -H 'Content-Type: application/json' \
  -d '{"name":"Website Help","allowedOrigins":["https://app.customer.com"],"buttonLabel":"Help"}'
```

2. Copy `embedSnippet` from the response.

### Embed on customer site

```html
<script
  src="https://YOUR_HOST/embed/worktual-help.js"
  data-widget-id="wgt_…"
  async
></script>
```

### What it does

- Floating **Help** button → form (name, email, subject, description)
- Posts to `POST /api/public/widgets/:publicId/tickets`
- Creates ticket with `channel: web_form` in that org

Optional CORS: set `allowedOrigins`. Empty = any origin (dev only).

Files: `ui-backend/public/embed/worktual-help.js`, `orgWidgets.ts`

---

## 6. Email integration

### Inbound (mail → ticket)

Point SendGrid Inbound Parse / Mailgun route / custom forwarder to:

`POST /api/intake/email`  
Auth: same org API key

Canonical JSON:

```json
{
  "from": { "name": "Riya", "email": "riya@client.com" },
  "subject": "VPN not connecting",
  "text": "…",
  "messageId": "<abc@mail.example>",
  "inReplyTo": "<prev@mail.example>"
}
```

Also accepts common SendGrid / Mailgun field names.

| Situation | Result |
|-----------|--------|
| New message | New ticket, `channel: Email` |
| `In-Reply-To` / `References` match | Public note on existing ticket |
| Subject contains `#12863` | Treated as reply to that ticket |

### Outbound (ticket → customer email)

Automatic when:

- Ticket is **created** (portal, intake, or widget) and requester has a real email  
- Staff adds a **public** note  
- Ticket status → **Resolved**

**Modes (env):**

| Env | Behavior |
|-----|----------|
| `MAIL_MODE=log` (default if no SMTP) | Log + write `outbound_email_log` (no real send) |
| `MAIL_MODE=smtp` + `SMTP_HOST` | Send via SMTP |
| `MAIL_MODE=off` | Disabled |

```env
MAIL_MODE=smtp
MAIL_FROM=Support <support@yourdomain.com>
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=…
SMTP_PASS=…
# SMTP_SECURE=true   # if port 465
```

Code: `ui-backend/src/server/emailIntake.ts`, `customerMail.ts`

---

## 7. Quick test checklist

1. Login as admin → create API key → save secret.  
2. `POST /api/intake/tickets` → ticket appears in portal.  
3. Create Help widget → open a test HTML page with embed → submit form → ticket `Web`.  
4. `POST /api/intake/email` with `messageId` → ticket `Email`; reply with `inReplyTo` → note appended.  
5. With `MAIL_MODE=log`, create a ticket → server log shows `[mail:log]` and row in `ticketing.outbound_email_log`.  
6. Create automation rule (subject contains “billing” → priority high) → intake ticket with “billing” in subject → priority becomes **high**.

Or run: `node scripts/integrations-smoke.mjs`

---

## 8. Security notes

- Never put `wt_live_…` secrets in browser embeds — use widgets (`wgt_…`) for public sites.  
- Restrict widget `allowedOrigins` in production.  
- Rotate/revoke keys via `DELETE /api/integration/keys/:id`.  
- Provider webhook signature verification (SendGrid/Mailgun) is **not** implemented yet — add before public production traffic.

---

## 9. What’s next (remaining P0)

P0 intake / channels / collision / help center MVP are done.

**Hardening before production traffic:** email provider webhook signature verify; real SMTP staging.

### Public help center (done)

- URL: `/hc/{org-slug}` (demo often `/hc/worktual`)
- Lists **Published** KB articles only; search + category filters
- Article: `/hc/{org-slug}/a/{articleId}`
- APIs: `GET /api/public/help/:slug`, `…/articles`, `…/articles/:id` (no login)
- Admin: Org preferences → copy public URL; write articles in Knowledge Base

### Agent collision (done)

While an agent has ticket detail open:

- Client `POST /api/tickets/:ticketNumber/presence` every ~12s (heartbeat)
- Server upserts `ticket_presence`; returns other viewers (45s TTL)
- `DELETE` same path on leave
- Banner: “Ada is viewing this ticket”

Staff only (admin / agent / resolver). Soft warning — no edit lock.

---

## 10. Automations (MVP)

Admin-defined rules run in **Express** after AI triage.

- UI: **Org preferences → Automations**
- API: `GET/POST /api/automation/rules`, `PATCH/DELETE /api/automation/rules/:id`

**Events:** `ticket.created` | `ticket.updated`  

**Conditions:** `channel`, `subjectContains`, `priority`, `unassigned`  

**Actions:** `setPriority`, `setQueue`, `assignUserId` / `assignUserName`, `notifyUserIds`

Example:

```bash
curl -b cookies.txt -X POST http://127.0.0.1:3000/api/automation/rules \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Billing high",
    "event": "ticket.created",
    "conditions": { "subjectContains": "billing" },
    "actions": { "setPriority": "high" }
  }'
```

Flow: create ticket → AI skill assign → matching rules apply → agent works ticket.

---

## 11. File map

| Path | Role |
|------|------|
| `ui-backend/src/server/orgApiKeys.ts` | API keys |
| `ui-backend/src/server/intake.ts` | Canonical ticket create |
| `ui-backend/src/server/orgWidgets.ts` | Help widgets |
| `ui-backend/public/embed/worktual-help.js` | Embed script |
| `ui-backend/src/server/emailIntake.ts` | Inbound email |
| `ui-backend/src/server/customerMail.ts` | Outbound email |
| `ui-backend/src/server/automation.ts` | Trigger rules engine |
| `ui-backend/src/server/ticketPresence.ts` | Agent collision / viewers |
| `ui-backend/src/server/helpCenter.ts` | Public help center |
| `ui-backend/public/help/` | Help center static UI |
| `ui-backend/src/server/ticketNumbers.ts` | Shared ticket numbers |
| `docs/intake-api.md` | API reference |
| `docs/INTEGRATIONS_README.md` | This guide |
