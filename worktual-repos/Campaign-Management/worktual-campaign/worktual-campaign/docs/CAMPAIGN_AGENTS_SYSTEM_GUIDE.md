# Worktual Campaign Multi-Agent System — Complete Guide

> **This is the single source of truth.** Use **only this file** for agents, tools, routing, right-panel updates, reply generation, and fine-tuning. Other docs in `docs/` that mention agents redirect here.

**Audience:** LLM fine-tuning / conversation-data team, product engineers, agent authors  
**Scope:** Campaign spoke agents in `worktual-campaign/agents/` (Python) + SPA chat modules (`frontend/`)  
**Status:** Production MAS default (`MAS_ENABLED_DOMAINS=all`) with legacy module fallbacks when disabled

---

## 1. Purpose of this document

Use this guide to:

1. Understand which **Campaign agents** exist and what each one does (step by step).
2. Know which **tools** each agent / executor can call and **when** they run.
3. Understand **multi-agent routing** (Super → Domain → Executor) and SPA **module** entry.
4. See how the **right panel** fills and updates from tools (create overview + contacts draft).
5. Understand how **assistant replies** are generated and emitted over Socket.IO.
6. Collect **complete agent conversation traces** suitable for SFT / preference / tool-calling fine-tuning.

Fine-tuning data should capture **full agent turns** (tool calls + tool results + routing), not only the final user-visible HTML reply.

**Primary product spoke for this corpus:** Worktual **Campaign** (create, audience, monitor, reports, forms, Hub on-demand).

---

## 2. System overview

Campaign agents are **Python LLM workers**. The React SPA talks over **Socket.IO** (`agents/app/socket_server.py`). Each chat turn:

1. Client sends `user_message` with a **module** (which product surface owns the session).
2. Runtime builds system prompt + **live session context** (`public_state`, MAS runtime JSON).
3. LLM calls **tools** with explicit arguments; tools validate, persist via Campaign API, emit UI events.
4. Server emits **`state_update` → `ui_event`×N → `agent_message`** (order varies slightly by module).
5. FE updates **left chat** and **right panel** from those events.

| Product path | Campaign role | Entry style | Multi-agent? | Typical use |
|---|---|---|---|---|
| **Create campaign chat** | Creation strategist + overview panel | Socket.IO `module=create_campaign` | Yes — Super → creation → executors | Design audience, channels, templates, launch |
| **Audience / Contacts** | CRM contact create/update/view | Socket.IO `module=contacts` | Yes — Super → audience → contact executor | Contact setup panel + list/detail |
| **Dashboard co-worker** | Reports / analytics Q&A | Socket.IO `module=reports` | Yes — optimization → analytics | Home dashboard chat + Overview KPIs |
| **Campaign monitor** | Live ops | Socket.IO `module=monitoring` | Yes — optimization → monitoring | Pause/resume, reports, A/B |
| **Reports workspace** | Analytics + ops | Socket.IO `module=reports` | Same as dashboard analytics path | KPIs, ontology, campaign lists |
| **Recommendations** | Next-campaign ideas | Socket.IO `module=recommendations` | creation → recommendation executor | Board cards |
| **Recommendation run** | Run one card | Socket.IO `module=recommendation_run` | recommendation_run domain | Prefilled create journey |
| **Template library run** | Use library template(s) | Socket.IO `module=library_run` | library_run domain | Library → campaign |
| **Forms** | Form specialists | Socket.IO `module=forms` | forms domain | Theme / fields / design |
| **WhatsApp approved/rejected** | Regulated WA send / fix | Socket.IO modules | content executors | Meta templates |
| **Hub Super / A2A** | Machine orchestration | HTTP JSON-RPC / Hub skills | Super → domain → executor | On-demand send, create contact, stop channel |
| **Cron / workers** | Background jobs | Direct executor | No Super/Domain LLM | A/B winner, compliance scan |

**Design rules (non-negotiable):**

- **LLM decides intent**; tools only normalize, validate, persist, return facts.
- **No chat-intent regex** for channels, create vs update, launch confirm — explicit tool args (`channels`, `mode`, `user_confirmed`, `confirmed`).
- **Email/phone format checks** in tools on upload/merge are allowed; not for inventing chat intent.
- **Hub / on-demand** never ask clarifying questions — structured `failed` if inputs missing.

---

## 3. Campaign MAS hierarchy (Super → Domain → Executor)

Production chat flow (when MAS enabled):

```text
Level 1: Campaign Super Agent                    [mas/super_agent/agent.md]
    │
    ├─ Level 2: audience          → contact | audience_selection | audience_pull
    ├─ Level 2: creation          → brief_validation | campaign_audience | campaign_content | recommendation | launch_scheduling
    ├─ Level 2: recommendation_run → (shared creation executors, prefilled card)
    ├─ Level 2: library_run     → (library brief / audience / templates / launch)
    ├─ Level 2: content           → WA/email/push writers, coach, approved send, verification
    ├─ Level 2: image             → image_generate | image_refine | image_attach | campaign_images
    ├─ Level 2: optimization      → monitoring | analytics | recovery
    └─ Level 2: forms             → form_theme | form_fields | form_design
            │
            └─ Level 3: Executor native tool loop → business tools (update_campaign_setup, SET_DRAFT_FIELDS, …)
```

**Sticky follow-up:** same SPA module + unchanged topic → **Domain → Executor only** (skip Super).

**Cron / workers:** `CRON_BINDINGS` → **direct executor** (no Super/Domain LLM).

Full catalog: `agents/app/mas/catalog.py` (`DOMAIN_IDS`, `MODULE_TO_DOMAIN`, `DOMAIN_EXECUTORS`).

---

## 4. SPA module → agent map

| Socket `module` | MAS domain | Right panel (if split UI) | Legacy agent entry (rollback) |
|---|---|---|---|
| `contacts` | audience | Create / detail / matches / list | `agents/contacts/agent.py` |
| `create_campaign` | creation | **Campaign overview** checklist | `agents/create_campaign/agent.py` |
| `recommendations` | creation | Recommendations board (page) | recommendations agent |
| `recommendation_run` | recommendation_run | Campaign overview (templates hidden) | RecommendationRunWorkspace |
| `library_run` | library_run | Library run panel | library_run domain |
| `monitoring` | optimization | Monitor list / detail | monitoring agent |
| `reports` | optimization | Dashboard **Overview** or Reports charts | reports agent |
| `events_report` | optimization | Events list | events_report agent |
| `forms` | forms | Form preview panel | forms agent |
| `whatsapp_approved` | content | WA send panel | whatsapp approved agent |
| `whatsapp_rejected` | content | WA editor draft | whatsapp rejected agent |
| `mas` | Super only | Depends on routed domain | Super router smoke |

