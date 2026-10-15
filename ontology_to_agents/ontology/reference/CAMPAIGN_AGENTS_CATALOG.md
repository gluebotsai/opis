# Worktual Campaign — Agents Catalog

Complete reference of Campaign AI agents: what each agent does, every tool it uses, and the purpose of each tool.

---

## 1. How the agent system works

Campaign agents are Python LLM workers. The SPA talks to them over Socket.IO. Each chat turn:

1. The client sends a message with a **module** (which agent owns the chat).
2. That module’s agent builds a system prompt + live session context.
3. The LLM may call **tools** (structured functions). Tools change CRM/campaign state via the Campaign API; chat text explains results.
4. The agent returns a reply plus optional UI events (sidebar, panels, navigation).

**Design rules**

- The LLM decides intent; tools only validate, persist, and return facts.
- Tools do not invent recipients, metrics, or launch success.
- Cross-module navigation uses routing tools (never silent redirects).
- Hub / A2A work is **autonomous** (no clarification questions back to Hub).

**Two runtime surfaces**

| Surface | Role |
|--------|------|
| **Chat modules** (Socket.IO) | Human-in-the-loop strategists and operators in the SPA |
| **Hub Super Agent + A2A spoke** | Machine-to-machine tasks from Worktual Hub (create contact, on-demand send, stop campaign, etc.) |

---

## 2. Agents overview

| Agent | Purpose |
|-------|---------|
| Create Campaign | Design, audience, templates, and launch a campaign |
| Contacts / Audience | Create, update, search, and manage CRM contacts |
| Monitoring | Live/scheduled campaign ops: report, pause, resume, A/B winner |
| Reports | Analytics Q&A: campaigns, events, ontology, semantic layer |
| Recommendations | Suggest next campaigns from past performance |
| Forms | Build/edit event forms via theme/fields/design specialists |
| WhatsApp Approved | Send an already-approved Meta template to an audience |
| WhatsApp Rejected | Fix rejected Meta copy and resubmit |
| Template Library & Director | Generate channel template cards (writers + creative director) |
| Template Coach | Manual-edit AI assist for template copy |
| Events Report | Event list/detail from session snapshot |
| On-Demand | Autonomous analyze → templates → prepare/launch send (Hub) |
| Hub Super | Sequential skill router for Hub tasks (no chat UI) |

---

## 3. Create Campaign Agent

### Agent purpose

The main **campaign strategist**. Helps the user choose name, goal, and objective; pick audience and channels; generate templates; and launch. Runs in two modes:

| Mode | Purpose |
|------|---------|
| **Create space (intake)** | Full strategist journey for a draft campaign |
| **Hub home** | Lightweight guide that opens destinations (recommendations, templates, drafts, create space, reports) |

Order of steps follows **user preference** (not a fixed pipeline). Audience is required before launch, not before templates. WhatsApp launch submits to Meta; sends wait until Meta approves.

### Tools — Create space

#### `update_campaign_setup`

**Purpose:** Save or change Campaign Overview (right panel) fields for the current draft.

**What it does:** Persists only the fields the LLM passes this turn — campaign **name**, **goal**, **objective**, full **channels** list (`email` / `whatsapp` / `web` / `push`), CRM segment wording via **audience_text**, send **orchestration_mode** (`prefer_primary` / `staggered` / `broadcast`), **primary_channel**, WhatsApp **retry** count, and strategy/template flags. The model must pass the complete channels list when changing channels; the server does not parse free chat text for channel intent. Use **audience_text** for CRM segments / “all contacts”; use **check_contacts** for named people.

#### `check_contacts`

**Purpose:** Verify whether specific people already exist in Audience before targeting them.

**What it does:** Looks up contacts by **emails**, **phones**, and/or **names**. If found, those contacts become the campaign audience on the panel. If not found, returns `emails_missing` / `phones_missing` / `names_missing` so the agent can offer create without re-asking the same values. Also flags common mailbox typos (for example `gmai.com` → suggest `gmail.com`) so the agent asks the user to confirm before creating.

#### `create_contact`

