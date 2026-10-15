# Dashboard Analytics — Incident Types

This catalog describes the diagnostic incident types used on the admin **Analytics** page (`/admin/dashboard/analytics`).

Analytics incidents are **tenant-scoped operational findings**, not individual missed-contact rows. Detectors aggregate events, compare them to a baseline, and open or update one incident per fingerprint when volume and significance thresholds are met. The LLM may write the headline and summary; it does not invent counts, rates, or severity.

Related plan: [DASHBOARD_ANALYTICS_DYNAMIC_PLAN.md](./DASHBOARD_ANALYTICS_DYNAMIC_PLAN.md).

---

## Status

| Code | Name | Status | Detector |
|------|------|--------|----------|
| `missed_contact_spike` | Missed-contact spike (15-minute) | **Live** | Same weekday/hour vs last 56 days |
| `weekly_missed_contact_spike` | Missed-contact spike (week over week) | **Live** | Last 7 days vs prior 7 days |
| `volume_spike_or_drop` | Inbound / handled-volume spike or drop | Planned | Equal-period and seasonal baseline |
| `queue_wait_increase` | Queue-wait increase and live backlog | Planned | Wait time + live queue depth |
| `routing_failure_increase` | Routing-failure increase | Planned | `routing_attempts` failure reasons |
| `assignment_reject_expiry` | Assignment rejection / expiry increase | Planned | Offer rejects and expired offers |
| `ready_coverage_decline` | Ready-agent coverage decline | Planned | Presence history vs expected Ready |
| `handle_time_increase` | AHT or first-response-time increase | Planned | Reporting handle / first-response KPIs |
| `callback_backlog` | Callback backlog and unrecovered missed contacts | Planned | Callback tasks + missed-contact recovery |

**Out of v1 by design:** configured SLA breach incidents. SLA policy and historical SLA-state coverage were not guaranteed when Analytics was built.

Live detectors live in `apps/cc-core/src/services/dashboard-analytics-diagnostic.ts`. Thresholds live in `apps/cc-core/src/services/dashboard-analytics-math.ts`.

---

## Shared concepts

### Metric

```text
missedContactRate =
  uniqueMissedConversations / agentDemandConversations × 100
```

- **Missed event** — one row in `ccass.agent_missed_contacts`.
- **Unique missed conversations** — distinct conversations that missed at least once in the window.
- **Agent demand** — distinct conversations that entered a live-agent queue in the same window.
- Zero demand is skipped (no rate, no incident).

### Scope

Incidents are scoped by **organization**, **channel**, and **queue** (or org-wide `all` for the weekly rollup). The UI label is the queue name when present, otherwise the channel, otherwise `all`.

### Lifecycle

| Status | Meaning |
|--------|---------|
| `candidate` | Thresholds passed; not yet persisted as active |
| `active` | Shown on Analytics; facts refresh as new buckets arrive |
| `cooling` | Condition dropped below recovery; still visible briefly |
| `resolved` | Cooldown completed; no longer an active incident |

New events **update** an existing fingerprint instead of opening a duplicate analysis. Severity and top driver changes can trigger a new LLM narrative; small numeric movement reuses the cached headline.

### Severity

`low` · `medium` · `high` · `critical`

When two incidents compete for the same UI slot, **higher severity wins**. A weekly missed-contact spike is preferred over a 15-minute spike at the same severity so the page does not hide the longer-window finding.

---

## Live incident types

### 1. `missed_contact_spike`

**What it is.** A short-window anomaly: missed contacts in a 15-minute bucket are materially worse than the same weekday and hour over the previous 56 days.

**Why it exists.** Catches sudden coverage or routing problems (lunch dip, offer timeouts stacking, no Ready agents) before they become a full-day trend.

**How it is measured**

- Bucket length: **15 minutes**.
- Baseline: matching weekday + hour slots from the last **56 days**.
- Comparison: median missed-contact rate and MAD (median absolute deviation) for a robust z-score.
- Also stored for context: average Ready agents in the bucket, oldest wait in the queue.

**Gates (need at least 3 of 4)**

| Gate | Threshold |
|------|-----------|
| Minimum unique missed conversations | ≥ 5 |
| Rate increase vs baseline | ≥ +5 percentage points |
| Relative increase | ≥ 1.5× baseline rate |
| Robust z-score | ≥ 3 |

The plan also requires the condition to persist across **two consecutive buckets** before treating it as a stable active incident.

**Severity**

| Severity | When |
|----------|------|
| Critical | Rate delta ≥ 15 points **or** robust z ≥ 5 |
| High | Rate delta ≥ 10 **or** robust z ≥ 4 |
| Medium | Rate delta ≥ 5 **or** robust z ≥ 3 |
| Low | Otherwise (passed gates but below those cuts) |

**Fingerprint**

```text
missed_contact:{organizationId}:{channel}:{queueId|org}:{topDriver}
```

**Typical headline.** Missed contacts elevated in `{queue or channel}`.