Hub session ids / `hub_mode` use **Hub MAS** with `preferred_domain` hints — Super still orchestrates.

---

## 5. How multi-agent routing works

### 5.1 High-level flow (interactive chat)

```text
User message (SPA chat composer)
        │
        ▼
socket_server: user_message { session_id, token, module, text, … }
        │
        ├─ MAS enabled? → mas/runtime/invoke.py
        │       │
        │       ├─ First turn / domain change → Super: route_to_domain(domain_id, restated_query)
        │       ├─ Sticky same domain → Domain agent (agent.md) picks invoke_executor
        │       └─ Executor → bounded tool loop → handlers / Campaign API
        │
        └─ Legacy rollback → module-specific agent.py tool loop
        │
        ▼
Persist session (Redis + DB), collect ui_events
        │
        ▼
Emit to room campaign_session:{session_id}:
  state_update { state: public_state(session) }
  ui_event × N
  agent_message { text: HTML reply }
  agent_typing / thinking_progress / turn_complete
        │
        ▼
Frontend listeners → React state → left chat + right panel
```

### 5.2 Runtime steps (every chat turn)

1. Authenticate token; load or create session; merge FE context (`focus_contact_id`, `dashboard_period`, `campaign_profile`, handoff).
2. Append user message to transcript / LLM memory.
3. Run Super (if not sticky skip) or Domain router LLM.
4. Domain invokes **one executor** per turn (typical) with skill playbook (`mas/skills/...`).
5. Executor runs **tool loop** until final assistant content or max rounds.
6. After tools that mutate overview/draft: emit **`state_update`** (create campaign mid-turn via `_STATE_TOOLS`).
7. End of turn: reconcile session → emit **`state_update`** (contacts always before chat) → **`ui_event`s** → **`agent_message`**.
8. Persist assistant message; release typing lock; `turn_complete`.

### 5.3 Important runtime rules

1. **Routing is LLM-based** — `route_to_domain` (Super), `invoke_executor` (Domain), `ROUTE_TO_MODULE` (cross-module SPA), not keyword maps.
2. **Patch tools use partial args** — only fields changing this turn (`update_campaign_setup`, `SET_DRAFT_FIELDS`).
3. **Right panel lags chat by milliseconds** — driven by `state_update` / `draft_updated`, not by parsing assistant HTML.
4. **Mutations** often require **`user_confirmed` / `confirmed` / `channels_confirmed`** on the tool schema.
5. **Tools never invent** launch success, audience counts, or contact ids — they return API facts for the LLM to phrase.
6. **Create campaign hub mode** uses **`OPEN_HUB_DESTINATION`** only — not the full strategist toolset.

---

## 6. Right panel: field patches, tools, UI (full detail)

### 6.0 Golden rule

| Layer | Responsibility |
|-------|----------------|
| **LLM** | Understands the user; calls tools with **explicit args** (fields, `mode`, channels, …) |
| **Tool** | Validates / merges / persists session; may emit `ui_event` |
| **Socket** | Pushes `state_update` → `ui_event`×N → `agent_message` |
| **FE** | Applies payloads to React state; **does not** parse chat intent |

Corrections and out-of-order answers always go through tools again — not FE string matching.

### 6.1 End-to-end turn (both modules)

```text
User types in left chat
        │
        ▼
socket.emit("user_message", { session_id, text, module, … })
        │
        ▼
Agent / MAS tool loop
  ├─ LLM may call patch tool(s) mid-turn
  ├─ Tool writes session (campaign.* / draft_contact / …)
  ├─ Mid-turn: state_update  ──► right panel updates NOW
  └─ Loop ends → final HTML reply
        │
        ▼
Socket emit order
  Campaign create:  (mid-turn state_update already sent)
                    ui_event×N → agent_message → turn_complete
  Contacts:         state_update → ui_event×N → agent_message
        │
        ▼
FE: right panel re-renders from state / draft_updated
    left chat appends assistant text
```

### 6.2 Create campaign — Campaign overview (right)

| UI | Component |
|----|-----------|
| Shell title | **Campaign overview** (`ContentPanelShell`) |
| Body | `CampaignGuidedPreview` |
| Snapshot | `snapshotFromCampaignState()` in `campaign-guided-fields.ts` |

Checklist rows: **name → goal → objective → audience → channels → templates → launch** (+ optional other).

Template **cards** live in the **left** chat timeline. Overview only shows a **template count**.

**Patch tool:** `update_campaign_setup` (`tools.py` / `handle_update_campaign_setup`). Pass **only** fields new or changing this turn.

| Arg | When to pass | Overview row |
|-----|--------------|--------------|
| `name` | User set / corrected title | Campaign name |
| `goal` | User set / corrected goal | Goal |
| `objective` | User set / corrected objective | Objective |
| `channels` + `channels_confirmed=true` | User **explicitly** chose channels this turn | Channels |
| `audience_text` | CRM segment / all contacts / city | Audience |
| `orchestration_mode` | broadcast / stagger / prefer | Launch / other |
| `change_summary` | **Required** — internal log (never shown in chat) | — |

**Do not:** default channels to email; pass `channels` on meta-only turns; put a person name in `name`; invent recipients (use `check_contacts`).

| User says | Tool call |
|-----------|-----------|
| “Name it Spring Sale, goal is reactivation” | `update_campaign_setup({ name, goal, change_summary })` |
| “Change the goal to upsell” | `update_campaign_setup({ goal: "upsell", change_summary })` — **patch only goal** |
| “Use email and WhatsApp” | `update_campaign_setup({ channels: ["email","whatsapp"], channels_confirmed: true, … })` |
| “All contacts in Mumbai” | `update_campaign_setup({ audience_text: "…", … })` |
| “Run for aravi@gmail.com” | **`check_contacts`** first (not audience_text) |

**Session → panel path:**

```text
update_campaign_setup
  → mutate session.campaign / channels / audience / launch_plan
  → save_session
  → name in _STATE_TOOLS → _emit_state
  → socket "state_update" { state: public_state(session) }
  → CreateCampaignChatWorkspace.onState
       setAgentState → applyAgentStateToDraft
  → snapshotFromCampaignState → CampaignGuidedPreview (ticks + values)
```

`_STATE_TOOLS` (mid-turn emit): `update_campaign_setup`, `update_campaign_meta`, `set_channels`, `select_audience`, `check_contacts`, `lookup_contacts`, `create_contact`, `upload_temporary_contacts`, `update_contact`, `build_campaign`, `launch_campaign`.

Other refreshes: `check_contacts` → audience; `build_campaign` → template count + left cards (`templates_ready`); image ui_events → card images; `launch_campaign` → Launch row.

### 6.3 Contacts — Audience right panel

