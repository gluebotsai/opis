# Lead Agent Pipeline (canonical)

**Assign / nurture gate: total score ≥ 40.**  
Bands: Hot 70–100 · Warm 40–69 · Cold 0–39.  
Category enum: `hot | warm | cold` (no `cool`).

Scoring uses Fit (0–50) + Intent (0–50). The deterministic formula in
`backend/src/service/ai/lead-score.ts` and the Python heuristic in
`score_lead_agent.py` are the numeric source of truth. The LLM may propose
scores but must be normalized to Fit/Intent caps and the same gate.

```
New Lead
  → Enrichment (owns firmographics)
  → Scoring (owns fit/intent/total)
  → Summary (owns narrative)
  → score ≥ 40 → Assignment (rep, SLA)
  → score < 40 → Nurturing (drip; re-score → Assignment when ≥ 40)
```

**Ownership vs nurture**

- New `lead` contacts stay **unowned** (pool) until score ≥ 40 or an explicit sales claim.
- **Company owner ≠ lead owner.** List/detail Owner is `contact_profiles.owner_user_id` only; company owner is shown separately on the company card.
- After score: if total &lt; 40 and contact owner is **null** → enqueue nurture. If contact already has an owner → `owned_below_gate_no_nurture` (no auto-nurture over a claimed lead).
- Nurture sends via the org **CRM email channel** in Accounts
  (`setup_channel_configs` with `channel_type=email` and `product_ids`
  containing `"crm"`, joined to `setup_email_configs` / `mail_oauth_connections`).
  `is_bot` is CCAAS-only and is ignored. Does **not** use a salesperson's mailbox.
- After score ≥ 40 assignment, the **welcome-lead** agent composes a first-touch
  email and CRM sends it from the **assigned owner's connected inbox**
  (Google/Microsoft). If the owner has no connected mail, delivery fails
  explicitly and the owner is notified to connect email in Configuration.

**Meeting agent mail**

- Booking-time meeting briefs and T−24h/T−1h owner reminder briefs are sent
  from the same org CRM email channel. The owner brief includes the contact,
  company, pipeline/BANT context, meeting details, and up to 12 recent CRM
  activities (email/call/meeting/note/task).
- After a meeting transcript is attached, the LLM produces both the detailed
  internal MOM and a customer-safe MOM email. **Customer MOM** goes from the
  assigned owner's connected inbox when the contact is owned; otherwise CRM-BOT.
  The detailed internal MOM goes to sales managers and organization admins
  (plus the contact owner) via CRM-BOT.
- The customer MOM must not expose internal sentiment, risks, objections,
  lead score, pipeline data, CRM links, or transcript excerpts.
- Nurture and owner prep/reminder briefs use CRM-BOT for **internal** mail;
  customer-facing mail on owned leads uses the assigned rep's connected inbox
  (welcome, meeting reminders, MOM, demo handoff ack).
- **Demo on bot mail:** CRM bot must **never** ask for slots or book calendar
  events. When a lead requests a demo/meeting on a nurture (bot) thread, the
  agent assigns a rep (`forceSalesIntent`) and replies that the rep will
  contact them. Calendar booking runs only on the **assigned rep's** connected
  mailbox after ownership is set.
- Meeting capture resolves speaker **email → CRM display name** (contact,
  assigned reps, guests) when Recall provides participant email.

## External inserts (connectors / campaign / MyAccount)

Writers do **not** need to call CRM HTTP. Person identity is inserted into `cdp.customer_profile`:

1. CDP `AFTER INSERT` trigger ensures thin `crm.contact_profiles` (if missing), enqueues `lead_enrichment_jobs` (`pending`) + `NOTIFY crm_lead_enrichment`.
2. Secondary trigger on `contact_profiles` INSERT is idempotent with the CDP path.
3. API `LISTEN` (and/or cron `POST /api/cron/lead-enrichment`) drains jobs at bounded concurrency.
4. Score → summary → assign|nurture continues as today after enrich settles.

Bulk (single contact or lakhs): enqueue is immediate; processing is paced. Reconciler covers missed CDP/profile jobs: `POST /api/cron/lead-enrichment-reconcile`.

## Phase 1 audit notes

- Gate / bands / Fit+Intent caps: aligned in TS + Python (`SALES_READY_SCORE = 40`).
- Assignment: territory + load + deal-size seniority + **rep maturity** from
  closed-won count (`repMaturityFromClosedWon` / `maturityWinRateWeight` in
  `territory-assignment.ts`).