**Purpose:** Create one CRM contact from create-campaign chat when lookup missed them (or the user asks to add them).

**What it does:** Requires **first_name** plus **email or phone** (email alone is enough). Never requires phone when email is already known. Reuses values from earlier turns / `emails_missing`. Must be called with **user_confirmed=true** when the user clearly wants create. On success, refreshes audience and re-runs contact check. If the phone/email already belongs to an existing contact and fields differ, the flow should **update** that contact instead of inventing a “different phone” dead-end.

#### `upload_temporary_contacts`

**Purpose:** Attach a contact sheet for **this campaign session only** (not permanent CRM).

**What it does:** Accepts parsed **rows** (first_name, last_name, email, phone, etc.). Each row needs email or phone. Validated rows become the temporary campaign audience for launch in this session.

#### `update_contact`

**Purpose:** Change fields on an existing Audience/CRM contact from create-campaign chat (email fix, phone change, rename).

**What it does:** Resolves the contact via **contact_id**, **match_email**, **match_phone**, or the single current audience contact. Passes only fields to change. Requires **user_confirmed=true** when the user confirmed. Used especially after email typos or “update email to …” so the same phone record gets the new email without creating a duplicate.

#### `build_campaign`

**Purpose:** Create or regenerate template cards for the selected channels.

**What it does:** Modes: **create** (first batch / fill missing channels) or **regenerate** (full redo of style and content). Needs clear go-ahead via **user_confirmed=true**. Can pass **channels**, **name**, **goal**, **objective**, and WhatsApp retry so copy matches the agreed campaign. Does not launch.

#### `launch_campaign`

**Purpose:** Launch or schedule the campaign after the user confirms send.

**What it does:** Call with **confirmed=true**. **schedule_mode** `now` or `at` (with date/time/timezone). Supports **orchestration_mode**: prefer one primary channel at T0, stagger other channels later, or **broadcast** all channels together (only with explicit **broadcast_confirmed**). Blocks if audience or templates are missing. WhatsApp path submits the draft to Meta; sends start only after Meta approval.

### Tools — Hub home

#### `OPEN_HUB_DESTINATION`

**Purpose:** Navigate from Create-campaign hub home into a destination the user confirmed.

**What it does:** Opens one of: **recommendations**, **templates**, **drafts**, **whatsapp_approvals**, **create_space** (optional history handoff), **open_draft** (needs draft_id), or **reports**. Always requires **confirmed=true**. Hub mode is a guide/router, not the full strategist toolset.

### Legacy tools (not offered to the LLM by default)

| Tool | Purpose |
|------|---------|
| `select_audience` | Legacy audience picker — replaced by `update_campaign_setup` + `check_contacts` |
| `set_channels` | Legacy channel setter — replaced by `update_campaign_setup` |
| `update_campaign_meta` | Legacy meta updater — merged into `update_campaign_setup` |
| `present_campaign_summary` | Legacy pre-launch recap — not required before launch |

---

## 4. Contacts / Audience Agent

### Agent purpose

Manage the org’s **Audience (CRM contacts)** from chat: open create/update panels, look up people, create one or many contacts, update them, and browse/filter. Soft fields (last name, city, company) may be asked once but must not block create when first name + (email or phone) are present.

### Tools offered to the LLM

#### `SET_DRAFT_FIELDS`

**Purpose:** Keep the live create/update draft panel in sync with what the user said.

**What it does:** Merges structured fields (first_name, last_name, email, phone, company, city, custom fields, push endpoints) into the draft. **mode=create** opens/keeps the new-contact panel (even with empty fields so the UI appears before asking for name). **mode=update** is for editing an existing contact. Accepts full_name and splits it. Channel rule: email **or** phone is enough; phone needs country code when provided.

#### `GET_CONTACT_DETAIL`

**Purpose:** Load one contact’s details into focus using any identifier the user gave.

**What it does:** Accepts email, phone, WhatsApp number, or person name as **input_field**, then fills the detail/focus panel so the agent can talk about that person accurately.

#### `CONTACT_VIEW_AND_DOWNLOAD`

**Purpose:** Browse, filter, or list contacts from a natural-language Audience query.