FE `rightMode` in `AudienceWorkspace.tsx`:

| Mode | Pane | Opens when |
|------|------|------------|
| `list` | `ContactsSummaryPanel` | Default |
| `create` | `ContactGuidedPreview` | `SET_DRAFT_FIELDS mode=create` / navigate |
| `detail` | Draft fields + profile | update/view + `focus_contact_id` |
| `matches` | Candidate list | Multi-hit search / view |

**Patch tool:** `SET_DRAFT_FIELDS` (`schemas.py` / `handle_set_draft`). Call whenever the user provides or **corrects** values.

| Arg | Purpose |
|-----|---------|
| `mode` | `create` \| `update` — open/keep panel |
| `reset_draft` | Clear draft + leave open profile |
| `first_name` / `last_name` | Single-field answers |
| `full_name` | **Only** when user gave both names together |
| `email` / `phone` | Channel (either enough; phone needs country code) |
| `company_name` / `city` | Soft fields |
| `clear_*` / push fields | Clears and push phase |
| Structured args only | Do **not** extract from free-text `change_summary` |

**Required on create intent:** call first with `mode=create` (fields may be empty) so the panel opens before asking for first name.

| User says | Tool call |
|-----------|-----------|
| “I want to create a contact” | `SET_DRAFT_FIELDS({ mode: "create", … })` — open panel |
| “Priya” | `SET_DRAFT_FIELDS({ first_name: "Priya" })` |
| “Change email to x@y.com” | `SET_DRAFT_FIELDS({ email: "x@y.com" })` |
| “Pujitha Paleti” | `SET_DRAFT_FIELDS({ full_name: "Pujitha Paleti" })` |
| Detail open + “new contact” | `mode=create` + `reset_draft=true` |
| Editing open contact | `mode=update` + fields |

```text
SET_DRAFT_FIELDS
  → merge into session.draft_contact; set draft_mode
  → optional LOOKUP (duplicates stay on create)
  → ui_event draft_updated (+ navigate /audience/new if staged create)
        │
        ▼
_emit_contacts_turn_result
  1) state_update
  2) ui_event × N
  3) agent_message
        │
        ▼
AudienceWorkspace: setDraft → ContactGuidedPreview / detail / matches
```

`_draft_ui_payload`: `{ draft_contact, focus_contact_id, mode, reset?, candidates?, already_exists?, duplicate_during_create? }`

**FE locks:** `agentDraftLockRef` (prefer agent draft over HTTP overwrite); `freshCreateRef` (ignore stale draft after +Add/clear).  
**+Add:** local empty create + `join_session` `clear_contact_draft` → LLM must call `SET_DRAFT_FIELDS mode=create`.

### 6.4 Field modification cheat sheet

| Change (campaign) | Tool | Panel via |
|-------------------|------|-----------|
| Name / goal / objective | `update_campaign_setup` (partial) | `state_update` |
| Channels | + `channels_confirmed` | same |
| Segment audience | `audience_text` | same |
| Named people | `check_contacts` | audience row |
| Templates | `build_campaign` | count + left cards |
| Launch | `launch_campaign` | Launch row |

| Change (contacts) | Tool | Panel via |
|-------------------|------|-----------|
| Any draft field / correction | `SET_DRAFT_FIELDS` | `draft_updated` + `state_update` |
| Open create empty | `mode=create` | create pane |
| Leave profile → new | `mode=create` + `reset_draft` | create + navigate |
| Persist new | `CREATE_*` | `contact_created` → detail |
| Persist edit | `UPDATE_*` | `contact_updated` |
| Find / show | `VIEW_CONTACT` / `QUERY_CONTACTS` | detail or matches |

### 6.5 UI event handling summary

**Campaign (`CreateCampaignChatWorkspace`):**

| Event | Right panel | Left chat |
|-------|-------------|-----------|
| `session_ready` | Seed overview from `state` | Load messages |
| `state_update` | `setAgentState` + draft mirror → overview | — |
| `ui_event` templates / images | Template count may bump | Cards / progress / images |
| `agent_message` | May highlight next missing field if `?` | Append HTML |

**Contacts (`AudienceWorkspace`):**

| Event | Right panel |
|-------|-------------|
| `state_update` | Sync draft; open create/update when live tools signal |
| `draft_updated` | Merge draft; switch create/detail; sync if already open |
| `navigate` create | Force `/audience/new` |
| `contact_candidates` | matches / detail / stay create on duplicate |
| `contact_created` / `updated` | Toast + detail / list refresh |
| `agent_message` | Chat only |

### 6.6 Sequences

**Campaign — correct goal:**

```text
User: "Change goal to win-back"
  → update_campaign_setup({ goal: "win-back", change_summary: "…" })
  → state_update  ──► Overview Goal ticks green
  → agent_message on left
```

**Contacts — correct email:**

```text
User: "email is wrong, use priya@acme.com"
  → SET_DRAFT_FIELDS({ email: "priya@acme.com" })
  → state_update + draft_updated
  → ContactGuidedPreview Email updates; create stays open
  → agent_message
```

### 6.7 Dashboard — Overview (right)

| Concern | Mechanism |
|---|---|
| **Data source** | HTTP `loadDashboardBundle()` + period — **not** agent tools for KPI fill |
| **Co-worker** | `module=reports`; optional `StructuredAnalytics` in `agent_message` |
| **Period** | FE state → `dashboard_period` on join/message |

### 6.8 Key FE / agent files (right panel)

| Area | Path |
|------|------|
| Campaign FE | `CreateCampaignChatWorkspace.tsx`, `CampaignGuidedPreview.tsx`, `campaign-guided-fields.ts` |
| Contacts FE | `AudienceWorkspace.tsx`, `ContactGuidedPreview.tsx`, `contact-guided-fields.ts` |
| Campaign tools | `create_campaign/tools.py`, `tool_functions.py`, `agent.py` |
| Contacts tools | `contacts/tools/schemas.py`, `handlers.py` |
| Socket | `socket_server.py` (`_emit_create_chat_agent_message`, `_emit_contacts_turn_result`) |
| State | `session_store.py` (`public_state`) |

---

## 7. Reply generation (how assistant text is produced)

### 7.1 Create campaign (`create_campaign/agent.py`)

1. **Tool loop** (`run_tool_loop`) with `CORE_TOOLS` or hub `HUB_TOOLS`.
2. Each tool result JSON appended for next LLM round (`tool_result_for_llm`).
3. **Mid-turn** `_emit_state` for `_STATE_TOOLS` so overview updates before reply finishes.
4. Final model text → sanitize:
   - `sanitize_user_facing_reply`, `strip_inline_template_from_reply`
   - If empty/leaked internal text → `_fact_reply_from_tools`
