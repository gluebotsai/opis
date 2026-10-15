# Contacts (Audience) module — agents, flow, and tools

Single reference for the Campaign Portal **Audience / Contacts** coworker: who routes, which skills run, which tools each layer may call, and how create / update / view move through chat + the right panel.

**Product surface:** `/audience` (`AudienceWorkspace.tsx`)  
**Socket module:** `contacts`  
**MAS domain:** `audience`  
**Intent rule:** LLM-only routing and replies — no regex/phrase maps for chat intent. Email/phone format checks are allowed before tools.

---

## 1. Agent stack (who does what)

```
User (Audience chat)
        │
        ▼
Socket.IO  module=contacts  (join_session / user_message)
        │
        ▼
┌───────────────────────┐
│ Campaign Super Agent  │  agents/app/mas/super_agent/
│ agent.md              │  Tool: route_to_domain
│                       │  → domain_id = audience
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ Audience Domain       │  agents/app/mas/domains/audience/
│ agent.md + runner.py  │  Tool: invoke_executor
│ Skill Selector LLM    │  May direct_reply only for casual/capability chat
└───────────┬───────────┘
            │
            ├── contact (+ skill) ──────────────┐
            ├── audience_selection (no skill)   │
            └── audience_pull (no skill)        │
                                                ▼
┌──────────────────────────────────────────────────────────────┐
│ Executors (tool loops)                                       │
│  contact            — create / update / view one person      │
│  audience_selection — list, filter, bulk sheet               │
│  audience_pull      — search / summarize / export-style pull │
└──────────────────────────────────────────────────────────────┘
            │
            ▼
Legacy handlers  agents/app/agents/contacts/tools/handlers.py
            │
            ▼
ui_event + state_update + agent_message → FE panel + chat
```

| Layer | Path | Allowed tools (routing) | Speaks to user? |
|-------|------|-------------------------|-----------------|
| Super | `mas/super_agent/` | `route_to_domain` only | Passes domain reply |
| Audience Domain | `mas/domains/audience/` | `invoke_executor` only | Yes — casual only; else routes |
| Contact Executor | skill harness + LLM | Skill allowlist (+ panel sync) | Yes — owns create/update/view interview |
| Selection / Pull | executor LLM | Selection/pull allowlist | Yes — list/bulk/search |

**Shared memory** (same block for Super, Domain, Executor every turn): `build_mas_runtime_context` — `recent_chat`, `chat_memory_note`, `contacts_state` / `draft_contact`, `module_skills`, live session facts.

---

## 2. Skills (contact executor only)

Registered in `mas/skills/contacts/__init__.py`. Domain sets `skill_id` + `skill_action` when `executor_id=contact`.

| Skill | Playbook | Purpose | Completion tools |
|-------|----------|---------|------------------|
| `contact_creation` | `contact_creation.md` | New CRM contact (chat or sheet) | `CREATE_SINGLE_CONTACT`, `CREATE_BULK_CONTACT` |
| `contact_update` | `contact_update.md` | Change existing contact (chat or sheet) | `UPDATE_SINGLE_CONTACT`, `UPDATE_BULK_CONTACT` |
| `contact_view` | `contact_view.md` | Show / find / list (read-only) | `VIEW_CONTACT`, `QUERY_CONTACTS` |

**Skill actions (Domain):** `continue` | `new_task` | `switch` | `pause_and_switch` | `complete` | `resume` | `cancelled`

**Panel sync:** skills `contact_creation` and `contact_update` always get **`SET_DRAFT_FIELDS`** appended by the skill registry (`PANEL_SYNC_TOOL`). The Contact Setup panel updates only when that tool succeeds.

### Tools exposed per skill (current registry)

| Skill | `tool_names` (+ auto panel sync) |
|-------|----------------------------------|
| `contact_creation` | `CREATE_SINGLE_CONTACT`, `CREATE_BULK_CONTACT`, `GET_CONTACT_DETAIL` **+** `SET_DRAFT_FIELDS` |
| `contact_update` | `UPDATE_SINGLE_CONTACT`, `UPDATE_BULK_CONTACT`, `GET_CONTACT_DETAIL` **+** `SET_DRAFT_FIELDS` |
| `contact_view` | `VIEW_CONTACT`, `QUERY_CONTACTS` |

> **Note:** `ROUTE_TO_MODULE` is in the contact **executor allowlist** (`tool_adapters.py`) and the full schema catalog, but it is **not** listed on these skill `tool_names` today — so the skill harness does not pass it to the LLM unless added to the skill specs. Cross-module handoff from Audience therefore often falls through to a Domain/executor prose reply instead of SPA navigate.

---

## 3. Executors without skills

