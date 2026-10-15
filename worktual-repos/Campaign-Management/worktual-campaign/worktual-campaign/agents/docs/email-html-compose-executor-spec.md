# Email HTML Compose — MAS executor spec (handoff)

**Status:** Implemented — see `app/mas/executors/email_html_compose/` + Phase 2 knowledge/brand.  
**Audience:** Engineers extending Option A / Phase 2 inputs.  
**Scope:** **Email create/regenerate only.** WhatsApp, web push, app push, launch, View/edit unchanged. Gemini images deferred.

---

## 1. Goal

Replace the clunky path (Creation domain → `build_campaign` → `creation_agent` → plugin → Phase 2) with a **dedicated MAS executor** that:

1. Receives **structured inputs** from the Creation domain / `campaign_content` (including the user’s **idea**).
2. Runs the **existing Phase 2 compose package** (`app/mas/phase2_compose/`) **without changing its prompts**.
3. Returns a **complete email template card** (HTML + metadata) for persistence and FE **View** cards.

---

## 2. Product rules (must hold)

| Rule | Meaning |
|------|--------|
| **Pass the idea** | Main domain sends campaign idea / objective / user request explicitly. No separate “information enhancer” or Template Director **before** email HTML generation. |
| **No pre-layout enhancement** | Do **not** run the old email **design/layout** pipeline (Template Director, section director, style plan) ahead of this executor. |
| **Content may be enhanced inside Phase 2** | Phase 2’s own **plan → compose** steps may refine **copy/content** from the idea. That is allowed; it uses **existing Phase 2 prompts**, not new pre-steps. |
| **Prompts frozen** | Phase 2 plan/compose prompts stay frozen **except** product-requested CTA rules: no invented buttons when knowledge has no landing URL. |
| **Regenerate** | Always mint a **new** `template_id`; set `prior_template_id` when replacing. FE timeline dedupes by id. |
| **Other channels** | `build_campaign` / `creation_agent` continues to handle non-email channels exactly as today. |

---

## 3. Architecture (Option A)

```text
Creation domain (LLM)
  └─ invoke_executor → campaign_content (unchanged role: persist, multi-channel orchestration)
       ├─ email channel  → NEW: email_html_compose executor → Phase 2 TemplateDomain
       └─ other channels → existing creation_agent / channel agents (unchanged)

After email card returned:
  campaign_content / build_campaign → create_templates_batch → templates_ready → FE View card
```

**New artifact (suggested names):**

- Executor id: `email_html_compose` (or `email_template_compose`)
- Package: `agents/app/mas/executors/email_html_compose/` with `runner.py`, `agent.md`
- Registry: register like `campaign_content`, `campaign_images`
- Creation domain / skills: map email template generate/regenerate to this executor when channel includes email (LLM still chooses via `invoke_executor`; no regex intent).

**Reuse (do not reimplement):**

- `app.mas.phase2_compose.plugin.run_phase2_email_create`
- `app.mas.phase2_compose.domain.TemplateDomain`
- `app.mas.phase2_compose.plugin.email_card_from_compose_result`
- Backend save gate: email must pass `fieldsPassQuality` with **`compiled_html` + `subject`** (`backend/src/helpers/template-html.ts` — already updated for compose pipeline).

---

## 4. Input contract (executor receives)

The main domain / `campaign_content` should pass a **single structured payload** (via `task_spec` + `ctx`), not an oversized raw chat dump.

### 4.1 Required

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string | Agent session / draft id |
| `token` | string | Auth for TS API persist (if executor persists; prefer handoff back to `build_campaign` for persist) |
| `idea` | string | User/campaign **idea** — primary creative input (objective, launch concept, “idea 2”, etc.) |
| `user_request` | string | Verbatim user message for this generate/regenerate turn |
| `campaign` | object | At minimum: `name`, `goal`, `objective` |
| `channel_plan` | object | Per-email plan slice: `channel: "email"`, optional `how_it_works`, `suggested_launch_at` |

### 4.2 Recommended

| Field | Type | Description |
|-------|------|-------------|
| `chat_summary` | string | Short memory summary (clip ~2500 chars — see plugin `_MAX_CHAT_SUMMARY_CHARS`) |
| `audience_summary` | object | Count, sample names/emails — for personalization in Phase 2 query only |
| `knowledge` | string | Verified KB snippet if any (optional; KB not required for v1) |
| `prior_template` | object \| null | On regenerate: `{ template_id, fields? }` — **do not reuse** `template_id` on output |
| `event_callback` | async fn | Forward for `template_progress` during long compose |

### 4.3 Explicitly omit (no pre-enhancement)

Do **not** pass or require before calling this executor:

- `creative_brief`, `design_plan`, `pattern_id`, director `sections[]` layout plan
- Template Director / `_run_email_designer` outputs
- Separate “layout enhancement” LLM step outside Phase 2

### 4.4 Internal query assembly

Executor (or thin adapter) builds Phase 2 `query` like today’s `_build_query()`:

1. `user_request` / `idea`
2. Campaign name, goal, objective
3. Optional clipped `chat_summary`
4. Optional `knowledge` (cap ~4000 chars)
5. Total query cap ~4500 chars (`_MAX_QUERY_CHARS`)

Phase 2 **plan** executor may still expand **content** inside the package; that is not “pre-enhancement” in the sense above.

---

## 5. Output contract (executor returns)

### 5.1 Success — one email template **card** (persist-ready)

Same shape as `email_card_from_compose_result()` + session batch expectations:

```json
{
  "ok": true,
  "action_status": "completed",
  "executor_id": "email_html_compose",
  "template": {
    "template_id": "<new uuid>",
    "prior_template_id": "<optional uuid on regenerate>",
    "channel": "email",
    "logo": "email",
    "launch_at": "<ISO8601>",
    "how_it_works": "<string from channel plan>",
    "generation_batch_id": "<optional; set by orchestrator if missing>",
    "fields": {
      "subject": "<non-empty string>",
      "preheader": "<string>",
      "compiled_html": "<full HTML; must include {{unsubscribe_url}} or plugin adds it>",
      "pipeline": "compose",
      "plan": { },
      "image_assets": [ ],
      "knowledge": { },
      "warnings": [ ],
      "header_image": "<optional url>",
      "image_url": "<optional url>"
    },
    "_generation_report": {
      "layers": { "compose": "completed" },
      "mas_trace": {
        "orchestrator": "phase2_compose",
        "status": "completed",
        "trace": [ ]
      },
      "pipeline": "compose"
    }
  }
}
```

**Persistence:** Caller (`build_campaign` / `tool_functions`) posts to  
`POST /api/channel-templates/session/{sessionId}/batch` with:

```json
{
  "templates": [
    {
      "template_id": "...",
      "channel": "email",
      "logo": "email",
      "launch_at": "...",
      "how_it_works": "...",
      "fields": { }
    }
  ],
  "generation_batch_id": "<uuid>"
}
```

Then emit UI event:

```json
{
  "type": "templates_ready",
  "payload": {
    "generation_batch_id": "<uuid>",
    "template_count": 1
  }
}
```

FE pulls session templates and appends **View** cards (`syncTemplatesReadyEvent`).

### 5.2 Failure

```json
{
  "ok": false,
  "action_status": "failed",
  "executor_id": "email_html_compose",
  "error": "<machine-readable code>",
  "message": "<user-safe short explanation>"
}
```

Do not claim success in domain LLM reply if `ok` is false or batch save returns empty `templates`.

### 5.3 Progress (optional but recommended)

Reuse existing `template_progress` payloads during Phase 2 steps (25–90%), via `event_callback` — see `plugin.run_phase2_email_create` and `dispatcher._phase2_progress`.

---

## 6. Wiring checklist (implementer)

- [x] Add `email_html_compose` executor package + register in MAS executor registry.
- [x] Creation domain `agent.md` / skills: email generate → prefer `email_html_compose` (or `campaign_content` delegates email leg only).
- [x] `build_campaign` / `creation_agent`: email channel calls `email_html_compose` helper → Phase 2.
- [x] Comment (do not delete) old email path in `creation_agent._run_channel_agent` for revert.
- [x] `PHASE2_EMAIL_COMPOSE_ENABLED` remains documented; email path is always Phase 2 via executor helper.
- [x] Tests: executor returns card shape; regenerate new `template_id`; director not invoked; WA path unchanged.
- [x] Agents on `:8006` for Vite `/agents-socket` proxy.

**Also completed (Phase 2 package):** knowledge from campaign/`company_pack`; `brand_guidelines` recipe step (logo / top banner / footer). Gemini images still deferred (static URLs).

---

## 7. Out of scope

- Changing Phase 2 prompt text or recipe order.
- WhatsApp / web / app push template generation.
- Template View/edit agents (separate flows).
- New TypeScript business logic (thin persist routes only).
- Regex-based user intent parsing (LLM + tool args only).

---

## 8. Reference paths (repo)

| Area | Path |
|------|------|
| Phase 2 adapter | `agents/app/mas/phase2_compose/plugin.py` |
| Phase 2 domain | `agents/app/mas/phase2_compose/domain.py` |
| Phase 2 prompts | `agents/app/mas/phase2_compose/llm.py` |
| Multi-channel orchestrator | `agents/app/agents/template_library/creation_agent.py` |
| Persist + templates_ready | `agents/app/agents/create_campaign/tool_functions.py` |
| Email save quality | `backend/src/helpers/template-html.ts` (`compiled_html`) |
| FE cards | `frontend/src/lib/append-session-channel-templates.ts`, `CreateCampaignChatWorkspace.tsx` |
| Creation domain playbook | `agents/app/mas/domains/creation/agent.md` |

---

## 9. Revert

Git tag (if still present): `pre-phase2-email-compose`.  
Old email director + content path should remain **commented** in `creation_agent.py` until this executor is proven in production.