5. Persist transcript; **`_emit_state`** again at end.
6. **`_emit_create_chat_agent_message`**: re-emit collected `ui_events`, then **`agent_message`** with HTML.

### 7.2 Contacts (`_emit_contacts_turn_result`)

1. Reconcile view/update session flags.
2. **`state_update`** with fresh `public_state`.
3. Each **`ui_event`** (`draft_updated`, `contact_candidates`, `contact_created`, …).
4. **`agent_message`** with domain/executor HTML reply.

### 7.3 Shared socket events (FE)

| Event | Typical payload | UI effect |
|---|---|---|
| `session_ready` | `state`, `messages`, `module` | Hydrate chat + panel |
| `state_update` | `state: CampaignAgentState` | Overview / draft sync |
| `ui_event` | `type`, `payload` | Templates, images, navigate, draft_updated, … |
| `agent_message` | `text`, optional `analytics`, `suggestions` | Left chat bubble |
| `agent_typing` / `thinking_progress` | busy flags | Composer state |
| `turn_complete` | — | End turn |

---

## 8. Clear steps — what each Campaign agent does

Primary reference for labeling traces. Format: **job**, **when it starts**, **steps**, **tools**, **right panel**, **FT collect**.

---

### 8.1 Creation — Create Campaign (intake / strategist)

**Product name:** Create Campaign Agent  
**MAS:** Super → **creation** domain → executors (`brief_validation`, `campaign_audience`, `campaign_content`, `launch_scheduling`)  
**Legacy module:** `create_campaign`  
**Right panel:** `CampaignGuidedPreview` (Campaign overview)

**When it starts:** User opens `/campaigns/create/{draftId}` or lands from hub `OPEN_HUB_DESTINATION` → create space.

**Conversational gates (domain playbook — flexible order, fixed requirements):**

1. **Meta** — name, goal, objective → **`update_campaign_setup`** (partial OK).
2. **Channels** — user must explicitly confirm channels this turn → `channels` + `channels_confirmed=true`. Never default to email only.
3. **Templates** — after channels + user generate intent → **`build_campaign`** (`user_confirmed=true`). Emits `template_progress`, `templates_ready`.
4. **Audience** — named people → **`check_contacts`**; segments → **`update_campaign_setup`** `audience_text`; sheet → **`upload_temporary_contacts`**. Required before **launch**, not before templates.
5. **Launch** — explicit confirm → **`launch_campaign`** (`confirmed=true`, schedule fields).

**Steps on user field correction:**

1. User says “change goal to …” / “drop WhatsApp”.
2. LLM calls **`update_campaign_setup`** with only changed fields + required `change_summary`.
3. Handler persists session → **`state_update`** mid-turn.
4. FE overview row updates immediately; LLM HTML explains in same turn.

**Tools (core — offered to LLM):**

| Tool | Call when | Right panel / UI |
|---|---|---|
| `update_campaign_setup` | Meta, channels, audience_text, orchestration patches | Overview rows via `state_update` |
| `check_contacts` | Named emails/phones/names | Audience row |
| `create_contact` | Missing person during campaign setup | Audience refresh |
| `update_contact` | Fix email/phone on existing audience contact | Audience refresh |
| `upload_temporary_contacts` | Session-only sheet | Audience |
| `build_campaign` | Generate/regenerate templates | Template count + left cards |
| `launch_campaign` | User confirmed send/schedule | Launch row |
| `plan_campaign_images` | Hero/banner planning (setup) | Images on cards (ui_event) |

**Hub home only:** `OPEN_HUB_DESTINATION` → navigate ui_event (recommendations, drafts, templates, reports).

**Collect for FT:** partial `update_campaign_setup` args; `channels_confirmed` discipline; mid-turn `state_update` before `agent_message`; full launch confirm sequence.

Skill playbooks: `mas/skills/create_campaign/campaign_brief.md`, `campaign_audience.md`, `campaign_templates.md`, `campaign_launch.md`.

---

### 8.2 Audience — Contacts / CRM

**Product name:** Contacts / Audience Agent  
**MAS:** Super → **audience** domain → **`contact`** executor (+ selection/pull)  
**Legacy module:** `contacts`  
**Right panel:** `list` | `create` (`ContactGuidedPreview`) | `detail` | `matches`

**When it starts:** `/audience/*`, or `route_to_module` / handoff with `module=contacts`.

**Steps — create (skill: `contact_creation`):**

1. On create intent → **`SET_DRAFT_FIELDS`** `mode=create` (+ `reset_draft=true` if leaving open profile) → **`draft_updated`** opens create panel.
2. Ask **one field at a time** (first name → last name optional → email → phone → company/city per pack).
3. Every answer → **`SET_DRAFT_FIELDS`** merge structured args → **`draft_updated`** + **`state_update`**.
4. After new email/phone → **`GET_CONTACT_DETAIL`** / lookup chain; duplicate during create **stays on create** with candidates strip.
5. When first name + (email or phone) → summarize → user confirms → **`CREATE_SINGLE_CONTACT`** `user_confirmed=true`.
6. Success → **`contact_created`** → FE opens detail, refreshes list.

**Steps — update:**

1. Focus contact (`GET_CONTACT` / view tools) → `mode=update`.
2. **`SET_DRAFT_FIELDS`** for each change.
3. Confirm → **`UPDATE_SINGLE_CONTACT`**.

**Steps — view / search:**

1. **`VIEW_CONTACT`** / **`QUERY_CONTACTS`** / **`CONTACT_VIEW_AND_DOWNLOAD`**.
2. One match → detail; many → **matches** pane.

**Patch tool detail — `SET_DRAFT_FIELDS`:**

- `mode`: `create` | `update`
- `reset_draft`: leave open profile for new create
- Fields: `first_name`, `last_name`, `full_name` (two-part only), `email`, `phone`, company, city, push fields, `skip_field`, clears
- Emits **`draft_updated`** payload via `_draft_ui_payload` (draft_contact, focus_contact_id, mode, extras)

**Collect for FT:** open panel before first question; duplicate-email during create; confirm→create same turn; no FE intent parsing.

Skill playbooks: `mas/skills/contacts/contact_creation.md`, `contact_update.md`, `contact_view.md`.

---

### 8.3 Optimization — Monitoring

**Product name:** Monitoring Agent  
**MAS:** Super → **optimization** → **`monitoring`** executor  
**Module:** `monitoring`  
**Right panel:** Campaign monitor list / detail (page chrome)

**When it starts:** Campaign monitor surfaces or routed from another module.

**Steps:**

