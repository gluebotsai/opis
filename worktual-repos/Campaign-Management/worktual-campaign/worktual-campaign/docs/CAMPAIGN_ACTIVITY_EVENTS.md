# Campaign activity events (tables, columns, values)

This document is the **product catalog of operational events** across Campaign modules: what each event means, which **existing tables** you read to see that it happened, which **columns** matter, and which **values** the code actually writes.

It is **not** a new `campaign_activity_events` table. Today these moments live as **row state** (campaigns, sessions, batches) plus **JSON** (`payload`, `launch_plan`) and occasional **bell notifications**. Forms / opportunity events (`form.theme_updated`, `form.published`, `form.submission_received`) are **out of scope** here.

**Schemas:** `campaign.*` (Prisma), `cdp.*` and `accounts.*` (Accounts DB pool).  
**Source of truth for campaign tables:** `backend/prisma/schema.prisma` and `docs/CAMPAIGN_DB_ONTOLOGY.md`.

---

## How to read this doc

| Term | Meaning |
|------|--------|
| **Event** | Named operational moment (catalog id). Not a DB enum unless noted. |
| **When it happens** | Tool, API, or worker that causes it. |
| **Tables** | Rows you inspect after the fact. |
| **Columns / values** | Fields and allowed / observed strings. |

Shared ids (logical FKs, not always Postgres FKs):

| Id | Column | Table |
|----|--------|--------|
| Tenant | `organization_id` | almost every campaign row |
| Workspace | `branch_id` | `campaigns`, sessions, recommendations |
| Marketer | `created_by_user_id` / `user_id` | `accounts.setup_users.id` |
| Person (audience) | `contact_id` | `cdp.customer_profile.cdp_id` |
| Draft | `session_id` | `campaign.campaign_agent_sessions.id` |

---

## Shared enums and JSON keys

### `campaign.campaigns.status` (`CampaignStatus`)

| Value | Meaning |
|-------|---------|
| `draft` | Built, not launched |
| `scheduled` | Future send time stored |
| `live` | Sending or running (immediate launch) |
| `completed` | Send finished |
| `cancelled` | Stopped |

### `campaign.campaigns.source_channel` (`SourceChannel`)

| Value | Meaning |
|-------|---------|
| `standalone_campaign` | Campaign SPA |
| `crm_marketing` | CRM embed |

### Channel ids (agents + rows)

Used on `campaign_channels.channel`, `campaign_channel_templates.channel`, `campaign_send_batches.channel`, session `channels[]`:

`email` | `whatsapp` | `sms` | `push` | `web` | `ppc`

SPA aliases: `web` / `web_push` = browser web push; `push` / `app_push` = mobile. Do not store web push as `push`.

### Draft session (`campaign.campaign_agent_sessions`)

| Column | Typical values |
|--------|----------------|
| `module` | `create_campaign` (also other SPA modules) |
| `stage` | default `intake`; also `audience`, `templates`, `launch_plan`, … |
| `payload` | JSON working copy (see below) |

**`payload` keys the create-campaign agent keeps** (`agents/app/session_store.py`):

| Key | Role |
|-----|------|
| `campaign.name` / `goal` / `objective` | Meta |
| `channels` | Selected channel ids |
| `audience.filters` / `matched_count` / `description` | Audience snapshot |
| `templates` | Generated channel creatives (also rows in `campaign_channel_templates`) |
| `launch_plan` | Schedule + orchestration |
| `summary_presented` | Recap already shown |
| `campaign_id` | Set after save/launch |
| `launch_confirmed` | User confirmed launch |
| `messages` / `llm_memory` | Chat |

### `campaigns.launch_plan` / session `launch_plan` (jsonb)

Observed keys after planning / launch:

| Key | Values / notes |
|-----|----------------|
| `schedule_mode` | Create-campaign tool: `now` (immediate) or `at` (named date/time). WhatsApp approved tool also accepts `scheduled`. Sample rows may store `"now"`. |
| `scheduled_at` | UTC ISO instant |
| `launch_channels` | Array of channel ids that send at T0 |
| `launch_local_date` | `YYYY-MM-DD` |
| `launch_local_time` | `HH:mm` |
| `timezone` | IANA; default `Asia/Kolkata` |
| `orchestration_mode` | `prefer_primary` \| `staggered` \| `broadcast` |
| `primary_channel` | One of the channel ids |
| `channel_sequence` | Ordered channel ids |
| `send_strategy` | Nested plan (`mode`, `t0_channels`, `primary_channel`, …) |
| `email_ab` / `ab_enabled` | Email A/B |
| `channel_run.<channel>` | Runtime: `sent`, `failed`, `opens`, `clicks`, `paused` (boolean), `reason`, `paused_at` |
| `ab_winner` | `a` \| `b` after pick |

