# Worktual Co-worker NL Audit Report

Audit of **traditional UI** vs **co-worker natural language** (MCP tools + copilot surfaces) for **Agent Portal** and **Admin Portal**.

**Legend:** ✅ Yes | ⚠️ Partial | ❌ No | N/A Not in nav

---

## How Co-worker Works (Shared)

- **UI:** Worktual co-worker panel (`EmbeddedCopilotPanel`) → `cc-core` → NLP `/api/v1/copilot/stream`
- **Tools** gated by **page surface** + **role** (`apps/nlp/src/app/mcp/registry.py`)
- **Specialists:** `contact`, `inbox`, `task`, `queue`, `analytics`, `general`

### MCP Servers & Tools (Inventory)


| Server           | Tools                                                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **contact**      | `list_contacts`, `get_contact`, `stage_contact_draft`, `create_contact`, `update_contact`, `contact_enrich`                                                                            |
| **conversation** | `get_conversation_context`, `suggest_reply`, `summarize_conversation`                                                                                                                  |
| **task**         | `list_tasks`, `get_task`, `update_task`                                                                                                                                                |
| **queue**        | `list_queues`, `list_teams`, `list_business_hours`, `stage_queue_draft`, `create_queue`, `update_queue_status`, `delete_queue`, `list_agents`, `list_eligible_agents`, `list_presence` |
| **analytics**    | `ask_semantic_layer`, `sql_analytics`, `generate_plot`, `generate_performance_report`                                                                                                  |
| **organization** | `get_organization_details`, `get_organization_knowledge`, `recommend_live_agent_handoff`                                                                                               |
| **navigation**   | `navigate`                                                                                                                                                                             |
| **skill**        | `list_skills`, `get_skill`, `update_skill_in_system`, `remove_skill_from_system`, `list_active_skills`                                                                                 |
| **metric**       | `list_metric_domains`, `get_metrics`, `get_metric`, `get_metric_schema`, `list_active_metrics`, `remove_metrics`                                                                       |


Plus runtime tool: `route_to_agent` (cross-specialist handoff + auto-navigation).

### Key Source References


| Area                               | Path                                                       |
| ---------------------------------- | ---------------------------------------------------------- |
| MCP registry & surface tool policy | `apps/nlp/src/app/mcp/registry.py`                         |
| Agent definitions & handoffs       | `apps/nlp/src/app/agents/definitions.py`                   |
| Surface mapping                    | `apps/web/src/features/assistant/copilot-page-context.tsx` |
| Co-worker API                      | `apps/nlp/src/app/api/copilot.py`                          |
| Agent / admin nav                  | `apps/web/src/config/navigation.tsx`                       |
| Workspace operations               | `apps/web/src/features/workspace/api.ts`                   |


---



# Agent Portal (`/agent/*`)

**Nav:** Workspace · Contacts · My Tasks · My Performance · Internal Chat


| Module              | Traditional UI                                            | Co-worker NL                                                      | Parity         |
| ------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- | -------------- |
| **Contacts**        | Search, create, edit, delete, interaction history         | ✅ List, get, **create** (guided draft), **update**, mark inactive | ⚠️ **Partial** |
| **Agent Workspace** | Full inbox, reply, transfer, disposition, notes, presence | ⚠️ Context, suggest reply, summarize, enrich contact              | ⚠️ **Partial** |
| **My Tasks**        | List, complete, dismiss, accept suggestions               | ✅ List, get, update                                               | ⚠️ **Partial** |
| **My Performance**  | KPIs, charts, export PDF/CSV                              | ✅ NL analytics, SQL, charts, performance reports                  | ✅ **Strong**   |
| **Internal Chat**   | DMs, groups, attachments                                  | ❌ No co-worker, no tools                                          | ❌ **None**     |
| **Queues**          | N/A (not in agent nav)                                    | N/A (agents denied queue mutations)                               | N/A            |
| **Live Monitoring** | N/A (not in agent nav)                                    | N/A                                                               | N/A            |