1. List campaigns → **`LIST_MONITOR_CAMPAIGNS`** (bucket, date filters, paging).
2. Report for one campaign → **`GET_CAMPAIGN_REPORT`**.
3. “Who received?” → **`GET_CAMPAIGN_AUDIENCE`**.
4. Pause channel → **`STOP_CHANNEL`** (campaign_id, channel, **reason**).
5. Resume → **`RESUME_CHANNEL`**.
6. Stop whole campaign → **`STOP_CAMPAIGN`** (reason on second call).
7. Email A/B → **`PICK_AB_WINNER`**.
8. Wrong module → **`ROUTE_TO_MODULE`** alone.

**Collect for FT:** tool-before-answer; two-step stop with reason; no invented counts.

Skill: `mas/skills/monitoring/monitor_list.md`, `monitor_report.md`, `monitor_recovery.md`, `monitor_ab.md`.

---

### 8.4 Optimization — Reports / Dashboard analytics

**Product name:** Reports Agent  
**MAS:** Super → **optimization** → **`analytics`** executor  
**Module:** `reports` (includes **Dashboard** co-worker chat)  
**Right panel:** Dashboard Overview KPIs (HTTP) + optional analytics cards in chat

**When it starts:** Reports workspace or Dashboard home co-worker.

**Steps:**

1. Classify intent: **ontology** (themes, relationships) vs **KPI/metrics** vs **campaign list** vs **ops** (stop/pause).
2. Ontology → **`ask_ontology`** — not for open/click rates.
3. KPIs → **`query_analytics`** (preferred) or **`ask_semantic_layer`**.
4. Campaign list/compare → **`LIST_MONITOR_CAMPAIGNS`**.
5. One campaign → **`GET_CAMPAIGN_REPORT`** / **`GET_CAMPAIGN_AUDIENCE`**.
6. Events → **`LIST_EVENTS`**, **`GET_EVENT_DETAIL`**.
7. Stop/pause from reports chat → same ops tools as monitoring.
8. Create/audience request → **`ROUTE_TO_MODULE`**.

**Collect for FT:** correct ontology vs KPI path; grounded numbers; no SQL/tool names in user HTML.

Skills: `mas/skills/reports/report_kpis.md`, `report_ontology.md`, `report_campaigns.md`, `events_report.md`.

---

### 8.5 Creation — Recommendations

**Product name:** Recommendations Agent  
**MAS:** creation → **`recommendation`** executor  
**Module:** `recommendations`

**Steps:**

1. If past campaigns missing → **`LOAD_PAST_CAMPAIGNS`**.
2. Generate board cards → **`GENERATE_RECOMMENDATIONS`** (title, goal, channels, why_created, …).
3. User picks card → navigate to **recommendation_run** (separate domain session).

**Collect for FT:** load-before-generate; empty board when appropriate.

---

### 8.6 Creation — Recommendation run & Library run

**Product name:** Run selected recommendation / Use library templates  
**MAS domains:** `recommendation_run`, `library_run`  
**Modules:** `recommendation_run`, `library_run`  
**Right panel:** Same **Campaign overview** as create (often `hiddenKeys: ['templates']` on rec run).

**Steps:** Shared executors as creation — brief → audience → content → launch — with **prefilled** card or library baseline in session context.

Skills: `mas/skills/library_run/*.md`.

---

### 8.7 Forms

**Product name:** Forms Agent  
**MAS:** **forms** domain → theme / fields / design executors  
**Module:** `forms`

**Steps:**

1. Theme-only → **`RUN_THEME_SPECIALIST`**.
2. Fields/copy → **`RUN_FIELDS_SPECIALIST`**.
3. Full redesign → **`RUN_DESIGN_SPECIALIST`**.
4. Promote to campaign → **`ROUTE_TO_CREATE_CAMPAIGN`** (`user_confirmed` when explicit).
5. Other module → **`ROUTE_TO_MODULE`**.

**Rule:** Do not mix specialist + route in same turn.

---

### 8.8 Content — WhatsApp Approved / Rejected

**Modules:** `whatsapp_approved`, `whatsapp_rejected`  
**MAS:** content domain executors

**Approved — steps:**

1. **`SET_AUDIENCE`** or **`FILTER_CONTACTS`** when recipients named.
2. User confirms → **`SEND_APPROVED_TEMPLATE`** `user_confirmed=true`.

**Rejected — steps:**

1. User revises copy → **`SET_TEMPLATE_FIELDS`** (ui_event to editor).
2. Confirm → **`SUBMIT_FOR_APPROVAL`** `user_confirmed=true`.

---

### 8.9 Content — Template generation & coach (non-chat-module workers)

| Worker | Job | Called from |
|---|---|---|
| Channel writers (email, WA, web push, app push) | Produce template cards | `build_campaign`, library, on-demand |
| Template Generation Director | Archetype, validation, regen report | Template pipeline |
| Template Coach | Manual edit assist JSON patches | Template edit UI |

Not full SPA chat modules — traces are often **sub-episodes** inside `build_campaign` ui_events.

---

### 8.10 Image domain

**MAS:** Super → **image** → `image_generate` | `image_refine` | `image_attach`

**Hard rule:** **`ENHANCE_IMAGE_PROMPT`** before Gemini generate/refine — raw user chat never hits image API alone.

**UI:** `image_generated`, `template_image_attached`, `template_fields_updated` ui_events → timeline card fields.

---

### 8.11 Hub Super & On-Demand (autonomous)

**Hub Super:** sequential skills — **contacts** → **on_demand** → **monitoring** — no clarifying questions.

| Hub intent | Pipeline |
|---|---|
| `on_demand_send` | on_demand: analyze → audience → templates → launch |
| `create_contact` | contacts create |
| `stop_channel` / `resume_channel` / `campaign_report` | monitoring ops |

**On-demand:** same pipeline without SPA chat; A2A skill **`on-demand-send`**.

**Collect for FT:** structured failures; no `needs_clarification`; full tool traces for Hub payloads.

---

## 9. Agent ↔ tools catalog (quick reference)

### 9.1 Create campaign (core tools)

| Tool | Purpose |
|---|---|
| `update_campaign_setup` | Patch overview: meta, channels, audience_text, orchestration |
| `check_contacts` | Lookup named recipients for campaign audience |
| `create_contact` | Add missing CRM contact from create flow |
| `update_contact` | Fix contact fields during create flow |
| `upload_temporary_contacts` | Session-only audience rows |
| `build_campaign` | Generate/regenerate template cards |
| `launch_campaign` | Launch or schedule after confirm |
| `plan_campaign_images` | Image plan during setup |
| `OPEN_HUB_DESTINATION` | Hub navigate only |

### 9.2 Contacts (LLM-facing subset)

