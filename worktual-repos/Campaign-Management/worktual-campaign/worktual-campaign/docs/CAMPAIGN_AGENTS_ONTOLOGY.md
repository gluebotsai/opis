# Campaign MAS agents — purpose, skills, tools, ontology

This document covers the **current MAS catalog only** (`agents/app/mas/catalog.py` + `agents/app/sft_catalog/registry.py`):

- 1 Super agent
- 9 Domain agents
- Executors listed under those domains

Socket-only coordinators that are **not** in this catalog (legacy Reports Graph runner, Hub Super, Contact SQL writer, channel template Python packages) are out of scope here, except where an executor still calls the same tools.

**Ontology** here means: the product **entities** in `CAMPAIGN_DB_ONTOLOGY.md`. For each agent we say **which entities it should look up** when it needs facts (via `ask_ontology` where that tool exists, or via its own tools/SQL later). Ontology is **not** a substitute for live KPI math; rates and volumes belong to the analytics/SQL path.

---

## How routing works (short)

```text
User turn
  → campaign_super  (tool: route_to_domain)
    → one Domain Agent  (tool: invoke_executor)
      → one Executor  (allowlisted product tools)
```

Skills are **playbooks** under `agents/app/mas/skills/`. Super does not load skills. Domain + executor harness pick a `skill_id` and restrict tools.

---

# Super

## `campaign_super` — Campaign Super Agent

**Purpose:** Single interactive entry router. Understand intent and send the turn to **exactly one domain**. Do not collect campaign fields or call delivery APIs.

**Responsibilities:**

- Read user query, chat memory, `active_domain`, current datetime
- Choose: `audience` | `creation` | `recommendation_run` | `library_run` | `whatsapp_approved_run` | `content` | `image` | `optimization` | `forms`
- Call `route_to_domain` with `domain_id` and the user’s **verbatim** message
- Present the executor’s reply; do not dump tools
- Sticky follow-ups stay in the same domain when the topic has not changed
- Map SPA surfaces: create-campaign → `creation`; recommendation **board** → `creation`; selected recommendation **run** → `recommendation_run`; Template Library “Use template” → `library_run`; approved WhatsApp run → `whatsapp_approved_run`

**Capabilities:** Routing and restating only. No business writes.

**Skills:** None at Super. Skills live on domains/executors.

**Tools:** `route_to_domain`

**Ontology — when / which entities:** Super should **not** call ontology. It only needs enough entity language to pick a domain (Campaign vs Contact vs Template vs Report vs Form vs Image). If the user asks “what campaigns like this did we run?”, route to **optimization** (analytics / `ask_ontology`), not Super lookup.

---

# Domain agents

Domain agents invoke executors. They do not own MCP product tools except `invoke_executor` (and domain handoff where wired).

## `audience` — Audience Domain

**Purpose:** Contacts, segments, audience pull, consent — including informal “add a person” requests.

**Responsibilities:** Pick `contact`, `audience_selection`, or `audience_pull`. Own Contact Setup conversation. Do not build campaign templates.

**Capabilities:** Create/update/view contacts; bulk/sheet; search; freeze lists.

**Skills (module `contacts`):** `contact_creation`, `contact_update`, `contact_view`

**Tools (domain layer):** `invoke_executor`

**Ontology:** Contact, Identity key, Industry pack, Temporary contact. Ask ontology for “have we messaged this kind of person / segment before?” only after routing to optimization if it is a **past-campaign graph** question. For live CRM lists, executors query CDP — not ontology.

---

## `creation` — Creation Domain

**Purpose:** Cold-start create-campaign journey: meta → channels → generate → audience (if needed) → launch. Also recommendations **board**.

**Responsibilities:** Enforce conversational gates using chat + Live session facts. After templates exist, send copy/layout edits to View/edit (content), not regenerate in main chat unless the user asks to rebuild.

**Capabilities:** Save brief, generate channel templates, attach audience, schedule/launch, recommendation cards.

**Skills (module `create_campaign`):** `campaign_brief`, `campaign_audience`, `campaign_templates`, `campaign_launch`

**Tools:** `invoke_executor`

**Ontology:** Campaign, Channel, Channel template, Audience, Contact, Recommendation, Library template (as inspiration). Ontology calls belong on **optimization** if the user asks “did we already run a webinar invite?”. Creation should not invent past-campaign history.

---

## `recommendation_run` — Recommendation Run Domain