| Executor | When Domain picks it | Typical tools (allowlist) |
|----------|----------------------|---------------------------|
| `audience_selection` | List / filter / bulk import-update | `SEARCH_CONTACTS`, `LOOKUP_CONTACT`, `CONTACT_VIEW_AND_DOWNLOAD`, `CREATE_BULK_CONTACT`, `UPDATE_BULK_CONTACT`, `IMPORT_CONTACTS`, `ROUTE_TO_MODULE` |
| `audience_pull` | Search / summarize / export-style | `SEARCH_CONTACTS`, `LOOKUP_CONTACT`, `CONTACT_VIEW_AND_DOWNLOAD`, `IMPORT_CONTACTS` |

---

## 4. End-to-end chat flows

### 4.1 Create contact (`contact_creation`)

```
User: add / create / new contact (any natural wording)
  → Domain: invoke_executor contact + contact_creation + new_task
  → Executor: SET_DRAFT_FIELDS mode=create (+ reset_draft if profile open)
  → ui_event draft_updated → FE rightMode=create (Contact Setup)

Interview (one field at a time; skip what draft already has):
  1. first_name (required)     → SET_DRAFT_FIELDS
  2. last_name (optional once) → SET_DRAFT_FIELDS or skip_field=last_name
  3. email (format in LLM first; then SET_DRAFT_FIELDS → directory check)
  4. phone  (country code; same)  — need email OR phone
  5. company (B2B ask once) / city (optional)
  → summarize from draft_contact → user confirms
  → CREATE_SINGLE_CONTACT user_confirmed=true
  → ui_event contact_created → FE detail + list refresh
```

**Directory after email/phone on create:**

| Result | Behavior |
|--------|----------|
| Unique | Keep value on create draft; ask only `next_field` (never “not found”) |
| Duplicate | Panel EXISTING MATCH; name the **matched** person; ask update them vs different email/phone |

**Bulk:** sheet upload → `CREATE_BULK_CONTACT`.

### 4.2 Update contact (`contact_update`)

```
User: edit / update / change contact
  → Domain: contact + contact_update
  → GET_CONTACT_DETAIL (email / phone / name) if no focus
  → SET_DRAFT_FIELDS mode=update for each change
  → confirm → UPDATE_SINGLE_CONTACT user_confirmed=true + contact_id
```

Identity lock: existing email/phone cannot be changed to a different value; missing channels may be **added** after uniqueness check via `GET_CONTACT_DETAIL`.

**Bulk:** `UPDATE_BULK_CONTACT`.

### 4.3 View / search (`contact_view`)

```
One identity (email | phone | name | contact_id)
  → VIEW_CONTACT → one match = detail; none = say so

Two+ criteria / list / filter
  → QUERY_CONTACTS(user_request = full restatement + memory)
  → many matches = matches panel; user picks → VIEW_CONTACT contact_id
```

### 4.4 Cross-module (intended)

User wants Create campaign / Reports / etc. from Audience chat:

```
Executor (or selection) → ROUTE_TO_MODULE { module, query, change_summary }
  → ui_event navigate
  → FE applyAgentNavigate (chat-handoff.ts)
  → e.g. module=create_campaign opens a real draft chat with carried thread
```

Call **`ROUTE_TO_MODULE` alone** that turn (no mix with other tools).

---

## 5. Tool catalog

Source: `agents/app/agents/contacts/tools/schemas.py`  
Dispatch: `handlers.py` → `dispatch_tool`

### 5.1 Primary (LLM-facing / skill path)

| Tool | Role |
|------|------|
| **`SET_DRAFT_FIELDS`** | Panel sync — merge create/update draft; open create (`mode=create`, optional `reset_draft`) |
| **`GET_CONTACT_DETAIL`** | Load/focus; duplicate check on email/phone during create/update |
| **`VIEW_CONTACT`** | Open one contact by single identity |
| **`QUERY_CONTACTS`** | Multi-criteria / NL list (SQL agent under the hood) |
| **`CONTACT_VIEW_AND_DOWNLOAD`** | List + download-style audience query |
| **`CREATE_SINGLE_CONTACT`** | Persist create after confirm (`user_confirmed=true`) |
| **`CREATE_BULK_CONTACT`** | Sheet create (`isTemp=0` permanent) |
| **`UPDATE_SINGLE_CONTACT`** | Persist update after confirm |
| **`UPDATE_BULK_CONTACT`** | Sheet update |
| **`ROUTE_TO_MODULE`** | Leave Audience SPA → another module |

### 5.2 Legacy / extended (catalog + allowlist; older sessions / selection)

