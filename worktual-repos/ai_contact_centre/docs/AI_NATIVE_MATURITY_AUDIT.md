# AI-Native Maturity Audit

> **Purpose:** Code- and UI-based status of AI-native automation capabilities in Worktual Contact Centre.  
> **Last updated:** 2026-08-30  
> **Scope:** `apps/nlp`, `apps/web`, `apps/cc-core`, `apps/chat-service`, `apps/social-service`, `apps/a2a-server`

---

## How to read this document

| Status | Meaning |
|--------|---------|
| **Done** | Implemented in production code and usable in UI or API |
| **Partial** | Some implementation exists (UI-only, co-worker draft-only, demo tenant, or backend without NL/UI parity) |
| **Not done** | Not implemented; docs/plans only |

**Overall maturity today:** hybrid AI-native (~**2.5 / 5**). Strong on customer bot intake, co-worker analytics, and proactive callbacks. Weak on NL workspace actions, QA, knowledge automation, and configurable dashboards.

**Related docs:**

- [COWORKER_NL_AUDIT.md](./COWORKER_NL_AUDIT.md) — co-worker vs traditional UI parity (note: monitoring section is outdated; see §6 below)
- [pending_ccaas_plan.md](./pending_ccaas_plan.md) — roadmap sequencing
- [DASHBOARD_KPI_CARDS.md](./DASHBOARD_KPI_CARDS.md) — dashboard vs copilot chart paths
- [AI_CONTACT_CENTER_PLAN.md](./AI_CONTACT_CENTER_PLAN.md) — product vision

---

## Summary scorecard

| # | Pillar | Done | Partial | Not done | Overall |
|---|--------|------|---------|----------|---------|
| 1 | Customer self-service | 2 | 4 | 1 | Partial |
| 2 | Intelligent routing | 2 | 2 | 0 | Partial |
| 3 | Agent co-worker actions | 0 | 6 | 0 | Partial |
| 4 | Real-time agent assist | 4 | 1 | 1 | Partial |
| 5 | After-contact automation | 2 | 3 | 0 | Partial |
| 6 | AI supervisor | 0 | 5 | 0 | Partial |
| 7 | Workforce automation | 1 | 2 | 0 | Partial |
| 8 | Proactive engagement | 2 | 1 | 1 | Partial |
| 9 | AI quality management | 0 | 0 | 2 | Not done |
| 10 | Knowledge automation | 0 | 0 | 3 | Not done |
| 11 | Live configurable dashboards | 0 | 1 | 2 | Not done |
| 12 | Event-driven AI loop | 0 | 3 | 0 | Partial |
| 13 | Autonomy & governance | 1 | 3 | 1 | Partial |

---

## 1. Customer self-service

| Capability | Status | UI / code evidence |
|------------|--------|-------------------|
| Bot FAQ / KB answers | **Done** | `SupportBotAgent`; MCP `get_organization_knowledge`; webchat orchestrator `apps/chat-service/src/services/webchat-orchestrator.ts` |
| Live-agent handoff | **Done** | MCP `recommend_live_agent_handoff`; `support_handoff.py`, `queue_select.py`; lifecycle `bot_active → queued` in `docs/architecture/lifecycle-contract.md` |
| Customer identity / enrich | **Partial** | Generic: `contact_enrich` MCP. Demo tenant: OTP tools in `custom_lola_worktual/tools.py` |
| Appointments | **Partial** | **Done** for Worktual Lola demo (`BOOK_APPOINTMENT`, `RESCHEDULE_APPOINTMENT`). **Not done** in generic `support_bot` |
| Order / ticket status | **Partial** | Lola demo: `GET_TICKET_STATUS`, `CREATE_TICKET`. Generic bot: KB-only |
| Payment handling | **Not done** | No payment tool or flow in platform bots |
| Bot auto-close (inactivity) | **Partial** | Social session close (`social-session.ts`); no full webchat bot-resolved flow |
| WhatsApp / social customer bot | **Partial** | Channel routing exists; customer AI bot parity with webchat not complete (`pending_ccaas_plan.md`) |
| Voice AI agent | **Not done** | `call-service` stub only |