Campaign table also stores denormalized `launch_local_date`, `launch_local_time`, `timezone`, `starts_at`.

---

## Creation (`create_campaign`)

Tools: `update_campaign_setup`, generate/build templates, audience attach, `present_campaign_summary`. Draft is persisted on `PUT` session → `campaign.campaign_agent_sessions.payload`.

### `campaign.meta_updated`

**What it does:** Saves name, goal, and/or objective on the draft (Campaign overview). Does not launch.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_agent_sessions` | `payload.campaign.name`, `.goal`, `.objective` | Free text; name must not be a person’s name |
| `campaign.campaigns` (after save/launch only) | `name`, `goal`, `objective` | Copied from the session |

### `campaign.channels_set`

**What it does:** Stores the channel list the user confirmed this turn (`channels_confirmed=true`). Never default to email.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_agent_sessions` | `payload.channels` | Array of channel ids |
| `campaign.campaign_channels` (saved campaign) | `channel`, `status` | `channel` = ids above; `status` default `ready` |

May also set `payload.launch_plan.orchestration_mode` (`prefer_primary` / `staggered` / `broadcast`) and `send_strategy`.

### `campaign.templates_generated`

**What it does:** Creates structured creatives for selected channels (gallery / generate / library). Cards appear in chat; fields live in JSON.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_channel_templates` | `session_id`, `channel`, `fields` (jsonb), `generation_batch_id` | `channel` as above; `fields` = subject/html/buttons/etc. |
| `campaign.campaign_agent_sessions` | `payload.templates` | Mirrors templates for the SPA |
| `campaign.campaign_template_messages` | `template_id`, `role`, `kind`, `payload` | Edit-space chat: `role` = `user` \| `assistant` \| `system`; `kind` = `text` \| `template` |
| `campaign.campaign_library_templates` | if using library | `source` = `system` \| `user`; `approval_status` default `approved`; `primary_channel` |

### `campaign.audience_attached`

**What it does:** Freezes who will receive the campaign: CRM/CDP ids, or a session sheet (temp contacts). Count shows on overview.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_audience_refs` | `session_id`, `contact_id` | Draft freeze; `contact_id` = CDP `cdp_id` |
| `campaign.campaign_audience` | `campaign_id`, `contact_id` | Same freeze after campaign save |
| `campaign.campaigns` | `audience_count`, `audience_summary`, `audience_filters` | Count int; filters jsonb |
| `campaign.campaign_session_temp_contacts` | `session_id`, `email`, `phone`, `first_name`, `last_name`, `raw` | Sheet upload, **not** CDP until promoted |
| `cdp.customer_profile` | `cdp_id`, `organization_id`, name/company/city | People in CRM |
| `campaign.campaign_agent_sessions` | `payload.audience.matched_count`, `.filters`, `.description` | Working copy |

### `campaign.recap_built`

**What it does:** One-time recap after templates are approved (`present_campaign_summary`). Sets `summary_presented` and paints the recap panel (`ui_event` type `campaign_summary`). Call before `launch_campaign`.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_agent_sessions` | `payload.summary_presented` | `true` |
| Same session | `payload.campaign.*`, audience count, channels, template ids | Recap copy; not invented |

---

## Launch / scheduling (`launch_campaign`, executor `launch_scheduling`)

Tool: `launch_campaign`. Creates/updates `campaign.campaigns`, channel rows, frozen audience, then workers create batches.

### `campaign.launch_requested`

**What it does:** User confirmed send (`user_confirmed` / `confirmed`). Readiness is checked first. Does not imply the worker has sent yet.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_agent_sessions` | `payload.launch_confirmed`, `payload.launch_plan` | `launch_confirmed` true on success path |
| `campaign.campaigns` | `session_id`, `status`, `launch_plan` | Status set on success: `live` if `schedule_mode=now`, else `scheduled` |

### `campaign.scheduled`

