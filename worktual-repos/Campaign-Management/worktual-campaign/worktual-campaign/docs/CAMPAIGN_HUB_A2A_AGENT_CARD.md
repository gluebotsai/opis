# Campaign → Hub A2A agent card reference

Handoff for Hub teams registering and invoking the **Worktual Campaign** spoke. Skills and contracts are defined in `agents/app/a2a/catalog.py`.

**Production (Docker, Hub IP registration):**  
`http://82.113.92.49:8080/a2a/.well-known/agent-card.json`  
(`A2A_PUBLIC_URL=http://82.113.92.49:8080/a2a` in `agents/.env`).  
Deploy steps: [CAMPAIGN_HUB_GO_LIVE.md](./CAMPAIGN_HUB_GO_LIVE.md).

**Local dev:** standalone uvicorn on port **8040** (see `agents/app/a2a_main.py`).

---

## Discovery and transport

| Item | Value |
|------|--------|
| Spoke id | `worktual-campaign` (from `A2A_SERVER_NAME`) |
| Public agent card | `GET /.well-known/agent-card.json` |
| Extended card (Bearer) | `GET /a2a/agent-card/extended` |
| JSON-RPC invoke | `POST /` method `message/send` |
| OAuth token | `POST /token` (`client_credentials`) |
| Protocol | A2A **1.0**, transport **JSONRPC** |
| Catalog version | **1.0.0** |
| Contract version | **1.0** |
| Execution | **Sequential** pipelines only; **no clarification** loop |
| `skillVersion` | 16-char hash of published skill ids — Hub JWT must match; stale token → error **-32010** |

Contract documents (relative to A2A base URL):

- Envelope: `/a2a/contracts/worktual-envelope.v1.json`
- Skill result: `/a2a/contracts/skill-result.v1.json`
- Per-skill args: `/a2a/contracts/skills/{skillId}.v1.json`

---

## Hub message envelope (required)

Every `message/send` data part should include:

| Field | Required | Notes |
|-------|----------|--------|
| `source` | Yes | Must be `"hub"` |
| `organizationId` | Yes | Tenant org id |
| `skillId` | Yes | One of the skill ids below (kebab-case) |
| `campaignToken` | Optional | Campaign API JWT; if omitted, spoke may mint from `organizationId` when DB/JWT config is present |
| `arguments` | Optional | Preferred wrapper for skill-specific fields; flat fields in the same object are also accepted |

---

## OAuth scopes (client credentials)

Scopes appear on each skill’s `security`; token URL is on the card.

| Scope | Description |
|-------|-------------|
| `campaign.on_demand.execute` | Create and launch on-demand campaigns |
| `campaign.contact.write` | Create contacts |
| `campaign.monitoring.read` | Read campaign reports |
| `campaign.monitoring.write` | Stop / resume channels or stop campaigns |
| `campaign.whatsapp.send` | Send approved WhatsApp templates |
| `campaign.image.generate` | Generate campaign images |

---

## Published skills (10)

All skills use output schema `/a2a/contracts/skill-result.v1.json`.  
Hub-facing id → internal intent (for logging only):

| skillId | Intent | Risk | OAuth scope(s) | Orchestration (internal) |
|---------|--------|------|----------------|---------------------------|
| `on-demand-send` | `on_demand_send` | high_impact | `campaign.on_demand.execute` | `on_demand` |
| `create-contact` | `create_contact` | reversible_write | `campaign.contact.write` | `contacts` |
| `campaign-report` | `campaign_report` | read | `campaign.monitoring.read` | `monitoring` |
| `stop-channel` | `stop_channel` | high_impact | `campaign.monitoring.write` | `monitoring` |
| `resume-channel` | `resume_channel` | high_impact | `campaign.monitoring.write` | `monitoring` |
| `stop-campaign` | `stop_campaign` | high_impact | `campaign.monitoring.write` | `monitoring` |
| `create-contact-and-send` | `create_contact_and_send` | high_impact | `campaign.contact.write`, `campaign.on_demand.execute` | `contacts` → `on_demand` |
| `send-approved-whatsapp` | `send_approved_whatsapp` | high_impact | `campaign.whatsapp.send` | `whatsapp_send` |
| `generate-image` | `generate_image` | reversible_write | `campaign.image.generate` | `image_gen` |
| `temp-audience-and-send` | `temp_audience_and_send` | high_impact | `campaign.on_demand.execute` | `temp_audience_send` |

---

### 1. `on-demand-send`

**Purpose:** Create campaign from Hub brief, generate templates, launch automatically (no chat).

**Required arguments (JSON schema):** None.