**What it does:** Takes the user’s **query** as given and returns counts plus a short sample (not a full dump). Used for “show contacts in Chennai”, “who has email”, etc.

#### `CREATE_SINGLE_CONTACT`

**Purpose:** Persist one new contact after the user confirmed create.

**What it does:** Requires **firstName** (or first_name) and at least one of email / phone / WhatsApp number. Optional last name, company, city, custom fields. Does not invent success if create fails.

#### `CREATE_BULK_CONTACT`

**Purpose:** Create many contacts from an uploaded sheet.

**What it does:** Uses **fileUrl** and/or already-parsed **rows**. **isTemp** controls temporary vs permanent Audience storage (Audience permanent import uses permanent). Validates rows and reports import outcome.

#### `UPDATE_SINGLE_CONTACT`

**Purpose:** Update one existing contact with only the fields the user wants changed.

**What it does:** Requires contact **id**. Accepts first/last name, email, phone/WhatsApp, company, city, custom fields. Only include fields that are changing.

#### `UPDATE_BULK_CONTACT`

**Purpose:** Update many contacts from an uploaded CSV/Excel (or parsed rows).

**What it does:** Applies bulk field updates from **fileUrl** / **rows** for permanent Audience contacts.

#### `ROUTE_TO_MODULE`

**Purpose:** Hand the user to another workspace when the request is no longer about Audience.

**What it does:** Sets target **module** (e.g. create_campaign, monitoring, reports, forms) plus a short **query** restatement. Call alone when routing — do not mix with contact create tools in the same turn.

### Additional contacts toolkit tools (handlers / advanced flows)

| Tool | Purpose |
|------|---------|
| `LOOKUP_CONTACT` | Exists-check / find by email, phone, and/or full name before create or update; returns short candidates |
| `GET_CONTACT` | Load one contact by id into session draft/focus |
| `SEARCH_CONTACTS` | Filter contacts by city, company, job title, has_email/phone, or free-text search; returns count + tiny sample |
| `VERIFY_FOCUS_IDENTITY` | Confirm the focused contact’s identity before sensitive updates |
| `CREATE_CONTACT` | Classic create with `user_confirmed=true`; hard gate first_name + (email or phone) |
| `UPDATE_CONTACT` | Classic update by contact_id after explicit confirm |
| `REQUEST_DELETE` | Mark a contact pending delete and ask for confirmation (does not delete yet) |
| `CONFIRM_DELETE` | Complete or cancel delete after the user says yes/no |
| `IMPORT_CONTACTS` | CCUIA bulk import with dry_run, upsert, consent source, and compliance acknowledgement |
| `GET_COMPANY_PACK` | Load industry/company validation pack for the org |
| `ADD_COMPANY_RULE` | Add a validation rule to the company pack |
| `UPDATE_COMPANY_RULE` | Change an existing company-pack rule |
| `DELETE_COMPANY_RULE` | Remove a company-pack rule |
| `UPSERT_PACK_FIELD` | Add or update a custom field hint on the company pack |
| `CONFIRM_PACK_FIELD` | Confirm a pending pack field definition |
| `DELETE_PACK_FIELD` | Remove a field hint from the company pack |

---

## 5. Monitoring Agent

### Agent purpose

Operate **live, scheduled, past, and draft** campaigns: list buckets, open reports, inspect audience outcomes, pause/resume channels, stop whole campaigns, and pick email A/B winners.

### Tools

#### `LIST_MONITOR_CAMPAIGNS`

**Purpose:** List campaigns in a monitoring bucket with optional date filters and paging.

**What it does:** **bucket** = live / scheduled / past / draft / all. Optional relative windows (today, last_7_days, …) or from/to dates. Returns total_matched, has_more, next_offset so the agent can page results.

#### `GET_CAMPAIGN_REPORT`

**Purpose:** Load one campaign’s operational report.

**What it does:** Returns per-channel to_send / sent / failed / stub, pause state, and campaign-level totals. Prefer when a focus campaign is already set or the user named a campaign_id.

#### `GET_CAMPAIGN_AUDIENCE`