- LLM scores must pass `_normalize_llm_score` / TS heuristic caps before assign.

## Phase 2

Lifecycle runs from create through Won/Lost: one elevation per run (no apply
cooldown — CRM events re-evaluate immediately), evidence
bars (`lead-lifecycle-evidence.ts`), optional `flag_for_review`, high-risk
owner confirmation. Stall cron: `POST /api/cron/lifecycle-stall`.
Meeting Analysis persists structured rows in `meeting_analyses`; lifecycle
consumes that contract (not raw transcript in prompts).
Document agents (proposal / quote / invoice) are triggered by stage — never send
without `approved_by` + `approved_at` (approve via
`POST /api/sales/proposals|quotes/:id/approve` and
`POST /api/finance/invoices/:id/approve`). Over-cap quote discounts require
Finance approve **or** reject (`POST /api/sales/quotes/:id/reject-discount`
with a reason); reject notifies the salesperson via CRM-BOT and keeps send
blocked until they revise.

### Post-meeting commercial drafts

`post_meeting_process` creates **draft** proposal, quote, or **both** when
scope and/or pricing were discussed in the meeting:

| Branch | When | Output |
|--------|------|--------|
| Proposal only | Scope sufficient, no pricing topic | Proposal draft (personalized from transcript) |
| Quote only | Pricing discussed, no proposal scope | Quote draft with **catalog** `inventory.products` unit prices |
| Both | Scope + pricing | Proposal + quote drafts on the same deal |

Incomplete transcript pricing → quote lines use catalog list prices (never
invented / $0 placeholders). Over-cap discounts route to Finance before send
(`evaluateQuoteDiscountApproval`). CRM-BOT + configured delivery email notify
the sales owner (`commercial-notify.ts`). **Customers are never auto-emailed**
proposal/quote from agents — salesperson Send is the only customer commercial path.

### Commercial acceptance chain (email v1)

Inbound customer email is matched by `commercial-acceptance.ts`:

1. Parse `PROP-\d+` / `QUOTE-\d+` in subject/body; else fall back to the
   **most recently sent** proposal (`shared`) or quote (`sent`) on the deal.
2. Classify **accept** vs **decline** (customer-voice inbound only).
3. Apply:

| Event | Action |
|-------|--------|
| Proposal accepted (quote not already on deal) | Mark proposal `accepted` → quote draft from proposal (catalog pricing) |
| Proposal accepted (both already on deal) | Mark accepted only — no further draft |
| Quote accepted | `acceptQuote` → order + **invoice draft** `pending_approval` (no customer email) |
| Proposal/quote declined | Update status + notify sales owner |

Finance receives configured mail + bell when an invoice draft needs approval;
sales is told the invoice was **submitted for finance approval** (not sent).
Finance reject: `POST /api/finance/invoices/:id/reject` → notifies sales.

### Pipeline forecast audit (HITL)

`pipeline_forecast` (`forecast_audit_agent.py`) judges whether an open B2B
deal's current `stage` and `expectedCloseDate` are realistic given activity
evidence (reusing `extractSignals` from `lead-lifecycle-signals.ts`), and
writes only to the five `Deal.forecast*` overlay fields (`forecastCategory`
`commit|best_case|pipeline|omitted`, `forecastConfidencePercent`,
`forecastFlagged`, `forecastReason`, `forecastLastRunAt`). **It never mutates
`Deal.stage` or `Deal.expectedCloseDate`** — those stay a human edit, same
HITL boundary as the `lead_lifecycle` stage-change gate. A 30-minute cron
sweep (`processPipelineForecastSweep`, throttled to once/24h per deal) drives
it; when `flagged`, `notifyOwnerOrAdmins(...)` deep-links the owner to
`/sales/:dealId`. The pipeline board (`SalesPipelinePage.tsx`) surfaces the
category/confidence as a badge and flagged deals with a "Review forecast"
indicator on each deal card.

### Sales & Pre-sales Coach (HITL — private feedback)