**Required in practice:** Audience — `email` / `emails` and usually `cdpId` or `contact_ids` / `customer_ids` for email sends.

**Strongly recommended:** `request_text` — full operator brief (trigger, facts, subject/body guidance). Hub may also send the same text as `instruction` (optional alias mapped to `request_text`).

**Common arguments:** `request_text`, `instruction`, `channels` (email, whatsapp, web, push, sms, app_push), `cdpId` / `contact_ids` / `customer_ids`, `emails`, `phones`, `name`, `goal`, `objective`.

**Examples (from card):** Email a contact about a product; send WhatsApp + email to CDP ids.

---

### 2. `create-contact`

**Purpose:** Create CDP/campaign contact from structured fields.

**Required:** `first_name` and **either** `email` **or** `phone`.

**Optional:** `last_name`, `company_name`, `city`.

---

### 3. `campaign-report`

**Purpose:** Campaign performance / status for a campaign.

**Required:** `campaign_id`.

**Optional:** `action` (defaults to report).

---

### 4. `stop-channel`

**Purpose:** Pause one channel on a live campaign.

**Required:** `campaign_id`, `channel`, `reason`.

**Channels:** email, whatsapp, web, push, sms, app_push.

---

### 5. `resume-channel`

**Purpose:** Resume a paused channel.

**Required:** `campaign_id`, `channel`.

---

### 6. `stop-campaign`

**Purpose:** Stop entire campaign.

**Required:** `campaign_id`, `reason`.

---

### 7. `create-contact-and-send`

**Purpose:** Composite — create contact, then on-demand create + launch for that contact.

**Required:** Same as create-contact (`first_name` + email or phone).

**Optional:** All on-demand fields (`request_text`, `channels`, audience fields, etc.).

---

### 8. `send-approved-whatsapp`

**Purpose:** Send a **Meta-approved** WhatsApp template (no template edit/resubmit).

**Required:** None in schema; provide audience + send intent in practice.

**Optional:** `request_text`, `template_id`, `template_name`, `phones`, `contact_ids`, `user_confirmed` (default treated as true from Hub).

**Note for Hub:** Routing is on the card; reliable execution depends on Campaign MAS/content config and executor session setup (coordinate with Campaign team for production).

---

### 9. `generate-image`

**Purpose:** Generate a campaign image from a text prompt (enhance → generate).

**Required:** `prompt`.

**Optional:** `request_text`, `campaign_id`, `attach_to_template`.

**Note for Hub:** Requires `image` MAS domain, Gemini image config, and a hub `session_id` until Campaign adds auto session minting — confirm with Campaign before production use.

---

### 10. `temp-audience-and-send`

**Purpose:** Inline contact **rows** (sheet-style), then on-demand create + launch for that audience.

**Required:** `rows` — array of objects with at least `email` or `phone` per row (also supports `firstName`/`first_name`, etc.).

**Optional:** Same as on-demand (`request_text`, `channels`, `name`, `goal`, `objective`, …).

**Behavior:** Rows are normalized to `emails` / `phones` for launch (not a separate temp-sheet API from Hub).

---

## Capabilities not on the card

These are **explicitly excluded** from Hub delegation (UI / chat-only):

- `navigate`
- `chat_clarify`
- `stage_campaign_draft`
- `template_library_browse`
- `ui_preview_only`
- `form_builder_ui`

---

## Response shape

Successful invoke returns JSON-RPC artifacts including **`campaign-receipt`** with:

- `ok`, `skillId`, `organizationId`, `status` (completed | partial | failed)
- `pipeline`, `result`, `step_results`, `warnings`, `errors`

Full schema: `/a2a/contracts/skill-result.v1.json`.

---

## Quick checklist for Hub integrators

1. Fetch `/.well-known/agent-card.json` and register spoke URL + `skillVersion`.
2. Obtain OAuth token with scopes needed for target skills.
3. Send `message/send` with `source: hub`, `organizationId`, `skillId`, and skill arguments (or `arguments` object).
4. Refresh Hub JWT when Campaign adds/removes skills (card `skillVersion` changes).
5. For monitoring skills, always pass `campaign_id` (and channel/reason where required).

---

## Source of truth in repo

| What | Path |
|------|------|
| Skill list + intents | `agents/app/a2a/catalog.py` |
| JSON Schemas | `agents/app/a2a/contracts.py` |
| Card builder | `agents/app/a2a/card.py` |
| Hub dispatch | `agents/app/a2a/dispatch.py` |
| Hub Super pipelines | `agents/app/hub_super/skill_catalog.py` |

When in doubt, re-fetch the live card from the deployed A2A server — it always reflects the current catalog.