**Purpose:** Explain who was selected vs who actually got a live send vs stub vs missed.

**What it does:** Lists audience outcomes for a campaign (optional channel filter): sent, stub (not delivered to inbox), failed, skipped, pending, not_sent. Used for “who received?” / “who missed?”.

#### `STOP_CAMPAIGN`

**Purpose:** Stop an entire live or scheduled campaign.

**What it does:** First call without **reason** can inspect status and sent vs selected counts. To actually stop, call again with a non-empty **reason**. If already completed/cancelled, tell the user — do not invent a reason. Use `STOP_CHANNEL` when only one channel should pause.

#### `STOP_CHANNEL`

**Purpose:** Pause one channel on a live or scheduled campaign.

**What it does:** Requires **campaign_id**, **channel**, and a non-empty **reason** (shown on the channel description).

#### `RESUME_CHANNEL`

**Purpose:** Resume a paused channel.

**What it does:** Requires **campaign_id** and **channel**. Not allowed for past/expired campaigns.

#### `PICK_AB_WINNER`

**Purpose:** Choose the email A/B winner and send the holdout remainder.

**What it does:** Pass **winner** `a` or `b` to force a variant, or omit to auto-pick from open/click rates. **force=true** allows early pick before the decide window. Email A/B only.

#### `ROUTE_TO_MODULE`

**Purpose:** Leave Monitoring when the user’s request belongs in another module.

**What it does:** Same shared routing tool — target module + short query.

---

## 6. Reports Agent

### Agent purpose

Unified **Reports & Analytics** chat: campaign lists/reports/audience, channel pause/resume, event list/detail, plus higher-level analytics via ontology and semantic layer. Broader than Monitoring (KPI/analytics questions, not only ops).

### Tools

#### `ask_ontology`

**Purpose:** Answer knowledge-graph / past-campaign relationship questions.

**What it does:** Sends a plain-language **query** to the ontology layer for themes, whether a campaign type ran before, and relationships between campaigns/contacts/events. Do **not** use for open rate / click rate / sent volume (use `query_analytics`).

#### `query_analytics`

**Purpose:** Answer report KPI / metrics questions.

**What it does:** Handles open rate, click rate, delivery rate, sent volume, live/scheduled counts. Hits semantic layer first, then allowlisted Campaign metrics. Supports relative windows and date ranges. Do not use for ontology theme questions or create/stop flows.

#### `ask_semantic_layer`

**Purpose:** Low-level semantic gateway call for report KPIs.

**What it does:** Plain-language metrics question to the semantic layer. Prefer `query_analytics` for normal report metrics; do not use for ontology graph questions.

#### `LIST_MONITOR_CAMPAIGNS`

**Purpose:** List campaigns with metrics for comparisons and named lookups.

**What it does:** Same paging/bucket model as Monitoring, plus optional **name_contains**. Used when the user asks “how many live campaigns” or “show campaigns named …”.

#### `GET_CAMPAIGN_REPORT`

**Purpose:** Full report for one campaign_id.

**What it does:** Goal, schedule/timezone, audience count, and per-channel sent/stub/failed/opens/clicks/rates/pause state. For named contacts use `GET_CAMPAIGN_AUDIENCE`.

#### `GET_CAMPAIGN_AUDIENCE`

**Purpose:** List contacts selected for a campaign and each contact’s outcome.

**What it does:** Same audience outcome breakdown as Monitoring, from the Reports chat.

#### `STOP_CAMPAIGN`

**Purpose:** Stop a campaign from Reports when the user asks to stop it.

**What it does:** Same two-step reason flow as Monitoring’s stop-campaign tool.

#### `STOP_CHANNEL`

**Purpose:** Pause one channel from analytics chat.

**What it does:** Requires campaign_id, channel, and reason.

#### `RESUME_CHANNEL`

**Purpose:** Resume a paused channel from analytics chat.

**What it does:** Requires campaign_id and channel.

#### `LIST_EVENTS`

**Purpose:** List events from the Reports session snapshot.

**What it does:** Filter by status (active/ended/draft/planned/all) and kind; returns title, status, submission/open counts.