---

## 2. Intelligent routing

| Capability | Status | UI / code evidence |
|------------|--------|-------------------|
| LLM queue selection at handoff | **Done** | `select_queue_with_llm` in `apps/nlp/src/app/agents/queue_select.py` |
| Skill-based agent assignment | **Done** | `apps/cc-core/src/services/routing.ts` — skill score, presence, capacity, shifts |
| Offer expiry + reroute | **Done** | `offer-lifecycle.ts`, workspace reroute on reject |
| Email LLM urgency → priority | **Partial** | `email-priority.ts`, email prompts; webchat/social priority not LLM-scored |
| LLM agent pick at offer time | **Not done** | Proactive callback uses eligible-agent list + plan; routing engine is deterministic |
| AI-driven priority for all channels | **Partial** | Queue ordering by `priority DESC`; not unified AI scoring |

---

## 3. Agent co-worker actions (workspace)

Co-worker is **assist-only** on workspace today — agents operate via traditional UI.

| Capability | Status | UI | Co-worker NL |
|------------|--------|----|--------------|
| Send customer message | **Partial** | Done (`workspace/api.ts`) | Draft only — `suggest_reply` |
| Transfer conversation | **Partial** | Done (`use-workspace-state.ts`) | Not done — no MCP tool |
| Disposition / resolve | **Partial** | Done (disposition dialogs) | Not done — no MCP tool |
| Accept / reject offer | **Partial** | Done | Not done — no MCP tool |
| Change presence | **Partial** | Done | Not done — no MCP tool |
| Notes (customer + personal) | **Partial** | Done (`use-workspace-notes.ts`) | Not done — no MCP tool |
| List / get / update tasks | **Partial** | Done | Done — `list_tasks`, `get_task`, `update_task` |
| Create task | **Not done** | System-generated only | Not done — no `create_task` MCP |
| Conversation context | **Done** | — | `get_conversation_context` |
| Internal chat co-worker | **Not done** | Full UI | No co-worker panel on internal chat |

**Key files:** `docs/COWORKER_NL_AUDIT.md`, `apps/nlp/src/app/mcp/servers/conversation.py`, `apps/web/src/features/workspace/use-workspace-state.ts`

---

## 4. Real-time agent assist

| Capability | Status | UI / code evidence |
|------------|--------|-------------------|
| Suggest reply | **Done** | MCP `suggest_reply`; chip in `workspace-conversation-composer.tsx`; co-worker tab |
| Summarize conversation | **Done** | MCP `summarize_conversation` |
| Organization knowledge / FAQ | **Done** | MCP `get_organization_knowledge` (inbox + bot surfaces) |
| Sentiment analysis | **Done** | `SentimentAgent`; `/api/v1/workspace/sentiment/*`; UI `sentiment-chip.tsx` |
| Contact enrich during chat | **Done** | MCP `contact_enrich` |
| Translate (live) | **Not done** | No translation API, MCP tool, or workspace UI |
| Compliance evaluation (workspace) | **Partial** | PII redaction in `guardrails.py`; email `guardPassed` gate — no workspace compliance tool |
| Real-time coaching nudges | **Partial** | Agent attention insights (`agent-attention-insight.ts`); not in active conversation stream |

---

## 5. After-contact automation

| Capability | Status | UI / code evidence |
|------------|--------|-------------------|
| AI wrap-up summary | **Done** | `/api/v1/workspace/wrap-up/suggest`; `wrap-up-suggest.ts`; disposition dialog |
| Entity / follow-up extraction | **Done** | `contact_entity_extraction.py`; `follow-up-extraction.ts` |
| AI disposition suggestion | **Partial** | Suggested in wrap-up; agent confirms — not auto-applied |
| Auto CRM / contact update | **Partial** | `contact_enrich` MCP; not full post-close CRM sync |
| Auto callback task creation | **Partial** | Proactive sweeper (`proactive-callback.ts`, `proactive-callback-sweeper.ts`); manual `create_callback_task` MCP |