**Purpose:** Run a **selected** recommendation card (prefilled panel). Shared creation executors; not the board itself.

**Responsibilities:** Same gates as creation but starting from the card payload. Do not wander into library or WhatsApp-approved-only flows.

**Capabilities:** Brief alignment, audience, content build, launch.

**Skills:** Uses creation-style executors (`brief_validation`, `campaign_audience`, `campaign_content`, `launch_scheduling`) with recommendation-run session context.

**Tools:** `invoke_executor`

**Ontology:** Recommendation, Campaign (past similar ideas), Channel, Audience. Graph questions (“what similar recs converted?”) → optimization / ontology. This domain executes the card.

---

## `library_run` — Library Run Domain

**Purpose:** Create a campaign from Template Library selection(s) (creative baseline).

**Responsibilities:** Align brief to library creative; adopt/adapt templates; audience; launch. Isolated skill prompts from cold-start create.

**Capabilities:** Same executor set as creation, different playbooks.

**Skills (module `library_run`):** `library_brief`, `library_audience`, `library_templates`, `library_launch`

**Tools:** `invoke_executor`

**Ontology:** Library template, Campaign, Channel template, Audience. Ontology: “which library themes has this org used?” / past campaigns of the same seed — via optimization. This domain **uses** the template row, it does not query the knowledge graph itself.

---

## `whatsapp_approved_run` — WhatsApp Approved Run Domain

**Purpose:** Send or schedule a **Meta-approved** WhatsApp template (fixed copy). Audience → send/launch. Not content rewrite.

**Responsibilities:** Confirm approved template; collect audience; send now or launch into monitoring. Do not treat this as free-form WhatsApp generation (`whatsapp_content`).

**Capabilities:** Filter/set audience, temp CSV, `SEND_APPROVED_TEMPLATE`, `LAUNCH_APPROVED_CAMPAIGN`.

**Skills (module `whatsapp_approved`):** `approved_run_brief`, `approved_audience`, `approved_launch`

**Tools:** `invoke_executor`

**Ontology:** Regulated template, Campaign, Audience, Contact, Send batch/recipient (after send). Ontology: past WhatsApp campaigns / template names. Live approval status comes from `regulated_channel_templates`, not ontology.

---

## `content` — Content Domain

**Purpose:** Channel creatives outside the main create playbook: generate/edit by channel, verification, template coach, WhatsApp **rejected** fix, approved-send executor when invoked from content.

**Responsibilities:** Coach and compliance; WhatsApp rejected resubmit; per-channel content executors. Do not steal create-campaign `build_campaign` from Creation when the SPA is create-campaign.

**Capabilities:** WhatsApp/email/app-push/web-push copy; verification; coach; approved send tools.

**Skills:** Template-edit skills (`edit_copy`, `edit_theme`, `edit_layout`, `edit_hero_image`, `edit_footer_links`, `redesign_template`, `launch_handoff`) plus WhatsApp approved skills when that executor is used from content.

**Tools:** `invoke_executor`

**Ontology:** Channel template, Library template, Regulated template, Campaign, Image asset. Ontology: “what tone/layout did we use for email webinar last time?”. Live HTML is in `campaign_channel_templates.fields`, not ontology.

---

## `image` — Image Domain

**Purpose:** Generate, refine, attach campaign/template images.

**Responsibilities:** Prompt enhance, generate, refine, attach to template fields, optional multi-channel image pipeline.

**Capabilities:** Image gallery alignment; attach URLs into template `fields`.

**Skills:** Driven by image executors (no separate `mas/skills/image` pack listed in catalog). Playbooks live in executor `agent.md`.

**Tools:** `invoke_executor`

**Ontology:** Image gallery asset, Channel template, Campaign, Gallery idea. Ontology: past hero styles / reuse tags. Binary/URL truth is `campaign_image_gallery_assets`.

---

## `optimization` — Optimization Domain

**Purpose:** Monitoring, analytics, recovery, events reports.

**Responsibilities:** Route to `monitoring`, `analytics`, or `recovery`. KPI questions vs ontology/graph vs stop/resume vs A/B winner.

**Capabilities:** Lists, one-campaign reports, KPI query, ontology, events, pause/resume, pick A/B winner.

**Skills:** `monitor_*` (monitoring module), `report_*` + `events_report` (reports module)

**Tools:** `invoke_executor`