#### `GET_EVENT_DETAIL`

**Purpose:** Detail for one event by id or title.

**What it does:** Fields, submissions, opens, public slug when present.

#### `ROUTE_TO_MODULE`

**Purpose:** Navigate away when the request belongs in Create Campaign, Forms, Audience, etc.

---

## 7. Events Report Agent

### Agent purpose

Narrower event-focused chat: list and inspect events from the session snapshot (forms, webinars, etc.). Prefer Reports when the user also needs campaign KPIs or ontology.

### Tools

#### `LIST_EVENTS`

**Purpose:** List events with optional status/kind filters.

**What it does:** Returns a short list from the session snapshot; can include or exclude drafts.

#### `GET_EVENT_DETAIL`

**Purpose:** Load one event by id or title.

**What it does:** Includes fields, submission/open counts, and recent submissions when present.

#### `ROUTE_TO_MODULE`

**Purpose:** Hand off to Forms, Create Campaign, Reports, or another module when needed.

---

## 8. Recommendations Agent

### Agent purpose

Build the **Recommendations board**: ideas for next campaigns informed by completed past campaigns (performance, channels, audiences).

### Tools

#### `LOAD_PAST_CAMPAIGNS`

**Purpose:** Load completed campaigns into context before generating ideas.

**What it does:** Pulls name, goal, objective, channels, audience, and performance (sent, failed, bounced, opens, clicks, rates). Call this if past_campaigns is missing before generate.

#### `GENERATE_RECOMMENDATIONS`

**Purpose:** Put campaign ideas on the Recommendations board.

**What it does:** Writes each card with title, goal, objective, audience, channels, why_created, timing_label, and optional templates / inspired_by fields. Use an empty list when nothing useful should be shown. Optional **focus** describes what the ideas optimize for.

#### `ROUTE_TO_MODULE`

**Purpose:** Open Create Campaign (or another module) when the user wants to run an idea.

---

## 9. Forms Agent

### Agent purpose

Help design **event/lead forms**. The main agent does not edit form JSON directly; it routes to internal specialists, or hands off to Create Campaign when the user wants to promote/launch the form.

### Tools

#### `RUN_THEME_SPECIALIST`

**Purpose:** Change form look/style only.

**What it does:** Sends the user’s theme/style instruction to the Theme specialist (colors, background, logo, spacing, button text). Not for campaign launch or field structure.

#### `RUN_FIELDS_SPECIALIST`

**Purpose:** Change form fields and related copy.

**What it does:** Add/remove/rename/reorder fields, defaults, title, description, thank-you text. Not for publish/save/launch — use `ROUTE_TO_CREATE_CAMPAIGN` for campaign intent.

#### `RUN_DESIGN_SPECIALIST`

**Purpose:** Create a new form or fully redesign fields + theme together.

**What it does:** Used for overall form goals or major overhauls — not for small theme-only or campaign-only asks.

#### `ROUTE_TO_CREATE_CAMPAIGN`

**Purpose:** Hand off to Create Campaign when the user wants to promote, launch, or send this form.

**What it does:** Passes restated **campaign_goal** and **user_confirmed** (true only if they explicitly approved opening Create Campaign this turn). Do not mix with specialist tools in the same turn.

#### `ROUTE_TO_MODULE`

**Purpose:** Route to a non-campaign destination (Audience, Monitoring, Dashboard, etc.).

**What it does:** Same shared router; for create-campaign-from-form specifically, prefer `ROUTE_TO_CREATE_CAMPAIGN`.

---

## 10. WhatsApp Approved Agent

### Agent purpose

Send an **already Meta-approved** WhatsApp template as-is to a chosen audience. No template editing or resubmission.

### Tools

#### `SET_AUDIENCE`

**Purpose:** Store who will receive the approved template.

**What it does:** Accepts **phones** (digits with country code) and/or **contact_ids**. Mode **replace** (default) or **add**. Call whenever the user names recipients.

#### `FILTER_CONTACTS`

**Purpose:** Find contacts by name/email/phone/city/company and use them as audience.