**What it does:** Future send: local date/time (or `scheduled_at`) stored; campaign not sending until due.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaigns` | `status` | `scheduled` |
| Same | `launch_local_date`, `launch_local_time`, `timezone`, `starts_at` | Date `YYYY-MM-DD`, time `HH:mm`, tz IANA |
| Same | `launch_plan.schedule_mode` | `at` (create-campaign) or `scheduled` (WhatsApp approved) |
| `campaign.campaign_send_batches` | `scheduled_for`, `status` | `status` = `queued` until due |

### `campaign.launch_now`

**What it does:** Immediate launch. Campaign goes `live`; batches are due now.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaigns` | `status` | `live` |
| Same | `launch_plan.schedule_mode` | `now` |
| `campaign.campaign_send_batches` | `status`, `scheduled_for` | Typically `queued` then `sending` |

### `campaign.launch_not_ready`

**What it does:** Launch tool returns without writing a live/scheduled campaign. Error code `launch_not_ready` (missing templates, channels, audience, confirm, etc.).

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_agent_sessions` | draft payload unchanged as a saved campaign | `campaigns.status` stays `draft` if a row exists |
| Tool result (not a column) | `error` | `launch_not_ready` |

### `campaign.launch_failed`

**What it does:** Persist or worker path failed after a launch attempt (API 4xx/5xx, provider error). Campaign may stay `draft`/`scheduled` or batches `failed`.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_send_batches` | `status` | `failed` |
| `campaign.campaign_send_recipients` | `status`, `skip_fail_reason` | See worker events below |
| `campaign.campaigns` | `status` | Often still `scheduled` / `live`; `cancelled` if stopped |

---

## On-demand (Hub A2A)

Skills: `on-demand-send`, `create-and-launch`, `create-contact-and-send` (see `agents/app/a2a/hub_ondemand_log.py`). Prepare: `agents/app/agents/on_demand/prepare.py`. Then the same `launch_campaign` path.

**Audit file (not a table):** `/tmp/campaign-hub-ondemand.log`

### `on_demand.request_received`

**What it does:** Hub JSON-RPC hits Campaign A2A with request text, channels, emails/phones/ids.

No dedicated campaign table. Correlate later via new `campaigns` row (`source_channel` usually `standalone_campaign`) and session `payload.hub_mode`.

### `on_demand.prepare_started`

**What it does:** `prepare_on_demand_send` / `analyze_on_demand_request` — parse request, pick channels, resolve identities.

Session payload if a draft is opened; otherwise in-memory Hub task.

### `on_demand.contact_created`

**What it does:** Missing person is written into CDP so send can freeze audience.

| Table | Columns | Values |
|-------|---------|--------|
| `cdp.customer_profile` | `cdp_id`, `organization_id`, `first_name`, `last_name`, `company`, `city`, `custom_fields`, `acquisition_channel` | Campaign inserts use `acquisition_channel` = `campaign` |
| `cdp.identity_keys` | `cdp_id`, `key_type`, `key_value`, `source_system` | `key_type`: `email`, `primary_email`, `phone`, `primary_phone`, `mobile`; `source_system` = `campaign` |

### `on_demand.launch_completed` / `on_demand.launch_failed`

**What it does:** Same persist + worker outcome as launch events; Hub response carries task success/failure.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaigns` | `status` | `live` / `scheduled` vs still `draft` |
| `campaign.campaign_send_batches` | `status` | `queued` → `sent` or `failed` |

---

## Recommendations

Board cards: Campaign SPA + CRM embed.

### `recommendation.created`

**What it does:** Inserts a board card.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_recommendations` | `public_id`, `title`, `status`, `payload` | `public_id` like `rec-…`; `status` allowed: `creating`, `active`, `dismissed`, `used`, `expired`, `deleted` |
| Same | `payload` | Full card JSON (PII arrays stripped on persist) |

### `recommendation.run_started`

**What it does:** User opens a recommendation **run** (create-campaign from the card). Draft session is created/linked; card stays on the board until used.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_agent_sessions` | `module`, `payload` | Create-campaign draft; may copy rec title into `campaign.name` |
| `campaign.campaign_recommendations` | `status` | Often still `active` until applied |

### `recommendation.applied_to_draft`

**What it does:** Card consumed into a campaign draft.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_recommendations` | `status` | `used` |
| `campaign.campaign_agent_sessions` | `payload` | Brief/channels from `payload` |

---

## Template library / content / image

Edit chat and gallery sit on the draft template; library is the catalog; images are reusable assets.

### `template.generated`

Same physical rows as **`campaign.templates_generated`**. Library pick also bumps `campaign_library_templates.used_count`.

### `template.edited`