**Ontology (this is the domain that should call ontology):** Campaign, Channel, Audience, Send, Contact engagement, Opportunity/Event, Recommendation (as past ideas). **KPI rates/volumes → analytics SQL path. Themes / “have we run this idea” / relationships → `ask_ontology`.**

---

## `forms` — Forms Domain

**Purpose:** Public form/event builders: theme, fields, full design.

**Responsibilities:** Pick `form_theme`, `form_fields`, or `form_design`. Persist opportunity payload.

**Capabilities:** Theme/fields/design specialists.

**Skills:** Form specialist prompts on executors (no reports-style skill pack).

**Tools:** `invoke_executor`

**Ontology:** Opportunity/event, Form submission, Contact (if answers create people later), Campaign (if form is used as CTA). Ontology: past form patterns. Live schema is `campaign_opportunity_events.payload`.

---

# Executors

Allowlists: `agents/app/mas/runtime/tool_adapters.py`. If a tool is not listed, the executor must not call it.

Ontology column: **entities to resolve** when the user asks a knowledge/history question. Only `analytics` has `ask_ontology` today; others should **handoff to optimization** or say they cannot graph-query.

---

## Audience executors

### `contact` — Contact Executor

**Purpose:** Create, update, view, and company-pack operations on **one or many CRM contacts**.

**Responsibilities:** Existence checks before create; find before update; view/search matching the request; industry pack field/rule edits.

**Capabilities:** Single + bulk create/update; detail fetch; pack CRUD.

**Skills:** `contact_creation`, `contact_update`, `contact_view`

**Tools:** `VIEW_CONTACT`, `QUERY_CONTACTS`, `LOOKUP_CONTACT`, `GET_CONTACT`, `GET_CONTACT_DETAIL`, `CONTACT_VIEW_AND_DOWNLOAD`, `SEARCH_CONTACTS`, `SET_DRAFT_FIELDS`, `VERIFY_FOCUS_IDENTITY`, `CREATE_CONTACT`, `CREATE_SINGLE_CONTACT`, `UPDATE_CONTACT`, `UPDATE_SINGLE_CONTACT`, `GET_COMPANY_PACK`, `ADD_COMPANY_RULE`, `UPDATE_COMPANY_RULE`, `DELETE_COMPANY_RULE`, `UPSERT_PACK_FIELD`, `CONFIRM_PACK_FIELD`, `DELETE_PACK_FIELD`, `ROUTE_TO_MODULE`  
(Skills further subset these. Bulk create/update sit on `audience_selection`.)

**Ontology:** Contact, Identity key, Industry pack. Do **not** use ontology to list live contacts — use CDP tools / future SQL agent. Ontology only if user asks historical “what segments converted”.

---

### `audience_selection` — Audience Selection Executor

**Purpose:** Segments, filters, assignment, temporary/bulk uploads.

**Responsibilities:** Search and import at list scale; bulk create/update; import contacts.

**Capabilities:** Sheet/bulk identity work for Audience module.

**Skills:** Used from contacts/audience flows (bulk tools). No dedicated skill_id in `contacts/__init__.py`; tools are allowlisted here.

**Tools:** `SEARCH_CONTACTS`, `LOOKUP_CONTACT`, `CONTACT_VIEW_AND_DOWNLOAD`, `CREATE_BULK_CONTACT`, `UPDATE_BULK_CONTACT`, `IMPORT_CONTACTS`, `ROUTE_TO_MODULE`

**Ontology:** Contact, Temporary contact, Audience (draft refs). Graph: past segment definitions — via analytics. Live filters: CDP/`QUERY_CONTACTS`.

---

### `audience_pull` — Audience Pull / SQL Executor

**Purpose:** Materialize and freeze audience lists (pull matching people).

**Responsibilities:** Search/lookup/import for freeze; this is the MAS home for “SQL-ish” audience materialization. Today it still uses contact tools, not the reporting SQL agent.

**Capabilities:** Produce a concrete id list for a campaign or audience panel.

**Skills:** None registered as a named skill_id; executor allowlist only.

**Tools:** `SEARCH_CONTACTS`, `LOOKUP_CONTACT`, `CONTACT_VIEW_AND_DOWNLOAD`, `IMPORT_CONTACTS`

**Ontology:** Audience, Contact, Campaign (when freezing for a campaign). Future SQL agent may replace ad-hoc pull. Ontology does not freeze lists.

---

## Creation-family executors

(Shared by `creation`, `recommendation_run`, `library_run` with different skills.)

### `brief_validation` — Campaign Brief Validation Executor