| Tool | Purpose |
|---|---|
| `SET_DRAFT_FIELDS` | **Panel sync** — merge draft; open create/update |
| `GET_CONTACT_DETAIL` | Load/focus; duplicate check on email/phone |
| `VIEW_CONTACT` | View one contact |
| `QUERY_CONTACTS` / `CONTACT_VIEW_AND_DOWNLOAD` | Search/list/filter |
| `CREATE_SINGLE_CONTACT` | Persist create after confirm |
| `CREATE_BULK_CONTACT` | Sheet import |
| `UPDATE_SINGLE_CONTACT` / `UPDATE_BULK_CONTACT` | Persist updates |
| `ROUTE_TO_MODULE` | Leave audience module |

Extended handlers (advanced): `LOOKUP_CONTACT`, `GET_CONTACT`, `IMPORT_CONTACTS`, pack rule tools, delete flow — see **§17** below.

### 9.3 Monitoring / Reports (shared ops + analytics)

| Tool | Purpose |
|---|---|
| `LIST_MONITOR_CAMPAIGNS` | Paged campaign buckets |
| `GET_CAMPAIGN_REPORT` | Per-channel metrics |
| `GET_CAMPAIGN_AUDIENCE` | Per-contact outcomes |
| `STOP_CHANNEL` / `RESUME_CHANNEL` / `STOP_CAMPAIGN` | Ops mutations |
| `PICK_AB_WINNER` | Email A/B |
| `ask_ontology` | Graph / theme questions |
| `query_analytics` / `ask_semantic_layer` | KPI metrics |
| `LIST_EVENTS` / `GET_EVENT_DETAIL` | Events snapshot |
| `ROUTE_TO_MODULE` | Cross-module handoff |

### 9.4 Shared routing

| Tool | Purpose |
|---|---|
| `ROUTE_TO_MODULE` | SPA module handoff — **call alone** that turn |
| `route_to_domain` | Super MAS — pick domain (internal) |
| `invoke_executor` | Domain MAS — pick executor (internal) |

---

## 10. Tool schemas (patch tools — fine-tuning critical)

Source of truth: `agents/app/agents/create_campaign/tools.py`, `agents/app/agents/contacts/tools/schemas.py`.

### 10.1 `update_campaign_setup`

| Arg | Type | Notes |
|---|---|---|
| **`change_summary`** | string | **Required** — internal log only |
| `name`, `goal`, `objective` | string | Meta patches |
| `channels` | enum[] | `email`, `whatsapp`, `web`, `push` — full list when changing |
| **`channels_confirmed`** | bool | **Required true** when passing `channels` |
| `audience_text` | string | CRM segment wording — not named individuals |
| `orchestration_mode` | enum | `prefer_primary`, `staggered`, `broadcast` |
| `primary_channel`, `whatsapp_retry`, `strategy_*`, `templates_finalized` | various | Setup flags |

**When called:** User provides or **corrects** overview fields; LLM passes **only** changing keys.

### 10.2 `SET_DRAFT_FIELDS`

| Arg | Type | Notes |
|---|---|---|
| **`mode`** | `create` \| `update` | Open panel / keep mode |
| **`reset_draft`** | bool | New create while profile open |
| `first_name`, `last_name`, `full_name` | string | `full_name` only for two-part names |
| `email`, `phone`, … | string | Channel: email **or** phone sufficient |
| `skip_field` | string | e.g. `last_name`, `email` |
| `clear_city`, `clear_company` | bool | Explicit clears |
| Push fields | string | App/web push phase |

**When called:** Every user field answer or **correction**; first create turn may be empty fields + `mode=create` only.

### 10.3 Confirmation gates (representative)

| Tool | Confirm arg |
|---|---|
| `build_campaign` | `user_confirmed=true` |
| `launch_campaign` | `confirmed=true` (+ schedule / broadcast flags) |
| `CREATE_SINGLE_CONTACT` | `user_confirmed=true` |
| `UPDATE_SINGLE_CONTACT` | confirm in handler flow |
| `SEND_APPROVED_TEMPLATE` | `user_confirmed=true` |
| `SUBMIT_FOR_APPROVAL` | `user_confirmed=true` |
| `OPEN_HUB_DESTINATION` | `confirmed=true` |

---

## 11. What a single “agent conversation” looks like

Treat **one user query → final assistant answer** as an **episode** (may span Super → Domain → Executor or `ROUTE_TO_MODULE`).

### 11.1 Episode structure (recommended)

```text
episode_id
product_spoke: worktual_campaign
product: create_campaign | contacts | monitoring | reports | forms | hub | …
mas_layer: super | domain | executor | legacy
cc_agent_name equivalent: campaign_agent_name  e.g. "Create Campaign", "Audience Contact", "Reports Analytics"
module: socket module string
session_id
messages[]: system, user, assistant+tool_calls, tool results, …
routing[]: super→domain, domain→executor, ROUTE_TO_MODULE
tools[]: name, args (redacted), ok, latency_ms
ui_events[]: type, payload summary
state_snapshots[]: optional public_state after state_update
outcome: final_text, panel mode, navigation
labels: success | bad_tool | bad_routing | policy_violation
```

### 11.2 Example — patch overview mid-turn (create)

```text
User: "Change the goal to win-back"

assistant tool_call: update_campaign_setup({ goal: "win-back", change_summary: "…" })
tool result: { ok: true, … }
→ socket state_update (FE overview Goal row updates)
assistant: "<p>Updated the goal to win-back.</p>"
→ agent_message
```

### 11.3 Example — contact field correction

```text
User: "email should be priya@acme.com"

assistant tool_call: SET_DRAFT_FIELDS({ email: "priya@acme.com" })
tool result: { ui_event: draft_updated, … }
→ state_update + draft_updated (FE ContactGuidedPreview)
assistant: "<p>Got it — I updated the email.</p>"
```

Collect **tool rows and state_update timing**, not only final HTML.

---

## 12. Data collection requirements for fine-tuning

### 12.1 Must capture

| Field | Why |
|---|---|
| `module` + MAS domain/executor | Attribution |
| Full tool name + args (redacted) | Tool-calling SFT |
| Tool result summary | Grounding |
| `state_update` / `draft_updated` timing vs `agent_message` | Panel sync FT |
| `ui_event` types (`templates_ready`, `navigate`, …) | Multimodal UI FT |
| Prompt / skill version ids | Reproducibility |
| Patch-only tool args | Partial update behavior |
| Confirmation turns | `user_confirmed` / `confirmed` |

### 12.2 Strongly recommended labels

- **Routing:** correct domain/executor vs wrong
- **Patch quality:** partial args correct vs over-wrote unrelated fields
- **Workflow:** create panel opened before ask vs forgot SET_DRAFT_FIELDS
- **Channel policy:** invented email-only vs explicit channels_confirmed
- **Grounding:** claims match tool result vs hallucinated launch/create