---

## 6. AI supervisor

| Capability | Status | UI / code evidence |
|------------|--------|-------------------|
| Live monitoring snapshot | **Done** | UI: `monitoring/` components. Co-worker: `get_monitoring_snapshot` MCP (`monitoring.py`) |
| Force agent logout | **Done** | UI + co-worker MCP `force_agent_logout` (with confirmation) |
| Set agent presence (supervisor) | **Done** | Co-worker MCP `set_agent_presence` |
| Callback assign / acknowledge | **Done** | MCP `create_callback_task`, `acknowledge_proactive_callback`; monitoring UI |
| Not-ready escalation insight | **Done** | MCP `get_not_ready_escalation_insight`; `agent-attention-detail-dialog.tsx` |
| SLA risk alerts | **Partial** | Alerts: `sla_warning`, `sla_breached`, `offer_expiring` in `monitoring.ts` |
| Queue congestion detection | **Partial** | Live snapshot KPIs; dashboard analytics incidents (separate page) |
| Supervisor reassign / takeover | **Partial** | UI: `monitoring-supervisor-actions.tsx` — **no** co-worker reassign/takeover MCP |
| Autonomous supervisor actions | **Partial** | Co-worker can act on agents/callbacks with confirm; no auto-reroute on SLA breach |

> **Note:** `COWORKER_NL_AUDIT.md` lists Live Monitoring as "almost no tools". That is **outdated**. The `monitoring` surface in `apps/nlp/src/app/mcp/registry.py` now exposes 9 supervisor tools.

---

## 7. Workforce automation

| Capability | Status | UI / code evidence |
|------------|--------|-------------------|
| Volume forecast | **Done** | `dashboard-analytics-predictive.ts`; UI `dashboard-forecast-chart.tsx` |
| Staffing / workforce recommendations | **Partial** | `dashboard-analytics-prescriptive.ts`; UI `dashboard-analytics-panel.tsx` |
| Shift planning via co-worker | **Partial** | Queue co-worker uses `list_eligible_agents`; `/admin/workforce/shifts` has no co-worker |
| Auto schedule / shift assignment | **Not done** | Basic shifts table only |
| Capacity planning | **Not done** | Planned in roadmap (`pending_ccaas_plan.md`) |

---

## 8. Proactive engagement

| Capability | Status | UI / code evidence |
|------------|--------|-------------------|
| Webchat proactive popup | **Done** | `webchat-trigger-bot.ts`; A2A skill `cc.webchat.proactive-engagement.trigger` |
| Missed-contact callback automation | **Done** | Sweeper → NLP plan → callback task → monitoring alert |
| Agent presence nudges (Not Ready) | **Partial** | `presence-nudge-config.ts` — TTS/browser nudge, not customer-facing |
| WhatsApp / email reminders | **Partial** | Documented in `WHATSAPP_TEMPLATE_PRESETS.md`; not fully implemented in apps |
| Churn / retention prediction | **Not done** | CDP schema field only; deferred in analytics plan |

---

## 9. AI quality management

| Capability | Status | UI / code evidence |
|------------|--------|-------------------|
| Auto QA scoring (every interaction) | **Not done** | Listed as pending in `pending_ccaas_plan.md` §C2 |
| Compliance evaluation / QA pipeline | **Not done** | Email send-gate only (`email-bot-decisions.ts`); no QA UI or scoring service |
| Interaction quality coaching | **Not done** | No post-interaction quality score or supervisor QA queue |

---

## 10. Knowledge automation