**Purpose:** Validate and persist campaign overview (name, goal, objective, channels, image-plan intent).

**Responsibilities:** `update_campaign_setup`; suggest names; plan/confirm images; email A/B flag on create skill (skill may include `set_email_ab` even if adapter list is narrower — follow skill tools when harness merges them).

**Capabilities:** Write session/campaign meta. Does not generate full templates.

**Skills:** `campaign_brief`, `library_brief` (+ recommendation_run equivalent)

**Tools (adapter):** `update_campaign_setup`, `suggest_campaign_names`, `plan_campaign_images`, `confirm_chat_images`

**Ontology:** Campaign, Channel, Organization (industry), Recommendation/Library (if prefilled). Past naming/themes → optimization ontology. This executor writes the **current** brief.

---

### `campaign_audience` — Campaign Audience Executor

**Purpose:** Named recipients for **this** campaign: match, create, update, temp sheet.

**Responsibilities:** `check_contacts` then create/update/upload. Do not generate templates.

**Capabilities:** Bind CDP ids or temp rows to the draft.

**Skills:** `campaign_audience`, `library_audience`

**Tools:** `check_contacts`, `create_contact`, `upload_temporary_contacts`, `update_contact`, `confirm_chat_images`

**Ontology:** Contact, Identity, Temporary contact, Audience, Campaign. Live match = CDP tools. “Who usually gets webinar invites?” → ontology/analytics, then still freeze with tools.

---

### `campaign_content` — Campaign Content Executor

**Purpose:** Generate/persist channel templates via `build_campaign`.

**Responsibilities:** Build or regenerate templates for selected channels; optional image plan / A/B when skill includes it.

**Capabilities:** Writes `campaign_channel_templates`.

**Skills:** `campaign_templates`, `library_templates`

**Tools:** `build_campaign`, `plan_campaign_images`, `confirm_chat_images`

**Ontology:** Channel template, Library template, Campaign, Image. Ontology for “what did last webinar email look like?”; generation still calls `build_campaign`.

---

### `recommendation` — Campaign Recommendation Executor

**Purpose:** Past campaigns and recommendation **board** (create/update cards), using a wide tool set.

**Responsibilities:** Board payload in `campaign_recommendations`; may also drive setup/build/launch when the board flow requires it.

**Capabilities:** Overlapping create tools for recommendation cards.

**Skills:** Not in create_campaign 1:1 map; board surface uses this executor.

**Tools:** `update_campaign_setup`, `check_contacts`, `create_contact`, `upload_temporary_contacts`, `update_contact`, `build_campaign`, `launch_campaign`, `plan_campaign_images`, `confirm_chat_images`

**Ontology:** **Primary ontology consumer among creation executors in spirit** — Recommendation, Campaign (past), Channel, Audience. Prefer handoff to `analytics.ask_ontology` for graph facts; this executor persists **cards**.

---

### `launch_scheduling` — Launch and Scheduling Executor

**Purpose:** Schedule, launch, on-demand send after explicit confirm.

**Responsibilities:** `launch_campaign` only (adapter). Create skill may also pass `set_email_ab` via harness.

**Capabilities:** Writes campaign status, launch timestamps, enqueue batches.

**Skills:** `campaign_launch`, `library_launch`

**Tools:** `launch_campaign`

**Ontology:** Campaign, Channel, Send batch, Sending configuration (caps/readiness). Ontology does not launch. Config truth is email/push/SMS tables.

---

## Content executors

### `whatsapp_content` — WhatsApp Content Executor

**Purpose:** Generate WhatsApp templates (not Meta-approved send).

**Responsibilities:** Channel copy for WhatsApp in content/create pipelines (shared channel content runner).

**Capabilities:** WhatsApp fields on session templates; may feed regulated submit elsewhere.

**Skills:** Template-edit / content generate playbooks as wired.

**Tools:** Shared channel-content path (not a separate row in `EXECUTOR_TOOL_ALLOWLIST`; uses content runtime). Treat as generate/edit WhatsApp `fields`.

**Ontology:** Channel template, Regulated template, Campaign.

---

### `email_content` — Email Content Executor

**Purpose:** Generate email templates (subject, HTML, CTA).

**Skills / tools:** Same pattern as other channel content executors (generate/edit email fields).

**Ontology:** Channel template, Library template, Image, Campaign, Email sender/domain (footer/compliance facts from config tables, not ontology).

---