**Evidence.** Current rate vs baseline rate, unique missed vs demand, top driver share, Ready coverage and oldest wait when available.

---

### 2. `weekly_missed_contact_spike`

**What it is.** A longer-window comparison: missed-contact **events** and **rate** in the latest 7 days versus the previous 7 days, by channel/queue and as an org-wide `all` rollup.

**Why it exists.** The 15-minute detector needs several unique missed conversations in a single bucket, so sparse or slowly rising problems never fire. Week-over-week catches sustained elevation (for example 34 missed events this week vs 12 last week).

**How it is measured**

- This week: now minus 7 days → now.
- Last week: the 7 days before that.
- Compared: missed event count, unique missed conversations, demand, missed-contact rate.

**Gates**

Must have **≥ 10 missed events this week**, plus at least one of:

| Signal | Threshold |
|--------|-----------|
| Count increase | ≥ +5 events vs last week |
| Count multiplier | ≥ 1.5× last week’s events |
| Rate increase | ≥ +5 percentage points vs last week |

**Severity**

| Severity | When |
|----------|------|
| Critical | Event increase ≥ 30 **or** rate delta ≥ 15 points |
| High | Event increase ≥ 20 **or** rate delta ≥ 10 |
| Medium | Event increase ≥ 10 **or** rate delta ≥ 5 |
| Low | Otherwise (passed gates) |

**Fingerprint**

```text
weekly_missed_contact:{organizationId}:{channel}:{queueId|org}
```

Unlike the 15-minute type, weekly fingerprints do **not** include the top driver, so one weekly incident per scope is updated as drivers shift.

**Typical headline.** Missed contacts up week over week in `{queue or channel}`.

**UI.** Metric label is **Missed contacts (7-day)**. When there are no active incidents, the healthy Diagnostic state still shows a week-over-week summary line.

---

## Missed-contact drivers

Both live incident types attach a **driver mix** from `ccass.agent_missed_contacts.reason`. The top driver is the contributing-factor slice shown on the Diagnostic card and used to pick prescriptive actions.

These are **reasons**, not separate incident types. One spike incident can be mostly `no_agent_available` this hour and `offer_timeout` the next; the 15-minute fingerprint changes with the top driver, the weekly one does not.

| Reason | Label | What it means |
|--------|-------|----------------|
| `no_agent_available` | No agents available | Routing could not find a Ready, in-shift, under-capacity agent. Nobody was offered. |
| `offer_timeout` | Not picked up | An agent was offered and did not accept before the offer timer. |

Legacy rows `manual_reject` and `routing_exhausted` were backfilled onto these two codes. Conversation lifecycle still uses `routing_exhausted` for “router stopped.”

Related routing **failure** codes (used by planned `routing_failure_increase`, not stored as missed-contact reasons today):

| Routing failure | What it means |
|-----------------|---------------|
| `no_queue_members` | Queue has no assigned agents |
| `no_shift_coverage` | Members exist but none are in an active shift |
| `no_matching_skill` | Members on shift do not match required skills |
| `all_at_capacity` | Eligible agents are at channel concurrency |
| `no_ready_agents` | Eligible agents are not Ready |
| `outside_business_hours` | Contact arrived outside queue business hours |
| `routing_exhausted` | Retry budget used up |

---

## Planned incident types

These were in the original Analytics catalog. They are not live detectors yet. Descriptions below are the intended meaning so later work stays consistent.

### 3. `volume_spike_or_drop`

**What it is.** Inbound or handled conversation volume for a channel/queue/hour is unusually high or low versus the previous equal period and the same weekday/hour baseline.

**Why it matters.** A spike without a missed-contact incident still predicts staffing risk. A drop can mean a channel outage, bot deflection, or routing that never queued to agents.

**Likely facts.** Offered/queued count, handled count, channel mix, percent change vs baseline, robust z-score.

**Not the same as.** Missed-contact spike (quality of coverage) vs volume (amount of work).

---

### 4. `queue_wait_increase`

**What it is.** Customers are waiting longer in queue, or live backlog (conversations queued / offered, not yet assigned) is elevated versus baseline.

**Why it matters.** Wait can rise before missed contacts fire—especially if offers still connect, but slowly. Oldest wait is already **context** on missed-contact incidents; this type would make wait the primary finding.

**Likely facts.** Median/oldest wait seconds, queued depth, offered-not-accepted count, Ready headcount in the same window.

---

### 5. `routing_failure_increase`

**What it is.** A rise in failed `routing_attempts` (never assigned), broken out by `RoutingFailureReason`.

**Why it matters.** Missed contacts record customer-visible misses after an offer or handoff path. Routing failures catch “never offered to anyone” cases: no members, no shift, no skill, out of hours, all at capacity.

**Likely facts.** Failure count and rate by reason, queue, channel, hour; share of demand that never got an agent.

**Overlap.** `no_agent_available` / `routing_exhausted` missed-contact drivers are the customer-side cousin of these failures. This type would use the routing table as the source of truth.