**What it does:** Prefer this when the user gives a person name or email — do not ask for phone first. Stores matching contact_ids as audience (replace or add).

#### `SEND_APPROVED_TEMPLATE`

**Purpose:** Send the approved template via the Campaign regulated Meta send API.

**What it does:** Only after **user_confirmed=true**. Does not edit or resubmit the template. Optional **body_params** fill `{{1}}`, `{{2}}`, … variables in order.

---

## 11. WhatsApp Rejected Agent

### Agent purpose

Help fix a **Meta-rejected** WhatsApp template: revise copy, then resubmit under a new unique name after confirmation.

### Tools

#### `SET_TEMPLATE_FIELDS`

**Purpose:** Update the rejected template draft fields from user revisions.

**What it does:** Sets name, header, body, footer, and buttons (newline-separated labels). Emits UI events so the editor reflects the draft. Call whenever the user provides revised copy.

#### `SUBMIT_FOR_APPROVAL`

**Purpose:** Save a new draft (new unique name) and submit to Meta.

**What it does:** Only after **user_confirmed=true**. Asks the frontend to persist and submit; does not claim Meta approval until Meta responds.

---

## 12. Template Library, Director & Coach

These are mostly **generation / assist workers**, not full chat modules with the same OpenAI tool-loop style. Create Campaign and On-Demand call them to produce or refine channel cards.

### Template Library (channel writers)

| Writer | Purpose |
|--------|---------|
| Email writer | Produce email card copy: subject, greeting, body structure, CTA, sign-off |
| WhatsApp writer | Produce Meta-safe WhatsApp components (name, language, category, header/body/footer/buttons) |
| Web push writer | Produce browser notification title, body, and CTA |
| App push writer | Produce mobile push title and body |
| SMS / PPC writers | Channel-specific copy where those channels are configured |

**Creation agent purpose:** Coordinate the channel writers from a campaign brief (name, goal, objective, insight, channels) and return template cards.

### Template Generation Director

**Purpose:** Own first-time template generation and full regeneration — choose message archetype and channel design plan, run validation/creative review/retry, return templates with an auditable generation report.

**Does not own:** Create-campaign conversation, audience/channel selection, Manual Edit tweaks, launch, scheduling, or send workers.

### Template Coach (Manual Edit)

**Purpose:** Isolated AI Assist for Manual Edit. Receives a snapshot only (campaign idea, optional AI Edit chat, channel, current template) — no shared memory with create-campaign.

**Jobs / outputs:** Rewrite selected editable copy; save-review wording vs idea; optional spelling/grammar patches. Returns JSON (`ok`, `walkthrough`, `issues`, `apply`, `corrected_content`, `field_patches`). Does not change locked merge tags or legal footer; does not re-check hard channel length limits (editor already blocks those).

---

## 13. On-Demand Agent

### Agent purpose

**Autonomous** path when Hub (or internal API) asks Campaign to reach someone now: analyze the operator instruction, resolve audience identity, generate templates, prepare/launch send — **no human confirmation loop**.

### What it uses (pipeline steps, not SPA chat tools)

| Step | Purpose |
|------|---------|
| Request analysis | Extract emails/phones/customer ids, channels, campaign name/goal/objective, and marketing **insight** for copywriters (operator text is instruction, not recipient copy) |
| Audience identity resolution | Collect/validate contact identity; abort with structured error if identity required but missing |
| Template generation | Call Template Library / Director to build channel templates from the analysis |
| Campaign create + launch | Persist campaign and launch via Campaign API without asking Hub clarifying questions |

Primary consumers: Hub Super and A2A `on-demand-send`.

---

## 14. Hub Super Agent

### Agent purpose

Campaign’s **machine orchestrator** for Hub tasks. No clarifying questions. Execution is **sequential** only.

### Sub-agents (skills) and purpose

| Skill | Purpose |
|-------|---------|
| **on_demand** | Create a campaign from Hub payload, generate templates, launch automatically |
| **contacts** | Create a contact from Hub fields (first_name + email or phone); Hub confirmation implied by the task |
| **monitoring** | Campaign report, stop channel, resume channel, or stop campaign for a given campaign_id |