### Where Co-worker Is Embedded (Agent)


| Page            | Co-worker panel                       |
| --------------- | ------------------------------------- |
| Agent Workspace | Yes (Co-worker tab in customer panel) |
| Contacts        | Yes                                   |
| My Tasks        | Yes                                   |
| My Performance  | Yes                                   |
| Internal Chat   | **No**                                |


**Agent role restrictions:** Agents are **denied** queue mutation tools: `create_queue`, `update_queue_status`, `delete_queue`.

---



## Contacts (Agent)


| Operation               | UI            | Co-worker NL                                         |
| ----------------------- | ------------- | ---------------------------------------------------- |
| **Create contact**      | ✅ Form        | ✅ `stage_contact_draft` → `create_contact`           |
| **Update contact**      | ✅ Edit form   | ✅ `stage_contact_draft` → `update_contact`           |
| **Search / list**       | ✅             | ✅ `list_contacts`                                    |
| **View detail**         | ✅             | ✅ `get_contact`                                      |
| **Delete**              | ✅ Hard delete | ❌ NL only supports **inactive** via `update_contact` |
| **Interaction history** | ✅             | ❌                                                    |
| **Enrich during chat**  | Via workspace | ✅ `contact_enrich` (inbox surface)                   |


**Summary:** Create **yes**, update **yes** (guided flow with confirmation preview).

---



## Agent Workspace


| Operation                         | UI     | Co-worker NL                   |
| --------------------------------- | ------ | ------------------------------ |
| Send customer message             | ✅      | ❌ Draft only (`suggest_reply`) |
| Transfer                          | ✅      | ❌                              |
| Disposition / end / resolve       | ✅      | ❌                              |
| Accept/reject offers              | ✅      | ❌                              |
| Change presence (Ready/Busy/etc.) | ✅      | ❌                              |
| Notes (customer + personal)       | ✅      | ❌                              |
| Conversation context              | ✅      | ✅ `get_conversation_context`   |
| Summarize thread                  | ✅      | ✅ `summarize_conversation`     |
| AI reply suggestion               | ✅ Chip | ✅ `suggest_reply`              |
| Contact enrich                    | ✅      | ✅ `contact_enrich`             |
| Org knowledge / FAQ               | —      | ✅ `get_organization_knowledge` |
| Navigate to other pages           | —      | ✅ `navigate`                   |


**Role today:** Reply coach, not workspace operator.

---



## My Tasks


| Operation                   | UI                   | Co-worker NL                                      |
| --------------------------- | -------------------- | ------------------------------------------------- |
| List / filter / search      | ✅                    | ✅ `list_tasks`                                    |
| View task                   | ✅                    | ✅ `get_task`                                      |
| Complete / dismiss / accept | ✅                    | ✅ `update_task`                                   |
| **Create task**             | ❌ (system-generated) | ❌ No `create_task` tool                           |
| Deep-link to conversation   | ✅                    | ⚠️ Can navigate to workspace, not specific thread |


---



## My Performance


| Operation                | UI  | Co-worker NL                            |
| ------------------------ | --- | --------------------------------------- |
| KPI cards & charts       | ✅   | ✅ `ask_semantic_layer`, `sql_analytics` |
| Custom charts            | —   | ✅ `generate_plot`                       |
| Performance report cards | —   | ✅ `generate_performance_report`         |
| Export PDF/CSV           | ✅   | ❌                                       |


---



## Agent Portal — Biggest Gaps

1. **Disposition, transfer, resolve, presence, offers** — UI only
2. **Internal chat** — no co-worker at all
3. **Notes** — UI only
4. **Task creation** — no NL tool
5. **Contact delete** — UI only (NL uses inactive)

---



# Admin Portal (`/admin/*`)

**Nav:** Dashboard · Contacts · Queues · My Workspace · Live Monitoring · Internal Chat