| Capability | Status | UI / code evidence |
|------------|--------|-------------------|
| AI draft knowledge articles | **Not done** | Planned in `pending_ccaas_plan.md` §B4 |
| KB gap detection (unresolved intents) | **Not done** | Planned only |
| Stale / conflicting article detection | **Not done** | "Stale" in codebase refers to analytics suggestions, not KB lifecycle |
| KB usage analytics | **Not done** | No article effectiveness tracking |

---

## 11. Live configurable dashboards

| Capability | Status | UI / code evidence |
|------------|--------|-------------------|
| Pin co-worker chart to dashboard | **Not done** | Charts ephemeral in Redux chat session only |
| Drag-and-drop dashboard layout | **Not done** | Fixed grid in `dashboard-overview-panel.tsx` |
| Personal / org widget layouts | **Not done** | No `dashboard_widgets` DB table |
| Live widget refresh (persisted) | **Not done** | Dashboard polls fixed KPIs every 10s (`DASHBOARD_POLL_MS` in `DashboardPage.tsx`) — not user-defined widgets |
| NL analytics in co-worker | **Done** | `ask_semantic_layer`, `sql_analytics`, `generate_plot` on dashboard surface |
| Dashboard Analytics page (incidents/forecast) | **Partial** | `DashboardAnalyticsPage.tsx` — separate from co-worker chat; fixed layout |

---

## 12. Event-driven AI loop

| Capability | Status | UI / code evidence |
|------------|--------|-------------------|
| cc-core transactional outbox → Kafka | **Not done** | ADR-002 planned; Kafka stubs in `call-service`, `social-service` only |
| NLP event consumer / enrichment worker | **Not done** | Roadmap in `nlp-backend/NLP_BACKEND_ROADMAP.md` |
| Scheduled sweepers (callbacks, offers, sessions) | **Partial** | `cc-core/src/index.ts` — proactive callback, offer expiry, session sweeper |
| Headless proactive agent | **Partial** | `ProactiveAgent` in `agents/coworker/proactive.py`; callback plan API |
| Event → AI decision → action loop | **Partial** | Missed-contact flow exists; no general event bus for SLA/sentiment/churn |

---

## 13. Autonomy tiers & governance

| Capability | Status | UI / code evidence |
|------------|--------|-------------------|
| Confirmation flows (destructive actions) | **Done** | `_confirmation_required` in `runtime/agent.py`; preview in `embedded-copilot-panel.tsx`; A2A policy in `a2a-server/.../policy.py` |
| Email shadow mode | **Partial** | `shadowMode` in `email-orchestrator.ts`, `channel-policies.ts` |
| Email auto-send (confidence + grounding) | **Partial** | `automationMode: auto_send`; gated by `guardPassed` + confidence in `email-bot-decisions.ts` |
| Webchat bot auto-reply | **Done** | Bot replies sent via webchat orchestrator (tenant policy) |
| Canary rollout for skills | **Not done** | Schema/docs only (`WEBCHAT_LIVE_AGENT_PLAN.md`); no runtime canary |
| Per-tenant autonomy policy UI | **Not done** | Channel policies exist; no admin autonomy configuration page |
| MCP surface + role authorization | **Partial** | `MCPRegistry.authorize` in `registry.py`; `ROLE_DENIED_TOOLS` for agents |

---

## Co-worker NL parity by portal

### Agent portal (`/agent/*`)

| Module | Traditional UI | Co-worker NL | Status |
|--------|----------------|--------------|--------|
| My Performance | Done | Strong analytics NL | **Done** |
| Contacts | Done | Create, update, list, get | **Partial** (no delete, no history) |
| My Tasks | Done | List, get, update | **Partial** (no create) |
| Agent Workspace | Done | Draft, summarize, enrich | **Partial** (no send/transfer/dispose) |
| Internal Chat | Done | None | **Not done** |

### Admin portal (`/admin/*`)