---

### 6. `assignment_reject_expiry`

**What it is.** Agents are rejecting offers or letting them expire more often than baseline, even when someone is eventually assigned.

**Why it matters.** High reject/timeout rates burn Ready capacity, push customers back to queue, and inflate handle time. It can be a training, occupancy, or offer-timer problem rather than “nobody is logged in.”

**Likely facts.** Manual reject count, offer-timeout count, reject rate per offered conversation, repeat rejects by agent (aggregates only, no PII in LLM prompts).

**Overlap.** `manual_reject` and `offer_timeout` already appear as **drivers** on missed-contact incidents. This type would fire when reject/expiry is the primary anomaly even if unique missed conversations stay below the missed-contact gates.

---

### 7. `ready_coverage_decline`

**What it is.** Average Ready (or Ready+eligible) agents for a queue/channel/hour is down versus the same slot historically, or versus the scheduled workforce plan.

**Why it matters.** Coverage holes are the usual root of missed contacts and wait. Detecting the hole directly lets Analytics recommend schedule or presence changes before the miss rate trips.

**Likely facts.** Average Ready headcount, percent of interval with zero Ready, shrinkage (Not Ready / Offline), comparison to scheduled members.

**Overlap.** Ready average is already attached as evidence on `missed_contact_spike`. This type would not require a miss-rate breach.

---

### 8. `handle_time_increase`

**What it is.** Average handle time (assigned → resolved/ended) or average first-response time (assigned → first agent reply) is up versus baseline for a queue/channel.

**Why it matters.** Longer AHT reduces effective capacity: the same Ready roster completes fewer contacts, which later shows up as wait and misses. First-response delay is a quality signal even when volume is flat.

**Likely facts.** Avg handle seconds, avg first-response seconds, handled volume, occupancy proxy. KPI formulas match Reports (`apps/cc-core/src/services/reporting.ts`).

**Not in v1.** Needs stable historical assignment timestamps; SLA-style first-response policy remains excluded.

---

### 9. `callback_backlog`

**What it is.** Missed contacts that were not recovered (customer never reconnected / no completed callback), plus open callback tasks and overdue proactive callback attempts.

**Why it matters.** A spike can be “over,” but customers are still waiting for a call back. This is the recovery incident, not the live-queue incident.

**Likely facts.** Unrecovered missed count, open callback tasks, overdue callbacks, completion rate, age of oldest unrecovered miss.

**Today.** Missed-contact facts may include `unrecoveredMissedContacts`. Prescriptive already suggests **Assign callbacks** whenever a live missed-contact incident is selected. There is no standalone backlog detector yet.

---

## Prescriptive mapping (from live incidents)

Recommendations are allowlisted. The LLM may rank and phrase them; it cannot invent action keys or IDs.

| When | Action key | Intent |
|------|------------|--------|
| Top driver `no_agent_available` | `increase_ready_coverage` | Review schedule / add Ready coverage for that queue |
| Top driver `offer_timeout` | `review_offer_timeout` | Review offer timer and routing policy |
| Any live missed-contact incident | `assign_callbacks` | Recover unrecovered missed contacts |
| Forecast shortfall vs assigned members | `daily_queue_assignment` | Add eligible agents to the queue for the forecast window |

Planned prescriptive types that are not wired to a dedicated incident yet: overflow routing review, supervisor review for prolonged Not Ready, queue prioritization for forecast peaks.

---

## What is intentionally not an incident

| Topic | Why it is not a diagnostic type today |
|-------|--------------------------------------|
| SLA breach | Policy and historical SLA state were not reliable enough for v1 |
| Sentiment / CSAT drop | Not in the v1 operational fact set |
| Single missed contact | Too noisy; incidents require volume + significance gates |
| Copilot or bot quality | Separate from queue/agent operational diagnostics |
| Agent-level performance | My Performance / Reports KPIs, not org Analytics incidents |

---

## Source files

| Area | Path |
|------|------|
| Detectors, fingerprints, narratives | `apps/cc-core/src/services/dashboard-analytics-diagnostic.ts` |
| Thresholds and bucket math | `apps/cc-core/src/services/dashboard-analytics-math.ts` |
| Incident persistence | `apps/cc-core/src/services/dashboard-analytics-storage.ts` |
| Recommendations | `apps/cc-core/src/services/dashboard-analytics-prescriptive.ts` |
| Missed-contact reasons | `apps/cc-core/src/services/agent-missed-contacts.ts` |
| Routing failure reasons | `apps/cc-core/src/services/routing.ts` (`RoutingFailureReason`) |
| Analytics UI | `apps/web/src/components/dashboard/dashboard-analytics-panel.tsx` |
| Original catalog | [DASHBOARD_ANALYTICS_DYNAMIC_PLAN.md](./DASHBOARD_ANALYTICS_DYNAMIC_PLAN.md) § Diagnostic Analytics |