| Module                                 | Traditional UI                      | Co-worker NL                            | Parity         |
| -------------------------------------- | ----------------------------------- | --------------------------------------- | -------------- |
| **Dashboard**                          | KPIs, exports, scheduled reports    | ✅ Org analytics via NL                  | ⚠️ **Partial** |
| **Dashboard Analytics**                | Incidents, forecast, workforce plan | ❌ Separate NLP APIs, not co-worker chat | ⚠️ **Partial** |
| **Contacts**                           | Same as agent + admin view          | ✅ Create, update, list, get             | ⚠️ **Partial** |
| **Queues**                             | Full queue editor wizard            | ✅ Create, activate/deactivate, delete   | ⚠️ **Partial** |
| **My Workspace**                       | Supervisor inbox + actions          | ⚠️ Same as agent inbox co-worker        | ⚠️ **Partial** |
| **Live Monitoring**                    | Rich supervisor console             | ❌ Panel exists but almost no tools      | ❌ **Weak**     |
| **Internal Chat**                      | Full messaging                      | ❌ No co-worker                          | ❌ **None**     |
| **Channels setup**                     | ❌ No admin page                     | ❌ No MCP tools                          | ❌ **Missing**  |
| **Users / Teams**                      | ❌ No admin page (API only)          | ⚠️ `list_teams`, `list_agents` only     | ❌ **Missing**  |
| **Settings**                           | ❌ No page                           | ⚠️ Org details/knowledge only           | ❌ **Missing**  |
| **Workforce** (Agents/Presence/Shifts) | Hidden routes, basic tables         | ❌ No co-worker on those pages           | ❌ **Weak**     |




### Copilot Surface Map (Admin Pages)


| Admin path                                       | Co-worker UI?       | MCP surface                                   | Default specialist |
| ------------------------------------------------ | ------------------- | --------------------------------------------- | ------------------ |
| `/admin/dashboard`, `/admin/dashboard/analytics` | Yes                 | `dashboard`                                   | `analytics`        |
| `/admin/workforce/queues`                        | Yes                 | `queues-list` / `queue-create` / `queue-edit` | `queue`            |
| `/admin/contacts`                                | Yes                 | `contacts-list` / `contacts-detail`           | `contact`          |
| `/admin/workspace`                               | Yes (Co-worker tab) | `inbox`                                       | `inbox`            |
| `/admin/monitoring`                              | Yes                 | `other`                                       | `general`          |
| `/admin/team-chat`                               | **No**              | —                                             | —                  |
| `/admin/workforce/agents`                        | **No**              | `other` if visited                            | `general`          |
| `/admin/workforce/presence`                      | **No**              | `other`                                       | `general`          |
| `/admin/workforce/shifts`                        | **No**              | `other`                                       | `general`          |


---



## Contacts (Admin)

Same NL capabilities as agent portal: **create ✅, update ✅**, list/get ✅, delete ❌ (inactive only).

---



## Queues (Admin)


| Operation                                 | UI               | Co-worker NL                                         |
| ----------------------------------------- | ---------------- | ---------------------------------------------------- |
| **Create queue**                          | ✅ Full form      | ✅ `stage_queue_draft` → `create_queue` (guided)      |
| **Activate / deactivate**                 | ✅                | ✅ `update_queue_status`                              |
| **Delete queue**                          | ✅                | ✅ `delete_queue`                                     |
| **List queues / teams / hours**           | ✅                | ✅ `list_queues`, `list_teams`, `list_business_hours` |
| **List agents / presence**                | ✅ (hidden pages) | ✅ `list_agents`, `list_presence`                     |
| **Edit queue** (agents, channels, shifts) | ✅ Full editor    | ❌ Form UI required — NL only status/delete           |
| **Create business hours**                 | API exists       | ❌                                                    |
| **Agent skills assignment**               | Partial UI       | ❌                                                    |


**Summary:** Queue **create yes**, **update partial** (status only via NL, not full edit).

---



## Live Monitoring (Admin)