| Module | Traditional UI | Co-worker NL | Status |
|--------|----------------|--------------|--------|
| Dashboard | Done | NL KPIs, charts, reports | **Partial** (no pin widgets) |
| Dashboard Analytics | Done | Separate NLP APIs, not co-worker | **Partial** |
| Contacts | Done | Create, update, list, get | **Partial** |
| Queues | Done | Create, activate, delete via NL | **Partial** |
| Live Monitoring | Done | Snapshot, callbacks, agent actions | **Partial** (no reassign NL) |
| Workforce (agents/shifts) | Basic tables | No co-worker | **Not done** |
| Channel setup | Not done | No MCP | **Not done** |
| Users / Teams admin | API only | List teams/agents only | **Not done** |

---

## Strongest implemented loops (today)

```text
Customer bot (webchat/email)
  → LLM queue pick
  → skill-based agent routing
  → agent workspace (suggest reply, sentiment, wrap-up)
  → proactive missed-callback recovery
  → supervisor monitoring (UI + co-worker MCP)
```

---

## Biggest gaps for full AI-native

| Priority | Gap | Why it matters |
|----------|-----|----------------|
| P0 | Co-worker workspace actions (send, transfer, disposition, resolve, offers) | Agents still operate forms, not conversation |
| P0 | Pin + live refresh dashboard widgets | Analytics die when chat session ends |
| P1 | Event bus (outbox/Kafka) + proactive AI workers | AI only reacts when someone opens co-worker |
| P1 | WhatsApp/social customer bot parity | Omnichannel AI-first incomplete |
| P1 | Auto QA / compliance scoring | No closed-loop quality automation |
| P2 | Knowledge gap → draft article pipeline | KB stays manual |
| P2 | Voice AI + real-time assist | Voice channel absent |
| P2 | Workforce shift automation via co-worker | WFM remains traditional tables |
| P3 | Churn/retention proactive flows | Not started |
| P3 | Canary autonomy rollout UI | Governance incomplete |

---

## Recommended build order

| Phase | Focus | Unlocks |
|-------|-------|---------|
| **1** | Workspace MCP tools + confirmation (send, transfer, disposition, resolve) | Agents can run shift through co-worker |
| **2** | Pin-to-dashboard + widget refresh API | Persistent live intelligence |
| **3** | Event outbox + NLP workers (SLA, sentiment, missed contact) | Continuous AI ops, not chat-only |
| **4** | Auto QA pipeline + knowledge gap detection | Learning loop |
| **5** | Voice agent + WhatsApp bot parity | Full omnichannel AI-native |

---

## Key source files (quick reference)

| Area | Path |
|------|------|
| MCP tool registry | `apps/nlp/src/app/mcp/registry.py` |
| Agent definitions | `apps/nlp/src/app/agents/definitions.py` |
| Support bot + handoff | `apps/nlp/src/app/agents/support_bot.py`, `support_handoff.py` |
| Co-worker prompts | `apps/nlp/src/app/prompts/coworker.py` |
| Monitoring MCP | `apps/nlp/src/app/mcp/servers/monitoring.py` |
| Analytics MCP | `apps/nlp/src/app/mcp/servers/analytics.py` |
| Routing engine | `apps/cc-core/src/services/routing.ts` |
| Proactive callback | `apps/cc-core/src/services/proactive-callback.ts` |
| Dashboard UI | `apps/web/src/pages/admin/DashboardPage.tsx` |
| Co-worker UI | `apps/web/src/components/assistant/embedded-copilot-panel.tsx` |
| Plot/chart cards | `apps/web/src/components/assistant/plot-chart-card.tsx` |
| A2A skill catalog | `apps/a2a-server/src/cc_a2a/catalog.py` |

---

## Maintenance

Re-run this audit when:

- New MCP tools or co-worker surfaces ship
- Dashboard widget persistence is added
- Kafka/outbox or QA pipeline lands
- `COWORKER_NL_AUDIT.md` is updated (keep both docs in sync)

**Audit method:** codebase search + UI component review + cross-check with `COWORKER_NL_AUDIT.md` and `pending_ccaas_plan.md`.
