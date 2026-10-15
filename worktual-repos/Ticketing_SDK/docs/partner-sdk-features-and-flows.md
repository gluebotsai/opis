# Partner SDK — AI features and flows

Consumable SDK for traditional SaaS partners who embed **Worktual Ticketing AI** and keep the customer relationship, billing, and brand.

Branch: `main_merge_v2`.  
Source of truth for behavior: `docs/ai-chat-agent-a-to-z.md`, `docs/SFT_AGENT_CATALOG.md`, `docs/agents-ticket-lifecycle.md`, `shared/ticketing_tool_catalog.json`.  
Partnership shape: *Partnering Traditional SaaS With Worktual* (headless client + white-label widgets).

`@worktual/ticketing` calls the co-worker, streams a turn, confirms an agent action, and reads Approvals. Ticket CRUD stays available for partners who file a ticket with no assistant.

---

## What runs on this branch

Staff and portal chat is **not** a LangGraph graph. One utterance goes:

```text
Partner UI or headless SDK
  → Express  POST /api/coworker/agent-turn   (or /stream)
  → session JWT, RBAC, MCP token
  → Super     ticketing_super_agent          one control tool
  → Domain    one of 5                        delegate_to_executor
  → Executor  one of 25 + one Skill           MCP tools
  → Express → Postgres                        only writer
  → reply + ui_actions + drafts
```

A second family watches events and timers. It does not replace chat.

```text
ticket.created | inbound.message | customer.replied | schedule
  → one proactive agent
  → ASGA gate
       execute | ask for confirm | recommend | reject
```

Context Layer (`CONTEXT_LAYER_URL`) is the certified path for “how many”, “why”, and ticket-row lists. The model must not invent counts or ids. If Context Layer is unset, those calls return `CONFIG` and the SDK surfaces `temporarily_unavailable`.

Internal SFT export (`:8022`, `GET /internal/v1/agents/export`) is for synthetic-data training. It is **not** a partner API.

Catalog size on this branch: **1 Super, 5 Domains, 25 Executors, 16 proactive agents.**

| Domain | Executors the partner can reach through chat or a named task |
|---|---|
| `intake_deflection_domain` | Create a ticket. Deflect a how-to with KB before a ticket exists |
| `triage_routing_domain` | Classify and prioritize. Pick assignee and queue. Workload advice. Learn routing weights |
| `resolution_lifecycle_domain` | List, open, update, note, reassign, escalate, resolve, reopen. Summary. Reply draft. SLA warning. Resolution-quality check |
| `knowledge_domain` | Similar tickets. KB articles for the ticket in play |
| `catalog_administration_domain` | Customers, teams, KB write, macros, priorities, statuses, automation, org prefs, **how many / CSAT / SLA %** |

---

## Two packages