### Intent → skills

| Intent | Skills (in order) | Purpose of that pipeline |
|--------|-------------------|---------------------------|
| on_demand_send / on_demand / create_and_launch | on_demand | One-shot create + send |
| create_contact / contacts_create | contacts | Create contact only |
| campaign_report / monitoring_report / analyze_campaign | monitoring | Load/analyze report |
| stop_channel / resume_channel / stop_campaign | monitoring | Ops control on a campaign |
| create_contact_and_send / contact_then_send | contacts → on_demand | Create contact, then create+launch for them |

Missing required fields → structured `failed` with errors — never `needs_clarification`.

---

## 15. A2A Spoke (Hub ↔ Campaign)

### Purpose

Agent-to-Agent surface so Worktual Hub can discover Campaign skills, mint tokens, and invoke `message/send`. Campaign can escalate remainder work to Hub when source is Campaign (never when source is Hub).

### Hub-facing skills

| Skill id | Purpose |
|----------|---------|
| **on-demand-send** | Create campaign from Hub request, generate templates, launch automatically — no clarification |
| **create-contact** | Create a CDP/campaign contact from Hub fields (first_name + email or phone) |
| **campaign-report** | Load campaign performance / status analysis for a campaign_id |
| **stop-channel** | Pause one campaign channel (needs campaign_id, channel, reason) |
| **resume-channel** | Resume one paused campaign channel (needs campaign_id, channel) |
| **stop-campaign** | Stop an entire campaign (needs campaign_id and reason) |
| **create-contact-and-send** | Multi-skill: create contact, then on-demand create+launch for that contact |

### Typical endpoints

| Endpoint | Purpose |
|----------|---------|
| Agent card | Discovery of skills and auth URLs |
| `/token` | Client-credentials access token for invoke |
| `message/send` (JSON-RPC) | Hub instructs Campaign with skill + payload |
| escalate-hub / remainder | Campaign asks Hub to plan leftover work |
| hub-ping | Diagnostic: card → token → invoke reachability |

---

## 16. Shared routing tool

Used by many chat modules:

#### `ROUTE_TO_MODULE`

**Purpose:** Hand the user to another campaign workspace when their request belongs elsewhere.

**What it does:** Infers target **module** from meaning (contacts, create_campaign, monitoring, reports, recommendations, forms, events, dashboard, etc.), with a short **query** restatement and optional **create=true** for new-contact / new-form flows. Call **only this tool** when routing — do not mix with other tools in the same turn.

---

## 17. Quick map: user need → agent

| User / Hub need | Agent |
|-----------------|-------|
| “Create a campaign for X” | Create Campaign |
| “Add / fix this contact” (Audience) | Contacts |
| “Add contact while creating a campaign” | Create Campaign (`create_contact` / `update_contact`) |
| “How is campaign Y doing?” / pause channel | Monitoring or Reports |
| “Open rates last week / past similar campaigns” | Reports (`query_analytics` / `ask_ontology` / semantic layer) |
| “Suggest next campaigns” | Recommendations |
| “Change form colors / fields” | Forms (+ specialists) |
| “Send this approved WA template” | WhatsApp Approved |
| “Meta rejected this template” | WhatsApp Rejected |
| Hub: send nurture now | On-Demand via Hub Super / A2A |
| Hub: create contact then email | Hub Super multi-skill pipeline |

---

## 18. Principles (all agents)

1. **Tools change state; chat explains.** Never claim success the tool did not return.
2. **No chat-intent regex** for routing or confirmation — LLM + explicit tool args (`user_confirmed`, channels lists, etc.).
3. **Email validation** (format + common domain typos) belongs in tools, not free-form guessing.
4. **Contact hard gate:** first_name + (email OR phone). Phone is optional when email is known.
5. **Hub autonomy:** Super Agent / On-Demand never ask Hub clarifying questions; fail structured if inputs missing.
6. **Channel ids:** `email`, `whatsapp`, `web` (web push), `push` (app push). “App” means `push`, not WhatsApp.

---

*Catalog of Campaign agents and every tool purpose (Inbox omitted).*