**What it does:** Operator/agent changes fields in View/edit (copy, layout). Not a regenerate of the whole gallery.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_channel_templates` | `fields`, `updated_at` | Structured JSON per channel |
| `campaign.campaign_template_messages` | `role`, `kind`, `seq`, `payload` | Ordered edit transcript |

### `template.image_generated`

**What it does:** AI or upload image attached to a template / gallery.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_image_gallery_assets` | `media_id`, `image_url`, `source`, `status`, `channel` | `source` = `ai_generated` \| `uploaded` \| `imported`; `status` = `active` \| `archived` |
| `campaign.campaign_gallery_ideas` | `image_url`, `status` | Idea cards: `status` default `active` |
| `campaign.campaign_gallery_jobs` | `job_type`, `status` | `status`: `queued`, `running`, `done`, `failed` |
| Template `fields` jsonb | image URL fields | Copied into `campaign_channel_templates.fields` |

---

## Audience / contacts

Contacts module + create-campaign audience. People live in CDP; Campaign only stores ids (except temp sheet).

### `contact.created`

**What it does:** New CRM person (chat “add contact”, sheet import, on-demand).

| Table | Columns | Values |
|-------|---------|--------|
| `cdp.customer_profile` | see on-demand contact_created | `organization_id` must match tenant |
| `cdp.identity_keys` | `key_type`, `key_value`, `verified`, `source_system` | Unique per org + type + value |

### `audience.sheet_uploaded`

**What it does:** CSV/XLSX attached to **this draft only**.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_session_temp_contacts` | `first_name`, `last_name`, `email`, `phone`, `company_name`, `city`, `raw` | Defaults `""` on empty text; `raw` = extra columns |

### `audience.frozen`

**What it does:** Send list locked for this campaign (save/launch). Not a live CDP query later.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_audience` | `campaign_id`, `contact_id`, `created_at` | Composite PK |
| `campaign.campaigns` | `audience_count` | Integer snapshot |

---

## WhatsApp approved / rejected

Regulated templates (Meta). Create-campaign can still generate WhatsApp **draft** creatives; send requires an approved regulated row.

### `whatsapp.template_submitted`

**What it does:** Template sent to Meta (or saved pending).

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.regulated_channel_templates` | `channel`, `status`, `external_id`, `name`, `body`, `submitted_at` | `channel` = `whatsapp` (or `sms`); `status` = `draft` \| `pending` \| `approved` \| `rejected` \| `paused` \| `disabled` |
| Same | `rejected_reason` | Set when `rejected` |
| `campaign.app_notifications` | `kind`, `source_key` | e.g. `source_key` `template:pending:{id}` |

### `whatsapp.approved_run_started`

**What it does:** Approved-template agent seeds a campaign session and calls `launch_campaign` with `launch_channels: ["whatsapp"]`.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_agent_sessions` | `payload` | WhatsApp-only channels; `launch_plan.schedule_mode` `now` or `scheduled` |
| `campaign.campaigns` | `status` | `live` or `scheduled` |
| `campaign.campaign_channels` | `channel` | `whatsapp` |
| UI | `ui_event.type` | `whatsapp_approved_launched` |

---

## Monitoring / optimization

Recovery executor: stop/pause/resume, A/B winner. Notifications for operators.

### `campaign.paused`

**What it does:** Stop a **channel** (or whole campaign send). Pending recipients skipped when the campaign is cancelled.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_channels` | `status` | `paused` (resume → `ready`) |
| `campaign.campaigns` | `status` | `cancelled` if campaign stopped |
| `campaigns.launch_plan.channel_run.<ch>` | `paused`, `reason`, `paused_at` | `paused` boolean |
| `campaign.campaign_send_recipients` | `status`, `skip_fail_reason` | `skipped` + `campaign_stopped` |
| `campaign.app_notifications` | `source_key` | Pattern `campaign:paused:{id}:{channel}` |

### `campaign.resumed`

**What it does:** Channel send allowed again.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_channels` | `status` | `ready` |
| `launch_plan.channel_run.<ch>.paused` | boolean | `false` |

### `ab.winner_picked`