### `app_push_content` — App Push Content Executor

**Purpose:** Generate app push copy (title/body/deeplink).

**Ontology:** Channel template, Push endpoint (reachability is SQL/config, not ontology), Campaign.

---

### `web_push_content` — Web Push Content Executor

**Purpose:** Generate web push copy.

**Ontology:** Channel template, Website visitor / web subscription, Campaign.

---

### `content_verification` — Content Verification Executor

**Purpose:** Verify content; WhatsApp **rejected** fix/resubmit; compliance.

**Responsibilities:** Update fields and submit for approval.

**Skills:** WhatsApp rejected / verification playbooks.

**Tools:** `SET_TEMPLATE_FIELDS`, `SUBMIT_FOR_APPROVAL`

**Ontology:** Regulated template, Channel template, Campaign. Approval status is DB (`regulated_channel_templates.status`), not ontology.

---

### `template_coach` — Template Coach Executor

**Purpose:** Manual-edit AI assist (View/edit).

**Skills:** `edit_copy`, `edit_theme`, `edit_layout`, `edit_hero_image`, `edit_footer_links`, `redesign_template`, `launch_handoff`

**Tools (skills):** `apply_template_changes`, `show_current_template`, `save_template`, `set_email_theme`, plus layout/footer/hero tools as registered, `handoff_campaign_launch`

**Ontology:** Channel template, Image, Campaign. Coach edits live JSON; ontology only for “how we usually style this”.

---

### `whatsapp_approved_send` — WhatsApp Approved Send Executor

**Purpose:** Send already Meta-approved templates.

**Skills:** `approved_run_brief`, `approved_audience`, `approved_launch`

**Tools:** `SET_AUDIENCE`, `FILTER_CONTACTS`, `UPLOAD_TEMPORARY_CONTACTS`, `SEND_APPROVED_TEMPLATE`, `LAUNCH_APPROVED_CAMPAIGN`

**Ontology:** Regulated template, Audience, Contact, Campaign, Send recipient.

---

## Image executors

### `image_generate` — Image Generate Executor

**Purpose:** Enhance prompt then generate campaign images.

**Tools:** `ENHANCE_IMAGE_PROMPT`, `GENERATE_IMAGE`, `GET_LAST_IMAGE`

**Ontology:** Image asset, Campaign, Channel template, Gallery idea.

---

### `image_refine` — Image Refine Executor

**Purpose:** Enhance edit brief then refine an existing image.

**Tools:** `ENHANCE_IMAGE_PROMPT`, `REFINE_IMAGE`, `GET_LAST_IMAGE`

**Ontology:** Image asset (existing URL), Channel template.

---

### `image_attach` — Image Attach Executor

**Purpose:** Attach generated image URL to template fields.

**Tools:** `GET_LAST_IMAGE`, `ATTACH_IMAGE`

**Ontology:** Image asset, Channel template.

---

### `campaign_images` — Campaign Images Executor

**Purpose:** Plan, batch-generate, and attach images across channels (shared or per-channel).

**Tools:** `PLAN_CAMPAIGN_IMAGES`, `GENERATE_CAMPAIGN_IMAGES`, `ATTACH_CAMPAIGN_IMAGES`, `RUN_CAMPAIGN_IMAGE_PIPELINE`, `GET_LAST_IMAGE`, `CONFIRM_CHAT_IMAGES`, `confirm_chat_images`

**Ontology:** Campaign, Channel, Image asset, Channel template.

---

## Optimization executors

### `monitoring` — Campaign Monitoring Executor

**Purpose:** Lists, one-campaign reports, audience outcomes (who was sent / missed).

**Skills:** `monitor_list`, `monitor_report`

**Tools:** `LIST_MONITOR_CAMPAIGNS`, `GET_CAMPAIGN_REPORT`, `GET_CAMPAIGN_AUDIENCE`, `ROUTE_TO_MODULE`

**Ontology:** Campaign, Channel, Send recipient, Audience. **Do not** use ontology for live KPI numbers. Lists/reports are API/SQL. Ontology if user asks “which of these are similar to last Diwali push?”.

---

### `analytics` — Campaign Analytics Executor

**Purpose:** KPI analytics, **ontology**, events report. This is the MAS agent that **calls ontology**.

**Skills:**