`sales_coach` (`sales_coach_agent.py`) reviews one call/meeting transcript
right after `attachActivityTranscript()` captures it (event-driven, same
trigger site as `meeting_mom`/`post_meeting_process` — not cron-driven) and
gives the rep who logged it (`ContactActivity.createdByUserId`) private,
evidence-based coaching on discovery quality, objection handling, methodology
adherence, and a qualitative talk-balance impression (never a numeric
talk-listen ratio — there is no reliable speaker-turn data in the ingested
transcript sources to compute one honestly). Output persists to
`CoachingInsight` (upsert by `activityId`, idempotent) and is delivered via
`notifyUsers([repUserId])` — **rep only, never admins/managers**, the one
deliberate deviation from the `notifyOwnerOrAdmins` admin-fallback pattern
used elsewhere, because privacy is this agent's explicit HITL rule.
`overallImpression` (`strong|solid|needs_work`) is a qualitative band, not a
numeric score — it must never look like a formal performance rating and is
never a standalone basis for review. Reps see the full per-interaction detail
in **My Coaching** on `/reports`; managers/admins see only aggregate
`overallImpression` counts per rep in **Team Coaching Trends** — a
content-level restriction enforced in `getCoachingTrendsForOrg()` (never
selects `coachingNote`/`highlightedMoment`), on top of normal RBAC, since
those roles otherwise have full record access. No heuristic fallback exists
for coaching content — when the LLM is unavailable the agent skips honestly
(`status: "skipped", reason: "llm_not_configured"`), same as `meeting_mom`.

### Compliance & Privacy Control (HITL — human-gated deletion)

`compliance_privacy` (`compliance_privacy_agent.py`) classifies one inbound
email that already matched the existing `email-auto-reply-job.ts`
`SENSITIVE_PATTERNS` GDPR/CCPA/privacy keyword filter (category
`"compliance"`). That regex escalation (`needsManualResponse` +
`notifyOwnerOrAdmins`) is unchanged and stays the safety net regardless of
what this agent does — it is purely additive judgment on top, never a
replacement, so a human still sees every flagged email even if the LLM is
unavailable or misclassifies. The LLM sorts the email into `data_deletion`,
`marketing_optout`, `data_access`, `other`, or `not_a_privacy_request` (the
last exists so the LLM can dismiss keyword false-positives, e.g. a vendor's
own "we are GDPR compliant" marketing copy, without creating noise).

**Autonomous vs. human-gated split (hard constraint):** the agent only ever
classifies + drafts. `marketing_optout` is the **one** autonomous mutation —
safe because it is additive/reversible — and sets
`ContactProfile.marketingOptOut`/`marketingOptOutAt` immediately, enforced in
`lead-nurture-job.ts` (checked alongside the existing
`leadStatus === "disqualified"` skip so opted-out contacts stop receiving
nurture sends). `data_deletion` and `data_access` are queued as a
`PrivacyRequest` (upsert by `activityId`, idempotent) and broadcast to **all
admins** (`listAdminUsers` + `notifyUsers`, not `notifyOwnerOrAdmins` —
deletion authority belongs to admins specifically, not a deal/contact owner
who may be a sales rep with no legal authority) with a deep link to
`/configuration/privacy-requests`. An admin must explicitly **Confirm &
delete** there before `executePrivacyRequestCommand` runs the existing
`deleteContactCommand` cascade — the agent itself never deletes data and
never emails the customer (same "customer commercial path is human-only"
precedent as `post_meeting_process`; the drafted acknowledgment is for the
admin to review/send). No heuristic fallback for classification content —
same honest-skip approach as `sales_coach`.

### Invoice Escalation (HITL — draft only, human sends)

`invoice_escalation` (`invoice_escalation_agent.py`) judges the collections
risk of one overdue B2B/B2B2C invoice on a **30-minute cron sweep**
(`processInvoiceEscalationSweep`, throttled to once/24h per invoice) — invoices
have no inbound-message trigger like Compliance & Privacy, so this agent is
cron-driven, same shape as `pipeline_forecast`. The sweep first calls the
existing `processOverdueInvoices()` (flips `sent → overdue` + a plain
`invoice_overdue` admin notification) — that function existed but was never
wired into cron or the scheduler until this agent's sweep closed the gap; it
remains unchanged. The agent's value-add is the LLM judgment layer on top: a
severity band (`watch|escalate|urgent`) grounded in days overdue, invoice
amount, payment terms, the linked deal's stage, and the company's own prior
payment history (did their past invoices pay on time or late), plus two
drafted texts — an internal note for the account owner and a customer-safe
reminder.