**What it does:** Email A/B: choose `a` or `b`; remainder send as `winner`. Auto-pick after `ab_decide_after_minutes` or operator `monitor_ab`.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_send_recipients` | `ab_variant` | `a` \| `b` \| `holdout` \| `winner` |
| `campaigns.launch_plan` | `ab_winner`, `email_ab` / `ab_enabled` | Winner letter `a` or `b` |

---

## Backend workers (send lifecycle)

Workers: `email-send-worker.ts`, `push-send-worker.ts`, `whatsapp-send-worker.ts`. Lifecycle: `campaign-send-lifecycle.ts` (`reconcileCampaignSendLifecycle`).

### `batch.queued`

**What it does:** A timed slice is created for a channel; worker may pick it when `scheduled_for` is due.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_send_batches` | `status`, `seq`, `scheduled_for`, `size`, `channel` | `status` default `queued`; unique (`campaign_id`, `channel`, `seq`) |

### `batch.sending`

**What it does:** Worker claimed the batch.

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_send_batches` | `status` | `sending` |

### `batch.sent`

**What it does:** Slice finished (all recipients terminal enough for the worker).

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_send_batches` | `status` | `sent` (also `failed`, `cancelled`) |
| `campaign.campaigns` | `status` | May move `live` → `completed` after reconcile |

### `recipient.sent` / `recipient.failed`

**What it does:** One intended delivery. **KPI fact table.**

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaign_send_recipients` | `status` | default `pending`; also `queued`, `sending`, `sent`, `delivered`, `failed`, `cancelled`, `skipped`, `stub`, `stub_sent`, `bounced`, `hard_bounce`, `soft_bounce` |
| Same | `skip_fail_reason` | e.g. `campaign_stopped`, `missing_email`, `email_suppressed`, `email_template_missing`, `missing_phone`, `missing_destination`, `compliance_denied`, `stub_not_delivered`, `template_<meta_status>`, `email_html_missing_wt_token` |
| Same | `email`, `destination`, `platform`, `provider_message_id`, `attempt_count` | Channel-specific |
| Same | `opened_at`, `clicked_at`, `open_count`, `click_count` | Email engagement |

### `lifecycle.reconciled`

**What it does:** After batch ticks, recompute campaign-level status (still `live` vs `completed`, channel_run counters).

| Table | Columns | Values |
|-------|---------|--------|
| `campaign.campaigns` | `status`, `launch_plan.channel_run` | `completed` when sends done; `cancelled` if stopped |
| `campaign.campaign_send_batches` | `status` | Terminal `sent` / `failed` / `cancelled` |

---

## Quick map: event → primary table

| Event | Primary table |
|-------|----------------|
| `campaign.meta_updated` | `campaign_agent_sessions.payload` → later `campaigns` |
| `campaign.channels_set` | session `channels` → `campaign_channels` |
| `campaign.templates_generated` | `campaign_channel_templates` |
| `campaign.audience_attached` | `campaign_audience_refs` / `campaign_audience` |
| `campaign.recap_built` | session `summary_presented` |
| `campaign.launch_requested` | `campaigns` + `launch_plan` |
| `campaign.scheduled` | `campaigns.status=scheduled` |
| `campaign.launch_now` | `campaigns.status=live` |
| `campaign.launch_not_ready` | tool error; no live row |
| `campaign.launch_failed` | batches/recipients `failed` |
| `on_demand.*` | Hub log + same campaign/CDP/send tables |
| `recommendation.*` | `campaign_recommendations` |
| `template.edited` | `campaign_channel_templates.fields` |
| `template.image_generated` | `campaign_image_gallery_assets` |
| `contact.created` | `cdp.customer_profile` + `identity_keys` |
| `audience.sheet_uploaded` | `campaign_session_temp_contacts` |
| `audience.frozen` | `campaign_audience` |
| `whatsapp.template_submitted` | `regulated_channel_templates` |
| `whatsapp.approved_run_started` | `campaigns` + WhatsApp channel |
| `campaign.paused` / `resumed` | `campaign_channels.status` |
| `ab.winner_picked` | `campaign_send_recipients.ab_variant` |
| `batch.*` / `recipient.*` / `lifecycle.reconciled` | `campaign_send_batches` / `campaign_send_recipients` / `campaigns` |

---

## Related docs

- `docs/CAMPAIGN_DB_ONTOLOGY.md` — full column catalog  
- `docs/CAMPAIGN_DATABASE_SCHEMA.md` — `launch_plan` jsonb notes  
- `docs/CAMPAIGN_AGENTS_ONTOLOGY.md` — MAS domains / tools  
- `docs/MAS_ARCHITECTURE.md` — `launch_scheduling`, `on_demand` routing  
- Create-campaign tools: `agents/app/agents/create_campaign/tools.py`  
- Prisma: `backend/prisma/schema.prisma`