| Operation                                    | UI  | Co-worker NL      |
| -------------------------------------------- | --- | ----------------- |
| Live agents / queues snapshot                | ✅   | ❌                 |
| Waiting / missed / callbacks                 | ✅   | ❌                 |
| Supervisor takeover / reassign / force close | ✅   | ❌                 |
| Assign callback tasks                        | ✅   | ❌                 |
| Force agent logout                           | ✅   | ❌                 |
| Agent attendance / insights                  | ✅   | ❌                 |
| Navigate elsewhere                           | —   | ✅ `navigate` only |


Co-worker panel is on the page but surface = `other` → only org FAQ + navigation. **Largest admin gap.**

---



## Dashboard / Analytics (Admin)


| Operation                                | UI                | Co-worker NL                 |
| ---------------------------------------- | ----------------- | ---------------------------- |
| Org KPI overview                         | ✅                 | ✅ Semantic layer, SQL, plots |
| Export / scheduled reports               | ✅                 | ❌                            |
| Advanced analytics (incidents, forecast) | ✅ Dedicated panel | ❌ Not in co-worker chat      |
| “Who’s busiest?” / “SLA today?”          | —                 | ✅ On dashboard surface       |


---



## Admin-Only Missing Modules


| Module                                          | UI                      | NL                           |
| ----------------------------------------------- | ----------------------- | ---------------------------- |
| **Channels** (webchat, WhatsApp, email routing) | ❌ No page               | ❌                            |
| **Routing policies**                            | Partial (inside queues) | ⚠️ Queue agent channels only |
| **User / role management**                      | ❌                       | ❌                            |
| **Org settings / branding**                     | ❌                       | ❌                            |
| **Skills management**                           | Coming Soon             | ❌                            |


---



# Side-by-Side: Co-worker Coverage


| Capability                  | Agent        | Admin             |
| --------------------------- | ------------ | ----------------- |
| Contact create              | ✅            | ✅                 |
| Contact update              | ✅            | ✅                 |
| Contact delete              | UI only      | UI only           |
| Queue create                | ❌ (denied)   | ✅                 |
| Queue update (full edit)    | N/A          | UI only           |
| Queue activate/deactivate   | N/A          | ✅                 |
| Inbox: suggest reply        | ✅            | ✅                 |
| Inbox: transfer/disposition | UI only      | UI only           |
| Live monitoring queries     | N/A          | ❌                 |
| Performance analytics NL    | ✅ (personal) | ✅ (org-wide)      |
| Tasks NL                    | ✅            | ❌ (no tasks page) |
| Internal chat               | ❌            | ❌                 |
| Channels / settings         | N/A          | ❌                 |


---



# Priority Recommendations


| Priority | Gap                                                        | Suggested fix                                                   |
| -------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| **P0**   | Monitoring has co-worker but can’t answer “who’s waiting?” | Add `monitoring` surface + read tools (queues, agents, waiting) |
| **P1**   | Workspace lifecycle (transfer, disposition, presence)      | Add inbox MCP tools or keep UI-only by design                   |
| **P1**   | Queue NL can’t edit agents/channels after create           | Add `update_queue` MCP or document form-only edit               |
| **P2**   | No `create_task` for follow-ups                            | Add task creation tool for inbox surface                        |
| **P2**   | Channels / settings have no UI or NL                       | Build admin module or expose via MCP                            |
| **P2**   | Internal chat — no co-worker                               | Optional: summarize threads, suggest replies                    |
| **P3**   | Admin analytics handoff may route to `/agent/performance`  | Fix role-aware navigation in `router.py`                        |
| **P3**   | Contact interaction history not in NL                      | Add read tool on contact detail surface                         |


---



# Bottom Line

**Strong today**

- Contacts (create + update)
- Queue create (admin)
- Inbox assistance (draft / summarize / enrich)
- Performance / dashboard analytics via NL

**Weak or missing**

- Live monitoring NL
- Workspace actions (transfer / disposition / presence)
- Internal chat
- Channels / settings / users admin
- Full queue edit via NL
- Task creation

---

*Generated from codebase audit — August 2026.*