### 12.3 Redaction

Remove/hash: tokens, raw PII when not needed for learning, full contact sheets, API secrets. Keep tool names, arg **shapes**, ok/fail, counts.

### 12.4 Suggested dataset splits

1. `campaign_create_sft` — update_campaign_setup + build + launch traces  
2. `campaign_contacts_sft` — SET_DRAFT_FIELDS loops + create/update  
3. `campaign_monitoring_sft` — ops tools  
4. `campaign_reports_sft` — ontology vs query_analytics  
5. `campaign_hub_autonomous_sft` — on-demand + Hub skills (no clarification)  
6. `campaign_router_sft` — Super route_to_domain only  
7. `campaign_panel_sync_sft` — state_update / draft_updated adjacent to tool calls  

---

## 13. Suggested export schema (JSONL)

```json
{
  "episode_id": "uuid",
  "product_spoke": "worktual_campaign",
  "module": "create_campaign",
  "mas": {
    "super_domain": "creation",
    "executor": "brief_validation",
    "skill": "campaign_brief"
  },
  "campaign_agent_name": "Create Campaign",
  "context": {
    "session_id": "…",
    "draft_id": "…",
    "hub_mode": false
  },
  "messages": [
    {"role": "user", "content": "Change goal to win-back"},
    {
      "role": "assistant",
      "tool_calls": [
        {
          "name": "update_campaign_setup",
          "arguments": {"goal": "win-back", "change_summary": "user correction"}
        }
      ]
    },
    {"role": "tool", "name": "update_campaign_setup", "content": "{\"ok\":true}"},
    {"role": "assistant", "content": "<p>Updated the goal to win-back.</p>"}
  ],
  "socket_order": ["state_update", "agent_message"],
  "ui_events": [],
  "labels": {"patch": "correct", "grounding": "good"}
}
```

---

## 14. Sampling guidance

**Prioritize:**

1. Partial `update_campaign_setup` / `SET_DRAFT_FIELDS` corrections  
2. Full create-campaign journeys with mid-turn overview updates  
3. Contact create with duplicate email during create (stay on panel)  
4. Channel confirm discipline (`channels_confirmed`)  
5. Launch/build with explicit confirm args  
6. Reports ontology vs KPI disambiguation  
7. Monitoring stop/resume two-step reason  
8. Hub on-demand failures (structured, no clarify)  
9. Human-revised bad traces (gold)

**Avoid overweighting:** pure chitchat with no tools; navigate-only turns without domain work.

---

## 15. Source code map

| Area | Path |
|---|---|
| Socket server | `agents/app/socket_server.py` |
| Session public state | `agents/app/session_store.py` |
| MAS invoke / sticky / Hub | `agents/app/mas/runtime/invoke.py` |
| MAS catalog | `agents/app/mas/catalog.py` |
| Super agent prompt | `agents/app/mas/super_agent/agent.md` |
| Domain prompts | `agents/app/mas/domains/*/agent.md` |
| Executor prompts | `agents/app/mas/executors/*/agent.md` |
| Skills (step playbooks) | `agents/app/mas/skills/**/*.md` |
| Create campaign agent | `agents/app/agents/create_campaign/agent.py` |
| Create campaign tools | `agents/app/agents/create_campaign/tools.py`, `tool_functions.py` |
| Contacts handlers | `agents/app/agents/contacts/tools/handlers.py`, `schemas.py` |
| Contacts draft merge | `agents/app/agents/contacts/draft_ingest.py` |
| FE create chat | `frontend/src/components/campaigns/CreateCampaignChatWorkspace.tsx` |
| FE overview UI | `frontend/src/components/campaigns/CampaignGuidedPreview.tsx` |
| FE audience hub | `frontend/src/components/contacts/AudienceWorkspace.tsx` |
| FE dashboard | `frontend/src/components/dashboard/DashboardWorkspace.tsx` |
| MAS architecture (ops/flags) | `docs/MAS_ARCHITECTURE.md` |
| Runtime workflow snippets | `docs/campaign-agent-runtime/workflow/*.md` |

---

## 16. Checklist for FT / data pipeline owners

- [ ] Tag every episode with `product_spoke=worktual_campaign` and `module`
- [ ] Tag MAS layer (super / domain / executor) when MAS enabled
- [ ] Export full tool traces including **patch-only** args
- [ ] Export **`state_update` / `draft_updated`** relative to `agent_message`
- [ ] Export create-campaign **overview sync** episodes separately
- [ ] Export contacts **SET_DRAFT_FIELDS** multi-turn loops (not only CREATE)
- [ ] Export Hub autonomous traces without fake clarification turns
- [ ] Redact PII/secrets before export
- [ ] Store prompt/skill version on each episode
- [ ] Label routing, patch quality, confirmation policy
- [ ] Reject traces missing tool results after `tool_calls`
- [ ] Track `channels_confirmed` and `user_confirmed` on mutation tools

---

## 17. Complete tool catalog (every agent — purpose + what it does)

### 17.1 Create Campaign — create space tools

| Tool | Purpose | What it does |
|------|---------|--------------|
| `update_campaign_setup` | Save/change overview fields | Persists only fields passed this turn: name, goal, objective, full channels list, audience_text, orchestration_mode, primary_channel, whatsapp_retry, strategy flags. Complete channels list required when changing channels. Segments via audience_text; named people via check_contacts. |
| `check_contacts` | Verify named people exist | Lookup by emails/phones/names; found → campaign audience; missing → emails_missing/phones_missing; typo hints (gmai.com → gmail.com). |
| `create_contact` | Create CRM contact from create chat | first_name + email or phone; user_confirmed=true; refreshes audience. Prefer update if identity already exists with different fields. |
| `upload_temporary_contacts` | Session-only sheet audience | Parsed rows; each needs email or phone; temporary for this launch only. |
| `update_contact` | Fix existing contact in create flow | Resolve by contact_id / match_email / match_phone; only changed fields; user_confirmed. |
| `build_campaign` | Generate/regenerate templates | mode create\|regenerate; user_confirmed=true; does not launch. |
| `launch_campaign` | Launch or schedule | confirmed=true; schedule_mode now\|at; orchestration; blocks if audience/templates missing; WA submits to Meta first. |
| `plan_campaign_images` | Hero/banner planning | Setup-time image plan (not full build). |
| `OPEN_HUB_DESTINATION` | Hub navigate | destinations: recommendations, templates, drafts, whatsapp_approvals, create_space, open_draft, reports; confirmed=true. |

**Legacy (not offered by default):** `select_audience`, `set_channels`, `update_campaign_meta`, `present_campaign_summary`.

### 17.2 Contacts / Audience tools