| Package | Who runs it | Holds the partner API key |
|---|---|---|
| `@worktual/ticketing` | Partner backend (TypeScript first, then Python and C#) | Yes. Headless AI, no widgets |
| `@worktual/ticketing-ui` | Partner frontend, any framework, via custom elements | No. Short-lived session token only |

Same feature ids, error codes, locales, and usage events. A partner can ship chat only, named AI tasks only, or both.

---

## Auth, login, and AI usage

Every AI call is tied to a login so Worktual can bill the partner and the partner can see which tenant and user spent it.

| Id | Meaning |
|---|---|
| `partnerId` | The SaaS company. Quotas and invoices sit here |
| `tenantId` | Their customer. Worktual `organization_id`. Taken from the verified session, never from model text |
| `actorId` | The person who logged in |
| `sessionId` | One login. All turns in that visit share it |

| Credential | Where |
|---|---|
| Partner API key `wk_partner_…` | Server only. Mints sessions and reads usage |
| Session JWT | Browser and short-lived headless AI calls |
| Org intake key `wt_live_…` | Server only, if the partner also creates tickets without chat |

### Login flows

**A. Partner already logged the user in (default)**

1. `client.auth.createSession({ tenantId, actor, locale, surface })` with the partner key.
2. Worktual writes a login row: partner, tenant, actor, IP, user agent, locale, sdk version.
3. Returns `{ sessionToken, sessionId, expiresAt }`.
4. UI gets `sessionToken` only. Headless AI calls pass the same token.
5. `auth.endSession` on logout. `auth.refreshSession` before expiry.

**B. Worktual login widget**

`<worktual-login mode="staff|portal">` or headless `auth.login` / portal OTP. Same session row as A.

Customer-role staff logins still receive the support-portal redirect. Portal AI uses the portal session.

### What gets metered

Each turn writes one usage event. Agent work adds AI fields.

```json
{
  "partnerId": "42",
  "tenantId": "1000",
  "actorId": "441",
  "sessionId": "15",
  "surface": "ui",
  "component": "worktual-chat",
  "feature": "ai.turn",
  "skill": "ticket-classify-prioritize",
  "executor": "classification_priority_executor",
  "locale": "es",
  "agentTurns": 1,
  "confirmRequired": false,
  "ok": true
}
```

`partnerId` is the org API key id. `tenantId` is the organization id. `agentTurns` is `1` on `ai.*` events and `0` on login and quota events. `confirmRequired` is true when the turn proposes a high-risk or non-automatic action. `usage.events` returns these rows. `usage.summary` stays the aggregate counts plus `quota`.

Headless calls omit the surface header and are stored as `headless`. Widgets send `X-Worktual-Sdk-Surface: ui` and `X-Worktual-Sdk-Component` (the element tag, such as `worktual-chat`).

`usage.summary({ from, to, tenantId? })` groups logins, sessions, AI turns, confirmed writes, deflections, and `429`s. `bySkill` counts calls by the Skill that ran. Partner key only. No end-user widget.

Quota applies to partner AI calls (the `X-Worktual-Sdk-Feature` header) for that organization. A row in `ticketing.sdk_partner_quota` sets that org's caps. `0` in the row means that cap is off, even when a global cap is set. With no row, `SDK_QUOTA_TIERS` (`org:rate:concurrent`, comma-separated) is next, then `SDK_TURN_RATE_PER_MINUTE` and `SDK_CONCURRENT_TURNS`. Unset or `0` means that cap is off. `usage.summary.quota` is the active pair. Over cap returns `429` `quota_exceeded` before the model runs. The message follows the turn locale. Those calls are `quotaExceeded` on `usage.summary` and are not counted as turns. Staff chat is not capped. There is no partner API to raise the cap.

---

## Multi-language

**Programming languages.** TypeScript and the web-component bundle, plus Python (`worktual-ticketing`) and C# (`Worktual.Ticketing`) for the headless methods. Widgets stay one JS bundle.

**Product locale.** `locale` on the session and on every widget (BCP 47, default `en`).

| Piece | Behavior |
|---|---|
| Assistant reply | Super/Executor answer in the session locale. Partner can pass `locale` per turn to override |
| Errors | Stable `code`, `message` in that locale |
| Status and priority | Org catalog `displayName` |
| Dates in widgets | `Intl` in the active locale. JSON stays ISO-8601 |
| RTL | Widget sets `dir="rtl"` for Arabic and other RTL locales |
| Chrome strings | Locale pack inside `@worktual/ticketing-ui`. Partner `labels` override wins |
| Missing key | Fall back to `en` |

---

## AI modes the SDK exposes

Partners choose how much of the agent stack they want to show.

| Mode | Headless | UI | When |
|---|---|---|---|
| **Chat** | `ai.turn` / `ai.stream` | `<worktual-chat>` | Free text. Super routes |
| **Named task** | `ai.tasks.<id>` | Small panel bound to one Skill | Partner button: “Classify”, “Draft reply”, “Summarize” |
| **Proactive** | `ai.proposals.list` / `decide` | `<worktual-approvals>` | Event already fired on the Worktual side |
| **Inline assist** | Same tasks, one ticket id | Chips on the partner’s own ticket screen | Summary, similar tickets, KB, draft |

Writes that change ownership, public replies, or status **Resolved / Reopened** return `confirmation_required`. The SDK does not apply them until `ai.confirm`.

ASGA outcomes map to SDK results:

| ASGA | SDK result | UI |
|---|---|---|
| `execute` | `status: "applied"` | Toast or updated card. Summary and bell are this kind |
| `approve` | `status: "confirmation_required"` | Confirm card |
| `recommend` | `status: "recommendation"` | Advice card. Ticket unchanged |
| `reject` | `status: "rejected"` | Localized reason. Nothing to click |

---

## Feature catalog (AI first)

**H** = headless method. **U** = widget. Every row emits login-linked usage.

### 1. Session (required before any AI call)

| Feature | H | U |
|---|---|---|
| Mint session after the partner’s login | `auth.createSession` | `token` attribute |
| Staff or portal login | `auth.login`, `auth.portal.*` | `<worktual-login>` |
| End / refresh | `auth.endSession`, `auth.refreshSession` | `element.endSession()` fires `worktual-session-end` |
| Usage and login report | `usage.summary`, `usage.logins` | — |

### 2. Chat co-worker

One natural-language turn. Super continues, routes, resumes, or refuses. The SDK returns the Executor reply. `debug: true` on an SDK server call also returns `trace.agents` and `trace.routes` (`from` and `to` only). Staff chat ignores `debug`.

| Feature | H | U | Skill / executor |
|---|---|---|---|
| Send one turn | `ai.turn({ message, focusedTicketId?, locale? })` | `<worktual-chat>` | Super → Domain → Executor |
| Stream tokens | `ai.stream` (SSE) | Same widget, shadow DOM | Same |
| Continue the open draft | Next `ai.turn` on the same `sessionId` | Chat keeps the thread | `continue_active_task` |
| Park and resume | User changes topic, then comes back | Chat | `resume_task` |
| Capability refusal | Result `code` from `refuse_capability` | Inline message | `unsupported_*`, `forbidden`, `missing_context`, `approval_required`, `temporarily_unavailable` |
| Confirm a proposed write | `ai.confirm({ proposalId })` | Action card. DOM event `worktual-action` | `confirmed: true` on the tool |
| Reject a proposal | `ai.reject({ proposalId })` | Card button | No write |

Turn result:

```ts
{
  reply: string;                 // locale of the session
  status: "answered" | "collecting" | "confirmation_required" | "applied" | "refused";
  proposalId?: string;
  uiActions: Array<{ type: string; payload: unknown }>;
  usage: { feature: "ai.turn"; skill?: string; executor?: string };
}
```

`uiActions` are hints (`open_ticket`, `refresh_list`). The host may handle them from `worktual-action`. `<worktual-chat lists>` applies them: `refresh_list` draws the ticket table, and `open_ticket` focuses that row.

### 3. Named tasks (same agents, no free chat)

Use these when the partner’s UI is a button on their own screen. Each call still passes through Express RBAC and the Skill’s confirm rule.

| Task id | H | U | Agent | Confirm? |
|---|---|---|---|---|
| `ticket.create` | `ai.tasks.createTicket` | `<worktual-chat mode="create">` or form + assist | `ticket_creation_executor` | Yes, in chat, before create |
| `intake.deflect` | `ai.tasks.deflect` | `<worktual-deflection>` | `ai_resolution_executor` / DSSA | No ticket if `deflect: true` |
| `ticket.classify` | `ai.tasks.classify` | `<worktual-classify-card>` | `classification_priority_executor` | Auto-apply only when the gate says execute; else recommendation |
| `ticket.assign` | `ai.tasks.assign` | `<worktual-assign-card>` | `intelligent_assignment_executor` | Confirm if the ticket already has an owner |
| `ticket.summarize` | `ai.tasks.summarize` | `<worktual-summary>` | `investigation_summary_executor` | Applies `ai_summary` only |
| `ticket.draftReply` | `ai.tasks.draftReply` | `<worktual-reply-draft>` | `customer_reply_drafting_executor` | Always. Send posts the edited public note |
| `ticket.similar` | `ai.tasks.similar` | `<worktual-similar-tickets>` | `similar_ticket_detection_executor` | Recommendation only. No merge |
| `ticket.kb` | `ai.tasks.recommendKb` | `<worktual-kb-suggest>` | `resolution_knowledge_executor` | Recommendation only |
| `ticket.resolveSuggest` | `ai.tasks.resolveSuggest` | `<worktual-resolve-card>` | `autonomous_resolution_executor` | Always before Resolved or Reopened |
| `ticket.quality` | `ai.tasks.qualityCheck` | `<worktual-quality-card>` | `resolution_quality_executor` | Recommend or confirm |
| `sla.advise` | `ai.tasks.slaAdvise` | `<worktual-sla-card>` | `sla_escalation_executor` | Warning is advice. Escalate confirms |
| `analytics.ask` | `ai.tasks.askMetrics` | `<worktual-insights>` | `analytics_audit_query_executor` | Read only. Numbers from Context Layer |
| `analytics.why` | `ai.tasks.askWhy` | Same insights widget | `ask_knowledge_graph` via that executor | Read only |
| `workload.advise` | `ai.tasks.workload` | `<worktual-workload>` | `workload_optimization_executor` | Recommendation only. Does not reassign |

Example:

```ts
const card = await client.ai.tasks.draftReply({
  sessionToken,
  ticketNumber: "#128",
  locale: "es",
});
// card.status === "confirmation_required"
// card.draft is editable text

await client.ai.confirm({
  sessionToken,
  proposalId: card.proposalId,
  edits: { text: card.draft },
});
```

### 4. Proactive agents (event-driven)

The partner does not run these models. Worktual runs them when mail, widget, portal, or a timer fires. The SDK **lists and decides**.

| Agent id (catalog name) | Trigger | Usual SDK status | Widget |
|---|---|---|---|
| `deflection_and_self_service_agent` | Inbound how-to, before create | `applied` if deflected, else `recommendation` | Deflection banner |
| `ticket_creation_and_capture_agent` | Inbound that still needs a case | `confirmation_required` or `applied` | Approvals |
| `classification_and_prioritization_agent` | `ticket.created` | `applied` or `recommendation` | Classify card |
| `intelligent_routing_agent` | `ticket.created` | Confirm if stealing an assignee | Assign card |
| `resolution_knowledge_agent` | `ticket.created` | `recommendation` | KB suggest |
| `similar_ticket_detection_agent` | `ticket.created` | `recommendation` | Similar tickets |
| `ticket_summary_assistant` | Create, notes, updates | `applied` (`ai_summary` only) | Summary on the ticket |
| `personalized_notifications_agent` | Assignment, comments | `applied` (bell) | `<worktual-inbox>` |
| `customer_response_drafting_agent` | `customer.replied` | `confirmation_required` | Reply draft |
| `autonomous_resolution_agent` | Customer says fixed or still broken | `confirmation_required` | Resolve card |
| `resolution_quality_agent` | Ticket Resolved | `recommendation` or confirm | Quality card |
| `sla_and_escalation_agent` | Due soon / overdue | Advice, or confirm to escalate | SLA card |
| `workload_optimization_agent` | ~5 min | `recommendation` | Workload card |
| `insights_and_analytics_agent` | ~10 min or on demand | `recommendation` | Insights |
| `root_cause_and_learning_agent` | ~1 hour | Silent `applied` | No card |

| Feature | H | U |
|---|---|---|
| List pending confirms and recommendations | `ai.proposals.list({ ticketNumber?, status? })` | `<worktual-approvals>` |
| Accept | `ai.proposals.decide({ id, decision: "confirm", edits? })` | Card primary button |
| Reject | `decision: "reject"` | Card secondary button |
| Read the live summary | `tickets.get` → `aiSummary` | `<worktual-summary>` |

Express SLA mail (1h reminder, breach → status Overdue) is not an agent. The SDK can show `dueAt` and status. It does not replace that sweep.

### 5. Context Layer questions

These are AI features. The partner asks in language. The executor calls Context Layer. The SDK never accepts a raw SQL string.

| Question | Method | Tool |
|---|---|---|
| How many, CSAT, SLA %, volume, by channel or agent | `ai.tasks.askMetrics` | `ask_semantic_layer` |
| Why a metric moved | `ai.tasks.askWhy` | `ask_knowledge_graph` |
| “Show tickets I created” as rows | `ai.turn` routed to ticket read, or `ai.tasks.listTickets` | `ask_sql_layer`, then `list_tickets` only if SQL fails |

Result rows and numbers are copied from the tool payload. Empty Context Layer config → `temporarily_unavailable`.

### 6. UI components (AI)

All accept `endpoint`, `token`, `locale`, and theme attributes (`theme-primary-color`, `theme-border-radius`, `theme-font`). Shadow DOM. No partner API key.

| Element | AI job |
|---|---|
| `worktual-login` | Staff or portal session |
| `worktual-chat` | Stream, drafts, confirm cards, locale reply |
| `worktual-approvals` | Proactive confirms and recommendations |
| `worktual-deflection` | KB answer before create |
| `worktual-summary` | `ai_summary` |
| `worktual-classify-card` | Category and priority proposal |
| `worktual-assign-card` | Assignee / queue proposal |
| `worktual-similar-tickets` | Duplicates, no merge button that auto-writes |
| `worktual-kb-suggest` | Articles for this ticket |
| `worktual-reply-draft` | Editable public reply, then Send |
| `worktual-resolve-card` | Resolve or reopen confirm |
| `worktual-quality-card` | Close-quality advice |
| `worktual-sla-card` | Risk text and escalate confirm |
| `worktual-insights` | Metric answer and “why” |
| `worktual-workload` | Load-balance advice |
| `worktual-inbox` | PNA bell items |

Host apps listen for `worktual-action` (`feature`, `proposalId`, `ticketNumber`) to refresh their own screens.

Theme tokens match the partner product so the assistant looks native. Optional footer `poweredBy: false` for strict white-label.

---

## Flows

### Flow 1 — Embed chat (UI)

1. Partner backend `auth.createSession` after its own login. Usage login row is written.
2. Page mounts `<worktual-chat token locale="es" mode="embedded">`.
3. User: “Clasifica este ticket y dime a quién asignarlo.”
4. Widget streams `ai.stream`. Super routes to triage. Executor may return two proposals.
5. Assign-if-owned comes back `confirmation_required`. User confirms on the card.
6. Usage: one login, one or more `ai.turn` rows, one `ai.confirm`.

### Flow 2 — Same request, no widget

```ts
const session = await client.auth.createSession({ tenantId, actor, locale: "es" });
const turn = await client.ai.turn({
  sessionToken: session.sessionToken,
  message: "Classify ticket #128 and suggest an assignee",
  focusedTicketId: "#128",
  locale: "es",
});
if (turn.status === "confirmation_required") {
  await client.ai.confirm({
    sessionToken: session.sessionToken,
    proposalId: turn.proposalId,
  });
}
```

### Flow 3 — Deflect, otherwise capture

1. Inbound text hits Worktual (`inbound.message`) or the partner calls `ai.tasks.deflect`.
2. DSSA searches published KB. Confident how-to → `deflect: true`, no ticket, usage feature `ai.deflect`.
3. Otherwise TCAA proposes create. Partner UI shows Approvals, or headless `ai.proposals.decide`.
4. After create, classify, route, similar, KB, and summary run. Summary lands on the ticket. Assign of an unowned ticket may apply. Assign that replaces an owner waits for confirm.

### Flow 4 — Customer reply

1. Portal or email reply emits `customer.replied`.
2. SDK `ai.proposals.list({ ticketNumber })` returns a reply draft (CRDA) and, when the wording is clear, a resolve/reopen card (ARA).
3. `<worktual-reply-draft>` lets staff edit. Send confirms. ARA never changes status until confirm.
4. Summary refreshes on its own (TSAA). Bell updates (PNA).

### Flow 5 — Ask the numbers

1. Staff session.
2. `ai.tasks.askMetrics({ message: "CSAT this week by channel", locale: "fr" })`.
3. Answer text and a table come from Context Layer. `<worktual-insights>` renders metric and ticket tables. The partner can ignore `uiActions` and chart the rows themselves.

### Flow 6 — Invoice the partner

`usage.summary` for the month: logins, `ai.turn`, `ai.stream`, confirms, rejects, and `bySkill` (for example `analytics-query`, `reply-draft`). Named tasks bill the catalog Skill. A free turn bills `data.skill_name` from the co-worker result. Calls with no Skill, including logins, stay in `byFeature` only. Wholesale bill uses those counts. The partner bills their customer.

---

## Error codes

Branch on `code`. Show `message` in the session locale. SDK calls (`/api/sdk/*` and any call that sends `X-Worktual-Sdk-Feature`) return that sentence for `en`, `es`, `fr`, `de`, `pt`, `hi`, and `ar`. An unknown language uses English. Staff chat keeps its own wording.

| Code | Meaning |
|---|---|
| `auth_required` | No session |
| `session_expired` | Refresh or mint again |
| `forbidden` | Role cannot run this Skill |
| `quota_exceeded` | Partner tier |
| `confirmation_required` | Call `ai.confirm` |
| `customer_not_found` | Create path, no CDP person |
| `ticketing_not_purchased` | Org has no Ticketing grant |
| `missing_context` | No focused ticket for a ticket Skill |
| `temporarily_unavailable` | Model or Context Layer down |
| `unsupported_operation` | Super refused the capability |

---

## Build order

1. **Session + usage** on `@worktual/ticketing`, then `ai.turn` and `ai.stream` against `/api/coworker/agent-turn`. Locale on the turn. Confirm and reject. **Shipped.** `POST /api/sdk/sessions`, `GET /api/sdk/usage/summary`, `client.auth`, `client.usage`, `client.ai`.
2. **`<worktual-chat>`** with theme, shadow DOM, streaming, confirm cards. **Shipped** in `@worktual/ticketing-ui`.
3. **Named tasks** for summarize, classify, draft reply, similar, KB, deflect. Matching chips. **Shipped.** `client.ai.tasks.*` sends `sdk_task` on `POST /api/coworker/agent-turn`. Express pins the registered Skill (`ticket.investigation.summary`, `ticket.classify.prioritize`, `reply.draft`, `ticket.detect.similar`, `knowledge.recommend.resolution`, `intake.self.service.deflection`). Chips: `<worktual-summary>`, `<worktual-classify-card>`, `<worktual-reply-draft>`, `<worktual-similar-tickets>`, `<worktual-kb-suggest>`, `<worktual-deflection>`.
4. **`ai.proposals.list` / `decide`** and `<worktual-approvals>`. **Shipped.** `GET /api/sdk/proposals` lists pending approvals (`approval:{id}`, status `confirmation_required`) and open recommendations (`recommendation:{id}`, status `recommendation`). `POST /api/sdk/proposals/:id/decide` confirms or rejects. Confirm on an approval runs the existing proactive decide path. Recommendations are acknowledged or dismissed and do not write.
5. **Metrics and why** once `CONTEXT_LAYER_URL` is set. **Shipped.** `ai.tasks.askMetrics` pins `analytics.query` (`ask_semantic_layer`). `ai.tasks.askWhy` pins `analytics.root.cause` (`ask_knowledge_graph`, which needs `ONTOLOGY_CHAT_URL`). `ai.tasks.listTickets` pins `ticket.read.search` and accepts a question, not SQL. If the certified URL is unset, the agent returns `temporarily_unavailable` before the model answers. `<worktual-insights>` shows tool values only.
6. **Python and C#** headless clients for `auth`, `ai.turn`, `ai.tasks.*`, `ai.proposals.*`, `usage.summary`. **Shipped.** `packages/ticketing-sdk-python` (`create_ticketing_client`) and `packages/ticketing-sdk-dotnet` (`TicketingClient`). Same routes and feature headers as the TypeScript client, including confirm and reject. No SQL parameter. Unavailable metric and why answers stay `temporarily_unavailable`.
7. **`usage.summary` billing breakdown** by Skill. **Shipped.** `bySkill` is `{ skill, count }[]` on `GET /api/sdk/usage/summary`, and on the TypeScript, Python, and C# clients. A named task stores its catalog Skill. A free turn stores `skill_name` from the co-worker payload. Blank skills are omitted.
8. **Remaining catalog tasks and widgets.** **Shipped.** `ai.tasks.createTicket` (`ticket.create`) streams from `<worktual-chat mode="create">`. Chips: `<worktual-assign-card>`, `<worktual-resolve-card>`, `<worktual-quality-card>`, `<worktual-sla-card>`, `<worktual-workload>`. Workload stays a recommendation and does not reassign. `<worktual-login>` covers staff login and portal OTP or password. `<worktual-inbox>` reads `GET /api/notifications`. Python and C# clients include `ai.stream`, the new tasks, login, portal OTP, and inbox.

9. **Usage surface and the login report.** **Shipped.** Widget calls store `surface: ui` and the element tag. Headless calls stay `headless`. `usage.logins` is on the TypeScript, Python, and C# clients. `element.endSession()` revokes the session and fires `worktual-session-end`.
10. **Partner turn quota.** **Shipped.** `SDK_TURN_RATE_PER_MINUTE` and `SDK_CONCURRENT_TURNS` cap SDK AI calls before the model runs. Over cap is `429` `quota_exceeded`, with the message in the turn locale. `usage.summary.quotaExceeded` counts those calls. Defaults are unlimited. Staff chat is not capped.
11. **Error contract.** **Shipped.** SDK failures return a stable `code` and a `message` in the call locale. An expired session is `session_expired`. A missing Ticketing grant is `ticketing_not_purchased`. A ticket skill with no ticket is `missing_context`. A customer or portal role, or a viewer on a write skill, is `forbidden`. A missing CDP person on create is `customer_not_found`. A refused capability is `unsupported_operation`. Model or Context Layer failures on an SDK call are `temporarily_unavailable`. Widgets show that message and put `code` on `worktual-action`. Staff chat is unchanged.
12. **Widget lists, the insights table, and the remaining chrome locales.** **Shipped.** `<worktual-chat lists>` applies `refresh_list` and `open_ticket`. Other hosts still receive `uiActions` on `worktual-action`. `<worktual-insights>` renders metric and ticket tables. Login and inbox chrome covers `fr`, `de`, `pt`, and `hi` in addition to `en`, `es`, and `ar`.
13. **Routing trace, per-partner quota, and usage event fields.** **Shipped.** `debug: true` on an SDK turn returns `trace` with agents and route endpoints. A row in `ticketing.sdk_partner_quota` sets that org's caps (`0` means off), ahead of `SDK_QUOTA_TIERS` and the process-wide env. `usage.events` returns `partnerId` (the org API key id), `agentTurns`, and `confirmRequired`. `usage.summary.quota` is the active cap.
14. **Help widgets, iframe embed, and public npm.** **Shipped.** `client.widgets.create` uses the partner key and returns a script tag plus an iframe for `wgt_…`. `client.widgets.submitTicket` and `getPublic` call `/api/public/widgets/:publicId` with no API key. `mountWorktualFrame` loads the app with `embed=1` and posts `worktual:ticketing-auth`. `mountHelpFrame` loads `/embed/help.html?id=`. `@worktual/ticketing` and `@worktual/ticketing-ui` are publishable (`npm run sdk:publish`).

Leave internal: SFT `:8022`, Hub A2A agent card, MCP process `:8020` as a partner-facing server. Partners call the SDK. The SDK calls Express. Express calls the agents.

---

## Already in the repo vs SDK gap

| In the product | Partner SDK today |
|---|---|
| Native Super → Domain → Executor | Wrapped as `ai.turn`, `ai.stream`, and named tasks |
| Catalog Skills for create, assign, resolve, quality, SLA, workload, summary, classify, reply, similar, KB, deflect, metrics | Pinned by `sdk_task`. Other executors stay internal |
| Proactive approvals and recommendations | `ai.proposals.list` / `decide` and `<worktual-approvals>` |
| `POST /api/coworker/agent-turn` and stream | Wrapped in TypeScript, Python, and C# |
| Context Layer tools | `askMetrics`, `askWhy`, `listTickets`. No SQL parameter |
| Staff login, portal OTP, notification bell | `auth.login`, `auth.portal.*`, `inbox`, `<worktual-login>`, `<worktual-inbox>` |
| MCP tool catalog | Used by agents, not exported as the partner API |
| `@worktual/ticketing` intake and ticket CRUD | Shipped. Keep for non-AI callers. AI create/update goes through confirm + the same Express routes |

CRUD methods stay for partners who file a ticket from their backend with no assistant. They are not the AI catalog. New AI work goes in `client.ai`, not in more list/update wrappers.