**HITL rule (hard constraint):** the agent only ever writes the four
`escalation*` overlay fields on `Invoice` (`escalationSeverity`,
`escalationReason`, `escalationDraft`, `escalationLastRunAt`) plus
notifications — it never marks an invoice paid/void and never changes
`dueAt`/`total`. It never sends `escalationDraft` itself; that stays a human
copy/send action, same "customer commercial path is human-only" precedent as
`post_meeting_process`, `sales_coach`, and `compliance_privacy`.
`notifyOwnerOrAdmins(...)` deep-links the deal owner to `/finance/:invoiceId`
whenever severity is set; `severity === "urgent"` additionally notifies
`listFinanceUsers()` (billing escalation recipients), not just the deal
owner. `FinancePage.tsx` shows a severity badge next to the status pill;
`InvoiceDetailPage.tsx` shows a "Collections risk" panel with the reason and
a copyable reminder draft. Heuristic fallback
(`decide_invoice_escalation_heuristic`, offline-only) uses simple
days-overdue thresholds as a floor, same "guess conservatively when evidence
is thin" philosophy as `pipeline_forecast`'s heuristic.

### Expansion & Revenue Matcher (HITL — draft only, human sends)

`expansion_matcher` (`expansion_matcher_agent.py`) judges whether one
existing B2B/B2B2C account shows a genuine upsell/cross-sell opportunity, on
a **24-hour cron sweep** (`processExpansionMatcherSweep`, throttled to
once/7 days per company since expansion signals don't shift daily like open
deals or overdue invoices). The candidate population is companies with at
least one `closed_won` deal; the agent looks only at that account's own deal
history — closed-won deal count/total/average and days since last close,
whether a deal is already open on the account (so it doesn't duplicate
active sales motion), the products already purchased (via `QuoteLine`/
`InvoiceLine` names on that account's deals), and a bounded list of other
active catalog products the account hasn't purchased — never external
firmographic signals.

Output is a signal band (`none|watch|opportunity`) plus a rationale and, when
not `none`, outreach talking points for the account owner: `watch` is a
single closed-won deal with a long gap since close (renewal check-in);
`opportunity` is multiple closed-won deals with no open deal already
covering it (a clear upsell/cross-sell candidate).

**HITL rule (hard constraint):** the agent only ever writes the four
`expansion*` overlay fields on `Company` (`expansionSignal`,
`expansionReason`, `expansionDraft`, `expansionLastRunAt`) plus a
notification — it never creates a deal/quote and never edits any other
company field. It never contacts the account itself; sending
`expansionDraft` (or starting a new deal) stays a human action, same
"customer commercial path is human-only" precedent as `post_meeting_process`,
`sales_coach`, `compliance_privacy`, and `invoice_escalation`.
`notifyOwnerOrAdmins(...)` deep-links the company owner to `/company/:id`
whenever a signal is set. `CompaniesPage.tsx` shows a signal badge on each
account card; `CompanyDetailPage.tsx` shows an "Expansion opportunity" panel
with the reason and a copyable outreach draft. Heuristic fallback
(`decide_expansion_heuristic`, offline-only) uses simple closed-won
deal-count/recency thresholds as a floor, same "guess conservatively when
evidence is thin" philosophy as the other cron-driven agents' heuristics.

## Agent step visibility (live activity trace)

Every proactive agent should show **what it is doing, step by step** — not a
raw log dump, and not just a final status. This is a **shared,
agent-agnostic** pattern, live for all native Python agent pipelines:
`lead_enrichment`, `lead_scoring`, `lead_nurture`, `lead_lifecycle`,
`email_auto_reply`, `lead_summary`, `sales_assignment`, `meeting_brief`,
`meeting_reminder`, `meeting_miss_escalation`, `meeting_mom`,
`post_meeting_process`, `pipeline_forecast`, `sales_coach`,
`compliance_privacy`, `invoice_escalation`, `expansion_matcher`. (Deferred:
`assist_meeting` — live in-meeting coaching has many runs per session and a
different shape.)

**Data model** — `crm.agent_step_events` (Prisma `AgentStepEvent`): one row
per `(jobId, step)`. `agent` identifies which agent produced the row (one of
the 17 above); `step` is a stable code name (e.g. `search_ddg`, `compute`,
`decide`); `label` is the curated, human-readable sentence shown in the UI;
`status` is `started | ok | failed | skipped`; `detail` is a small curated
JSON object (counts, urls, field names — **never** raw HTML/prompt/tool
dumps). `contactId` is nullable — a company-only `sales_assignment` run has
none. Step **display order** is a fixed, hardcoded pipeline per agent on the
frontend (`AGENT_STEP_ORDERS` lookup in
[`frontend/src/components/contacts/AgentStepTimeline.tsx`](../frontend/src/components/contacts/AgentStepTimeline.tsx)),
not a stored sequence number, so ordering never depends on write timing.

### Two correlation modes (`jobId`)

The 17 agents split into two groups depending on whether they have a
Postgres job-queue table:

- **Job-backed** (`lead_enrichment`, `lead_scoring`, `lead_nurture`,
  `lead_lifecycle`, `email_auto_reply`): each has a job-queue table
  (`status`, `attempts`, `lastError`) the backend already pages through for
  "Recent runs"; that row's id is reused as `agent_step_events.job_id`. The
  Fastify `.../:entityId/steps` route resolves the real job itself via
  `find<X>JobByOrgContact` — ai-service does not send a `jobId`.
- **Job-less / ephemeral-run** (`lead_summary`, `sales_assignment`,
  `meeting_brief`/`meeting_reminder`, `meeting_miss_escalation`,
  `meeting_mom`, `post_meeting_process`, `pipeline_forecast`, `sales_coach`,
  `compliance_privacy`, `invoice_escalation`, `expansion_matcher`): these run
  inline and return a result with no job table. Each Python
  `run()` generates `job_id = str(uuid4())` at the top and threads it
  through native pipeline state; every step for that invocation reuses the same
  id. ai-service sends it explicitly
  as `jobId` in the step POST body, and the Fastify route uses it directly —
  no job-table lookup. "Recent runs" for these agents is derived straight
  from `agent_step_events` grouped by `job_id`
  (`listRunsForAgentPage` / `findRunByJobIdFromEvents` in
  [`agent-step-events.ts`](../backend/src/dao/ai/agent-step-events.ts)),
  with run status/lastError derived from the worst step status in that group
  (`failed` > `skipped` > `running` (open step) > `ok`).

### Dynamic agent string

One native pipeline module can serve two dashboard-visible agent ids:
`meeting_brief_agent.py` emits `"meeting_reminder"` when
`state["reminder_window"]` is set, else `"meeting_brief"`. `traced_step`'s
`agent` parameter accepts `str | Callable[[State], str]`, resolved against
state at emit time, so the Fastify route (`internalMeetingBriefRoutes`) reads
`agent` from the request body (validated against an allow-list) instead of
hardcoding one.

**Flow** (ai-service → Fastify → UI, reusing the same transport for every
agent — nothing new per agent beyond wiring):

1. [`ai-service/app/agents/step_trace.py`](../ai-service/app/agents/step_trace.py)
   holds the shared `traced_step(module_path, agent, step, label, detail_fn,
   id_field="contact_id", job_id_field=None)` decorator (and the underlying
   `emit_step` for inline sub-steps, e.g. `map_fields_via_llm` inside
   enrichment's `validate`). `id_field` is `None` for `sales_assignment`
   (no per-call URL entity — a target may be company-only), and
   `job_id_field="job_id"` for every ephemeral-run agent. Every agent's
   the pipeline wraps its imperative nodes with this decorator instead of
   each having its own copy. `CrmClient.post_agent_step(...)` is
   fire-and-forget with a short timeout and swallows all errors — a
   step-logging hiccup can never block or fail the agent run.
2. Fastify receives these at one `POST .../steps` route per module:
   `/api/internal/{enrichment,scoring,nurture,lifecycle}/:contactId/steps`
   and `/api/internal/auto-reply/:activityId/steps` (job-backed, in
   [`internal-lead-agents/routes.ts`](../backend/src/modules/internal-lead-agents/routes.ts));
   `/api/internal/summary/:contactId/steps` and
   `/api/internal/meeting-brief/:activityId/steps` (also in
   `internal-lead-agents/routes.ts`); flat `/api/internal/assignment/steps`
   (no entity segment, in
   [`internal-assignment/routes.ts`](../backend/src/modules/internal-assignment/routes.ts));
   and `/api/internal/{meeting-miss,meeting-mom,post-meeting}/:activityId/steps`
   (new file,
   [`internal-meeting-agents/routes.ts`](../backend/src/modules/internal-meeting-agents/routes.ts));
   and `/api/internal/forecast/:dealId/steps`
   ([`internal-forecast/routes.ts`](../backend/src/modules/internal-forecast/routes.ts)).
   All persist via the same
   [`backend/src/dao/ai/agent-step-events.ts`](../backend/src/dao/ai/agent-step-events.ts).
   Only enrichment additionally fans this out over the in-process pub/sub
   ([`backend/src/service/ai/lead-enrichment-events.ts`](../backend/src/service/ai/lead-enrichment-events.ts));
   the frontend does not currently subscribe to it (see note below), so every
   other agent intentionally skips adding a publish call rather than build
   more dead plumbing.
3. The contact page never shows step detail — only the Agents module does
   (see UI below). Enrichment's contact-page SSE endpoint
   (`GET /api/contacts/:id/enrichment/events`) still only surfaces the
   ephemeral Enriching/Enriched pill (`event: enrichment`); its `event: step`
   forwarding and `GET /api/contacts/:id/enrichment/steps` are unused by any
   current UI (kept for the SSE-adjacent contract, not wired to a
   subscriber). Runs pages fetch once per page load rather than living-update
   while open — flag if true live-while-open behavior is wanted, since that
   would need the pub/sub or polling reintroduced deliberately.
4. Historical reads (all 17 agents): `GET /api/agents/:agentId/runs/page`
   (paginated, status-filterable, contact-hydrated — backs the runs list
   page) and `GET /api/agents/:agentId/runs/:jobId/steps` (run summary +
   steps for one run's detail page), both served by
   [`backend/src/service/ai/agents-commands.ts`](../backend/src/service/ai/agents-commands.ts)'s
   `listAgentRunsPageCommand` / `getAgentRunStepsCommand`. A single
   `AGENT_RUN_SOURCES` registry maps each `agentId` to a discriminated
   `{ kind: "job" }` (job DAO's `list<X>JobsPage` / `find<X>JobById`) or
   `{ kind: "events", agent }` (the grouped-events DAO functions above) —
   the two shapes are structurally identical, so `toRunSummary` needs no
   per-agent adapter. `synthesizeTerminalSteps` (reconstructing a
   `load_context` step for jobs that never reached Python, e.g.
   `contact_not_found`) only applies to `kind: "job"` sources — an
   events-backed run only exists because at least one event was recorded, so
   there is nothing to synthesize.

**UI**: [`AgentStepTimeline`](../frontend/src/components/contacts/AgentStepTimeline.tsx)
is the shared, pure presentational component (ordered list, status icon,
curated detail chips, duration) — used only in the Agents module, as its own
dedicated pages rather than an in-card dropdown/modal or a contact-page
popover, so it stays out of the contact page and usable as run history grows:

- [`AgentRunsPage`](../frontend/src/pages/AgentRunsPage.tsx)
  (`/agents/:agentId/runs`, linked from each supported agent's card on the
  Agents dashboard) — a table of runs (contact, status, updated, duration)
  with pagination + status filter, parameterized by `agentId`. Renders "No
  contact (company-level)" in place of the contact name/link when
  `contactId` is null.
- [`AgentRunDetailPage`](../frontend/src/pages/AgentRunDetailPage.tsx)
  (`/agents/:agentId/runs/:jobId`) — one run's full step timeline (via
  `AGENT_STEP_ORDERS[agentId]`), opened by clicking a row in the table above.

**To extend to another agent**: decide job-backed vs. ephemeral-run, then
wrap its `build_graph()` nodes with `traced_step(...)` from `step_trace.py`
(passing `job_id_field="job_id"` and generating `job_id = str(uuid4())` in
`run()` if ephemeral); add a `POST .../steps` route (reusing
`internal-lead-agents/routes.ts`'s `persistAgentStep` helper, or the flat/
activity-keyed patterns in `internal-assignment/routes.ts` /
`internal-meeting-agents/routes.ts`); add an entry to `AGENT_RUN_SOURCES`
(`agents-commands.ts`) and `AGENT_RUN_IDS` (`frontend/src/services/agents.ts`);
and a step-order array in `AGENT_STEP_ORDERS`. Do not invent a second
persistence, transport, or page-template mechanism.