| Tool | Purpose | What it does |
|------|---------|--------------|
| `SET_DRAFT_FIELDS` | Panel sync | Merge draft fields; mode=create opens panel (even empty); mode=update edits open contact; full_name splits; email OR phone channel. |
| `GET_CONTACT_DETAIL` | Load/focus by any id | email/phone/WA/name as input_field → detail/focus. |
| `CONTACT_VIEW_AND_DOWNLOAD` | NL list/filter | query → counts + short sample. |
| `CREATE_SINGLE_CONTACT` | Persist one create | firstName + email/phone/WA; user_confirmed. |
| `CREATE_BULK_CONTACT` | Sheet import | fileUrl and/or rows; isTemp permanent vs temp. |
| `UPDATE_SINGLE_CONTACT` | Persist one update | Requires id; only changing fields. |
| `UPDATE_BULK_CONTACT` | Bulk update from sheet | fileUrl/rows. |
| `ROUTE_TO_MODULE` | Leave Audience | Call alone; module + query. |
| `LOOKUP_CONTACT` | Exists-check | email/phone/name → candidates. |
| `GET_CONTACT` | Load by id | Into draft/focus. |
| `SEARCH_CONTACTS` | Filter | city/company/title/has_email/phone/search. |
| `VERIFY_FOCUS_IDENTITY` | Confirm identity before sensitive update | |
| `CREATE_CONTACT` / `UPDATE_CONTACT` | Classic create/update | user_confirmed; hard gate first_name + email\|phone. |
| `REQUEST_DELETE` / `CONFIRM_DELETE` | Delete flow | Pending then confirm/cancel. |
| `IMPORT_CONTACTS` | CCUIA bulk | dry_run, upsert, consent. |
| Pack tools | Company pack rules/fields | GET/ADD/UPDATE/DELETE_COMPANY_RULE, UPSERT/CONFIRM/DELETE_PACK_FIELD. |

### 17.3 Monitoring tools

| Tool | Purpose |
|------|---------|
| `LIST_MONITOR_CAMPAIGNS` | bucket live/scheduled/past/draft/all; date filters; paging |
| `GET_CAMPAIGN_REPORT` | per-channel sent/failed/stub/pause |
| `GET_CAMPAIGN_AUDIENCE` | outcomes: sent/stub/failed/skipped/pending |
| `STOP_CAMPAIGN` | whole campaign; reason required to execute |
| `STOP_CHANNEL` | pause one channel; campaign_id + channel + reason |
| `RESUME_CHANNEL` | resume paused channel |
| `PICK_AB_WINNER` | email A/B a\|b or auto; force early |
| `ROUTE_TO_MODULE` | leave monitoring |

### 17.4 Reports / Events tools

| Tool | Purpose |
|------|---------|
| `ask_ontology` | themes / relationships — **not** open/click rates |
| `query_analytics` | KPIs: open/click/delivery/sent/live counts |
| `ask_semantic_layer` | low-level semantic KPI gateway |
| `LIST_MONITOR_CAMPAIGNS` | same as monitoring + name_contains |
| `GET_CAMPAIGN_REPORT` / `GET_CAMPAIGN_AUDIENCE` | same ops report tools |
| `STOP_*` / `RESUME_CHANNEL` | ops from reports chat |
| `LIST_EVENTS` / `GET_EVENT_DETAIL` | event snapshot list/detail |
| `ROUTE_TO_MODULE` | leave reports |

### 17.5 Recommendations

| Tool | Purpose |
|------|---------|
| `LOAD_PAST_CAMPAIGNS` | load completed campaigns before generate |
| `GENERATE_RECOMMENDATIONS` | board cards (title, goal, channels, why_created, …) |
| `ROUTE_TO_MODULE` | open create / other |

### 17.6 Forms

| Tool | Purpose |
|------|---------|
| `RUN_THEME_SPECIALIST` | colors/logo/spacing only |
| `RUN_FIELDS_SPECIALIST` | add/remove/rename fields + copy |
| `RUN_DESIGN_SPECIALIST` | full redesign |
| `ROUTE_TO_CREATE_CAMPAIGN` | promote form → create; user_confirmed |
| `ROUTE_TO_MODULE` | other destinations |

### 17.7 WhatsApp Approved / Rejected

| Tool | Purpose |
|------|---------|
| `SET_AUDIENCE` | phones and/or contact_ids; replace\|add |
| `FILTER_CONTACTS` | find by name/email/phone → audience |
| `SEND_APPROVED_TEMPLATE` | Meta send; user_confirmed; optional body_params |
| `SET_TEMPLATE_FIELDS` | rejected draft name/header/body/footer/buttons + ui_event |
| `SUBMIT_FOR_APPROVAL` | new unique name + Meta submit; user_confirmed |

### 17.8 Template workers (not SPA chat modules)

| Worker | Purpose |
|--------|---------|
| Email / WA / web push / app push writers | Channel card copy |
| Template Generation Director | Archetype, validation, regen report |
| Template Coach | Manual edit assist JSON patches |

### 17.9 On-Demand + Hub Super + A2A

**On-demand pipeline:** analyze request → resolve audience identity → generate templates → create+launch (no clarify).

**Hub skills:** on_demand, contacts, monitoring — sequential only; missing fields → structured `failed`.

**A2A skill ids:** `on-demand-send`, `create-contact`, `campaign-report`, `stop-channel`, `resume-channel`, `stop-campaign`, `create-contact-and-send`.

### 17.10 User need → agent

| Need | Agent |
|------|-------|
| Create a campaign | Create Campaign |
| Add/fix contact (Audience) | Contacts |
| Add contact while creating campaign | Create Campaign (`create_contact` / `update_contact`) |
| How is campaign Y / pause channel | Monitoring or Reports |
| Open rates / past similar campaigns | Reports |
| Suggest next campaigns | Recommendations |
| Change form colors/fields | Forms |
| Send approved WA template | WhatsApp Approved |
| Meta rejected template | WhatsApp Rejected |
| Hub: send nurture now | On-Demand via Hub Super / A2A |
| Hub: create contact then email | Hub Super multi-skill |

### 17.11 Principles (all agents)

1. Tools change state; chat explains. Never claim success the tool did not return.  
2. No chat-intent regex — LLM + explicit tool args.  
3. Email validation in tools, not free-form guessing.  
4. Contact hard gate: first_name + (email OR phone).  
5. Hub autonomy: never ask Hub clarifying questions.  
6. Channel ids: `email`, `whatsapp`, `web` (web push), `push` (app push).

---

**Document owner:** Campaign agents platform  
**Consumers:** LLM fine-tuning team, conversation data engineering, agent authors  

**Use this file only.** Do not maintain parallel agent/tool docs — update this guide instead.