| Skill | When | Tools |
|-------|------|--------|
| `report_kpis` | Rates, volumes, period totals | `query_analytics`, `ask_semantic_layer`, `ROUTE_TO_MODULE` |
| `report_ontology` | Themes, past-campaign graph, relationships | `ask_ontology`, `ROUTE_TO_MODULE` |
| `report_campaigns` | Named lists / one campaign from dashboard chat | `LIST_MONITOR_CAMPAIGNS`, `GET_CAMPAIGN_REPORT`, `GET_CAMPAIGN_AUDIENCE`, `ROUTE_TO_MODULE` |
| `events_report` | Forms/events list and detail | `LIST_EVENTS`, `GET_EVENT_DETAIL`, `ROUTE_TO_MODULE` |

**Tools (full allowlist):** `ask_ontology`, `query_analytics`, `ask_semantic_layer`, `LIST_MONITOR_CAMPAIGNS`, `GET_CAMPAIGN_REPORT`, `GET_CAMPAIGN_AUDIENCE`, `LIST_EVENTS`, `GET_EVENT_DETAIL`, `ROUTE_TO_MODULE`

**Ontology — required usage:**

Call `ask_ontology` when the user wants **knowledge-graph / past-analyst** answers, including:

| Entity | Example questions ontology should answer |
|--------|------------------------------------------|
| Campaign | What campaigns of this type ran before? Related goals? |
| Channel | Which channels were used for that idea? |
| Audience / Contact | What kinds of people were targeted (themes, not a live SQL list)? |
| Channel template / Library template | Similar creative themes |
| Recommendation | Ideas already suggested or run |
| Opportunity / Form | Past events/forms on the same topic |
| Send / engagement | Qualitative “what worked” stories — **not** open-rate math |

Never invent graph facts. Never use ontology for Dashboard open/click **percentages** (use `query_analytics` / SQL agent).

---

### `recovery` — Channel Delivery Recovery Executor

**Purpose:** Stop/pause/resume sends; pick email A/B winner and send holdout.

**Skills:** `monitor_recovery`, `monitor_ab`

**Tools:** `STOP_CAMPAIGN`, `STOP_CHANNEL`, `RESUME_CHANNEL`, `PICK_AB_WINNER`, `ROUTE_TO_MODULE`

**Ontology:** Campaign, Channel, Send batch, Send recipient (`ab_variant`). Ontology does not stop sends. A/B winner should be based on live recipient metrics (SQL/API).

---

## Forms executors

### `form_theme` — Form Theme Executor

**Purpose:** Form theme specialist.

**Tools:** `RUN_THEME_SPECIALIST`, `UPDATE_FORM_THEME`

**Ontology:** Opportunity/event (payload.theme).

---

### `form_fields` — Form Fields Executor

**Purpose:** Form fields specialist.

**Tools:** `RUN_FIELDS_SPECIALIST`, `UPDATE_FORM_FIELDS`

**Ontology:** Opportunity/event (field schema), Form submission (what was collected before — graph), Contact (mapping fields to people).

---

### `form_design` — Form Design Executor

**Purpose:** Full form design specialist.

**Tools:** `RUN_DESIGN_SPECIALIST`, `APPLY_FORM_DESIGN`

**Ontology:** Opportunity/event, Image (if form uses gallery), Campaign (if used as landing).

---

# Ontology call matrix (summary)

| Agent | May call `ask_ontology` today? | Should resolve these entities | Notes |
|-------|--------------------------------|-------------------------------|--------|
| `campaign_super` | No | Domain nouns only | Route only |
| Domain agents | No | Same as their executors | `invoke_executor` |
| `analytics` | **Yes** | Campaign, Channel, Audience, Template, Recommendation, Event, qualitative Send | Skill `report_ontology` |
| `monitoring` | No | Campaign, Send, Audience | Use list/report tools; handoff graph to analytics |
| `recommendation` | No | Recommendation, Campaign | Handoff graph to analytics |
| `audience_pull` / `contact` | No | Contact, Identity | Live data = CDP; future SQL agent |
| All content/image/forms/launch | No | Their local entities | Handoff history questions to optimization |

---

# Related files

| File | Use |
|------|-----|
| `agents/app/mas/catalog.py` | Domain/executor ids |
| `agents/app/mas/runtime/tool_adapters.py` | Tool allowlists |
| `agents/app/mas/skills/` | Skill prompts |
| `docs/CAMPAIGN_DB_ONTOLOGY.md` | Entity and table definitions |
| `docs/CAMPAIGN_METRICS_SQL_AGENT.md` | Metrics the SQL agent must compute |