| Tool | Role |
|------|------|
| `LOOKUP_CONTACT` | Duplicate check by email/phone |
| `GET_CONTACT` | Load by `contact_id` |
| `SEARCH_CONTACTS` | Filter search (count + sample) |
| `VERIFY_FOCUS_IDENTITY` | Match email/phone to open profile |
| `CREATE_CONTACT` / `UPDATE_CONTACT` | Legacy create/update aliases |
| `IMPORT_CONTACTS` | Import rows / file URL |
| `GET_COMPANY_PACK`, `ADD_COMPANY_RULE`, `UPDATE_COMPANY_RULE`, `DELETE_COMPANY_RULE` | Org pack rules |
| `UPSERT_PACK_FIELD`, `CONFIRM_PACK_FIELD`, `DELETE_PACK_FIELD` | Pack field CRUD |
| `REQUEST_DELETE` / `CONFIRM_DELETE` | Delete flow (schema present; not in current `_CONTACT_TOOL_CATALOG` index list used by MAS subsets) |

### 5.3 `SET_DRAFT_FIELDS` (patch tool — critical)

| Arg | Notes |
|-----|--------|
| `mode` | `create` \| `update` |
| `reset_draft` | New create while a profile is open |
| `first_name`, `last_name`, `full_name` | `full_name` only for two tokens |
| `email`, `phone`, company, city, … | Structured values only |
| `skip_field` | e.g. `last_name`, `email` |
| `change_summary` | Internal log |

Emits **`draft_updated`** (`_draft_ui_payload`: draft_contact, focus, mode, candidates, …). May chain directory lookup and append **`navigate`** to `/audience/new` when staging create.

---

## 6. Frontend contract

| Piece | Location |
|-------|----------|
| Workspace | `frontend/src/components/contacts/AudienceWorkspace.tsx` |
| Guided create panel | `ContactGuidedPreview` + `contact-guided-fields.ts` |
| Welcome | FE `module-welcomes` + join with `skip_welcome: true` |
| Navigate handoff | `lib/chat-handoff.ts` → `applyAgentNavigate` |

**Right panel modes:** `list` | `create` | `detail` | `matches`

**Important ui_events:**

| `type` | Effect |
|--------|--------|
| `draft_updated` | Sync draft / open create or update panel |
| `contact_candidates` / matches payload | Matches list |
| `contact_created` | Open new contact detail; refresh list |
| `navigate` | Path/module handoff (create panel or other SPA module) |
| `contact_mismatch` | Focus cleared; may start fresh chat |

**Emit order (contacts):** `state_update` before chat message so the panel leads the assistant text (`socket_server` / `_emit_contacts_turn_result`).

---

## 7. Domain routing rules (summary)

From `mas/domains/audience/agent.md`:

- **Direct reply only** when: greeting / capability question, **and** no create-in-progress, **and** user is not starting create/view/update/list.
- **Always `invoke_executor`** for real contact work (typos and shorthand included).
- Create-start after a welcome menu (“new one”, “add one”, …) → `contact_creation` + `new_task` — never “I didn’t catch that”.
- Mid-create field answers stay on `contact_creation` + `continue` (including email/phone-only replies).
- Explicit show/find/list while creating → `contact_view` with `switch` / `new_task`.

Super (`mas/super_agent/agent.md`): Audience SPA turns → `domain_id=audience` (contacts, segments, consent, informal add).

---

## 8. Key source files

| Concern | Path |
|---------|------|
| Super prompt | `agents/app/mas/super_agent/agent.md` |
| Audience domain | `agents/app/mas/domains/audience/agent.md`, `runner.py` |
| Skills registry | `agents/app/mas/skills/contacts/__init__.py` |
| Skill playbooks | `…/contact_creation.md`, `contact_update.md`, `contact_view.md` |
| Skill selector | `mas/skills/selector.py` → `llm_pick_audience_executor` |
| Executor allowlists | `mas/runtime/tool_adapters.py` |
| Tool schemas | `agents/app/agents/contacts/tools/schemas.py` |
| Tool handlers | `agents/app/agents/contacts/tools/handlers.py` |
| Executor prompts | `agents/app/agents/contacts/prompts.py` |
| Cross-module route | `agents/app/agents/routing.py` (`ROUTE_TO_MODULE`) |
| FE workspace | `frontend/src/components/contacts/AudienceWorkspace.tsx` |
| FE navigate | `frontend/src/lib/chat-handoff.ts` |

---

## 9. Quick decision table

| User wants… | Domain / skill | First tool |
|-------------|----------------|------------|
| New contact | `contact` / `contact_creation` | `SET_DRAFT_FIELDS` `mode=create` |
| Change existing | `contact` / `contact_update` | `GET_CONTACT_DETAIL` then `SET_DRAFT_FIELDS` |
| Show one person | `contact` / `contact_view` | `VIEW_CONTACT` |
| List / filter | `contact_view` or `audience_selection` | `QUERY_CONTACTS` / `CONTACT_VIEW_AND_DOWNLOAD` |
| Sheet import | creation or selection | `CREATE_BULK_CONTACT` |
| Leave to Create campaign | (needs `ROUTE_TO_MODULE` on tool list) | `ROUTE_TO_MODULE` `module=create_campaign` |
