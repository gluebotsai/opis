# Worktual Hub — Integration Guide for Spokes

**Audience:** Contact Centre, Ticketing, CRM, Campaign engineering & operations  
**Version:** 1.0  
**Protocol:** A2A (JSON-RPC) + typed skill contracts (`urn:worktual:a2a:typed-skills:v1`)

---

## 1. What Hub is

**Worktual Hub** is the enterprise orchestration layer between spokes. It:

- Loads **customer and org context** (CDP)
- Produces a **business strategy** (CVM)
- **Validates** actions against policy, consent, and enabled spokes
- **Dispatches** approved work back to spokes via A2A

Hub is the place for **cross-spoke decisions**, not for routine spoke-local operations.

```
Spoke ──escalate/query──▶ Hub ──strategy──▶ Dispatch ──A2A──▶ Spoke(s)
                              │
                              └── if cannot auto-close ──▶ Human ops / supervisor
```

---

## 2. What Hub is NOT

| Hub does **not** | Spoke handles locally |
|------------------|----------------------|
| Route conversations to human agents in your queue | Workforce routing, transfers, presence |
| Replace your inbox UI or monitoring screens | e.g. `cc.conversation.*`, `cc.monitoring.*` |
| Execute arbitrary writes without policy | High-impact skills need Hub approval path |
| Invent customer facts | Only uses CDP context + your payload |
| Talk to end customers directly | Hub returns `suggestedAgentReply` for **your** agent to deliver |

---

## 3. When to call Hub

### Call Hub when

- The situation needs **customer CDP context** (churn, tickets, appointments, consent)
- The fix spans **more than one spoke** (e.g. CC + ticketing + CRM)
- You need **org policy** applied (contact windows, enabled spokes, guardrails)
- You need a **validated action plan** with audit trail (`requestId`, `strategyId`)
- An **ops anomaly** fired (metric breach) and automated remediation is required
- A **supervisor escalation** is not solvable by local spoke skills alone

### Do NOT call Hub when

- You only need a local read (list queues, summarize conversation, monitoring snapshot)
- You are doing **normal agent-to-agent conversation routing**
- You can complete the task with a single spoke skill and no cross-product context
- You only need evidence (e.g. `cc.anomaly.investigate`) with no strategy decision

---

## 4. Escalation ladder (recommended model)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Spoke detects issue (monitoring, supervisor, agent)     │
└───────────────────────────────┬─────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Spoke escalates to Hub (spoke-query or anomaly alert)   │
│    — NOT the same as routing chat to another human agent    │
└───────────────────────────────┬─────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Hub tries to handle autonomously                        │
│    • CDP context  • CVM strategy  • Validate  • Dispatch    │
└───────────────────────────────┬─────────────────────────────┘
                                ▼
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
   ┌──────────────────────┐            ┌──────────────────────┐
   │ Hub handled          │            │ Hub → human            │
   │ dispatch items run   │            │ escalate/notify ops,   │
   │ on spoke skillIds    │            │ or no_action + reason  │
   └──────────────────────┘            └──────────────────────┘
```

**Hub handled** = receipt contains `dispatch[]` items your spoke can execute.  
**Hub → human** = `escalate`/`notify` to ops supervisors, empty dispatch, `validated: false`, or guardrails block.

---

## 5. Hub skills (inbound to Hub)

Hub exposes three A2A skills:

| skillId | Use when |
|---------|----------|
| `spoke-query` | Interactive escalation or coworker query from a spoke (with customer + question) |
| `run-pipeline` | Anomaly alert (`cdp.anomaly_alert`) or generic pipeline run |
| `leftover-work` | CRM-style remainder work not on the spoke card |

If `skillId` is omitted, Hub infers from payload (org + cdpId + query → `spoke-query`; `alert_id` → `run-pipeline`).

---

## 6. Calling Hub (spoke → Hub)

### Transport

- **A2A JSON-RPC** to Hub endpoint (not Kafka for spoke-initiated queries)
- Message parts: `data` (preferred) and/or `text`
- Include typed fields per `worktual-envelope.v1.json`

### Required fields

| Field | Required | Notes |
|-------|----------|-------|
| `organizationId` | Yes | Tenant bigint |
| `cdpId` | Yes* | Customer CDP id (*ops org-level anomalies may use placeholder e.g. `ops:anomaly`) |
| `query` / `instruction.description` | Yes for spoke-query | Plain-language escalation reason |
| `spoke` / `source` | Recommended | `contact_centre`, `ccaas`, `ticketing`, `crm`, `campaign` |
| `channel` | Recommended | `web`, `voice`, `email`, etc. |
| `requestId` | Optional | Your correlation id; Hub may assign one |

### Example: Contact Centre supervisor escalation

```json
{
  "organizationId": 1003,
  "cdpId": "1830917733048487",
  "spoke": "contact_centre",
  "source": "ccaas",
  "channel": "web",
  "skillId": "spoke-query",
  "query": "Support queue depth 18, abandonment rising. Need coordinated staffing and investigation actions.",
  "recent_event": {
    "conversationId": "conv-456",
    "queueId": "queue-support",
    "monitoringSnapshotId": "snap-789"
  }
}
```

### Example: Ops anomaly (often via Kafka; same schema for A2A)

```json
{
  "schema": "cdp.anomaly_alert",
  "version": "1.0",
  "alert_id": "d0e1f2a3-b4c5-6789-3456-890123456789",
  "organization_id": 1003,
  "rule_id": "cc.abandonment",
  "spoke": "Contact Centre",
  "metric_key": "abandonment_rate",
  "severity": "high",
  "observed": 18.2,
  "threshold": 8.0,
  "threshold_unit": "percent",
  "trigger_type": "ops_anomaly",
  "affected_product": "ccaas",
  "cdp_id": "1830917733048487",
  "stat_context": { "total": 110, "abandoned": 20 }
}
```

---

## 7. What Hub returns (Hub → spoke)

Task artifact / receipt shape:

```json
{
  "status": "completed",
  "skillId": "spoke-query",
  "requestId": "…",
  "strategyId": "…",
  "customerId": "…",
  "primaryObjective": "ops_anomaly_response",
  "summary": "…",
  "suggestedAgentReply": "<p>…</p>",
  "dispatch": [
    {
      "action_id": "…",
      "action_type": "escalate",
      "spoke_target": "contact_centre",
      "channel": "call",
      "priority": 1,
      "timing": "immediate",
      "description": "Why: …\n\nContact Centre should …\n\nDone when: …",
      "metadata": { "skillId": "cc.escalation.acknowledge" },
      "status": "queued"
    }
  ]
}
```

| Field | Meaning for spokes |
|-------|-------------------|
| `summary` | Strategy narrative for supervisors / audit |
| `suggestedAgentReply` | HTML-safe text for **your agent** to show the customer (spoke-query only) |
| `dispatch[]` | Work items Hub wants executed on target spokes |
| `description` | Operator instructions: **Why** / what to do / **Done when** |
| `metadata.skillId` | Preferred spoke skill when multiple exist on your card |

---

## 8. Hub dispatch back to your spoke (Hub → spoke A2A)

When Hub dispatches to you, the envelope includes:

```json
{
  "source": "hub",
  "organizationId": "1003",
  "skillId": "cc.callback.create",
  "cdpId": "1830917733048487",
  "requestId": "…",
  "strategyId": "…",
  "actionId": "…",
  "actionType": "callback",
  "channel": "web",
  "spokeTarget": "contact_centre",
  "description": "…",
  "instruction": {
    "actionType": "callback",
    "description": "…"
  },
  "suggestedAgentReply": "…"
}
```

**Your responsibilities:**

1. Map `actionType` → your Agent Card `skillId` (or use `metadata.skillId` when present)
2. Fill required skill arguments from `description` + `recent_event` context you already hold
3. Return skill result per `skill-result.v1.json`
4. Do **not** treat `description` as a customer-visible message unless it is also in `suggestedAgentReply`

### Contact Centre — common Hub action → skill mapping

| Hub `actionType` | Typical CC skill |
|------------------|------------------|
| `escalate` | `cc.escalation.acknowledge`, `cc.monitoring.escalation.read` |
| `notify` | `cc.monitoring.snapshot.read`, `cc.monitoring.escalation.read` |
| `open_task` | `cc.anomaly.investigate`, `cc.analytics.root-cause.analyze` |
| `assign` | `cc.task.accept`, `cc.task.list` |
| `callback` | `cc.callback.create` |
| `service_recovery` | `cc.conversation.context.read`, `cc.conversation.summarize` |
| `service_intervention` | `cc.conversation.summarize` |
| `bot_popup` | `cc.webchat.proactive-engagement.trigger` |

Hub picks the first skill your **live** Agent Card exposes.

### Ticketing — common Hub action → skill mapping

| Hub `actionType` | Typical ticketing skill |
|------------------|-------------------------|
| `escalate` | `tk.ticket.escalate`, `tk.ticket.manage` |
| `notify` | `tk.proactive.notify.staff` |
| `open_task` | `tk.ticket.create`, `tk.ticket.manage` |
| `assign` | `tk.ticket.assign.auto` |
| `service_recovery` | `tk.ticket.read`, `tk.ticket.manage` |
| `service_intervention` | `tk.proactive.ticket.summarize` |

---

## 9. Allowlisted actions

Hub only dispatches **catalog allowlisted** `action_type` values, for example:

**Service:** `escalate`, `assign`, `notify`, `open_task`, `create_ticket`, `service_recovery`, `service_intervention`

**Engagement:** `callback`, `bot_popup`, `send_email`, `call`, `schedule_call`

**Growth:** `retain`, `offer`, `high_touch_retention`, `suppress_campaign`, …

Each action is valid only on specific `spoke_target` values. If your spoke is not in `enabled_spokes` for the tenant, dispatch is filtered out.

---

## 10. Scenario types Hub understands

| Profile | Typical trigger | Hub behavior |
|---------|-----------------|--------------|
| `spoke_query` | Your escalation with `query` | Customer facets + strategy + optional `suggestedAgentReply` |
| `ops_anomaly` | Metric breach (`ccaas`, `ticketing`, …) | Minimal CDP facets; NBA-style ops actions; rich dispatch copy |
| `engagement_anomaly` | Web tracking / return visit | May include `bot_popup` to Contact Centre |
| `customer_event` | CDP lifecycle events | Full CDP + commercial strategy agents |

Machine-readable policy for fetch plans and ops playbooks lives under `skills/worktual/fetch_policy.yaml` and `skills/cvm/ops_playbook.yaml`.

---

## 11. When Hub escalates to a human (your ops team)

Hub will **not** auto-close and will surface human ops when:

- Policy blocks high-impact writes (force logout, queue delete, …)
- Customer identity or consent is missing or ambiguous
- Guardrails block automated prose or actions
- No valid `dispatch` items after validation (`validated: false`)
- Target spoke disabled or A2A unreachable
- Promotional contact outside legal contact window
- Evidence too weak for confident automation

In those cases, treat `summary` plus `description` on any `escalate`/`notify` items as the **supervisor briefing**, not as customer chat text.

---

## 12. Best practices for spoke teams

### Do

- Send **specific** `query` text: metric, queue, conversation id, what you already tried
- Include `organizationId`, `cdpId`, `spoke`, `channel`
- Attach structured ids in `recent_event` (conversationId, queueId, alertId, taskId)
- Execute returned `dispatch` items using typed skill contracts
- Surface `suggestedAgentReply` in your agent UI for spoke-query flows
- Log `requestId` / `strategyId` for support correlation

### Don't

- Call Hub for pure reads you can do locally
- Assume Hub will transfer chats between agents
- Hardcode skill ids — refresh Agent Card; Hub resolves against live card
- Send PII you don't need in `query` (use ids; Hub loads CDP)
- Call Hub with `source=hub` (self-calls are skipped)

---

## 13. Failure modes (what you may see)

| Symptom | Likely cause | Spoke action |
|---------|--------------|--------------|
| Empty `dispatch[]` | Validation failed, spoke disabled, consent block | Manual supervisor handling; check `summary` |
| `validated: false` in plan metadata | Catalog/consent/guardrails | Do not auto-execute; escalate internally |
| A2A connection refused / timeout | Hub → spoke URL or auth | Fix connectivity; use Hub receipt as runbook |
| `skipped_missing_skill_arguments` | Dispatch skill args incomplete | Improve payload context or skill contract mapping |
| Stale skill version error | JWT skillVersion mismatch | Refresh Hub/spoke skill catalog version |

---

## 14. Contact Centre — example scenarios

| Situation | Call Hub? | Expected Hub outcome |
|-----------|-----------|----------------------|
| Queue length critical, need staffing plan | Yes (`spoke-query`) | `assign` + `notify` + `open_task` back to CC |
| Abandonment anomaly (Kafka) | Auto (`run-pipeline`) | `escalate` + `notify` + investigate task |
| Agent needs chat transfer to supervisor | **No** | Use CC workforce routing |
| Customer wants refund, identity unclear | Yes | Hub → human; weak dispatch |
| Proactive webchat on pricing page (web anomaly) | Auto | `bot_popup` → `cc.webchat.proactive-engagement.trigger` |
| Force logout agent | Yes (approval) | Hub policy → approve or escalate to human approver |

---

## 15. Support & contracts

- Envelope: `/a2a/contracts/worktual-envelope.v1.json`
- Result: `/a2a/contracts/skill-result.v1.json`
- Per-skill: `/a2a/contracts/skills/{skillId}.v1.json`
- Hub skills: `spoke-query`, `run-pipeline`, `leftover-work`

For integration questions, provide: `requestId`, `organizationId`, `cdpId`, timestamp, and whether the flow was **spoke-query** or **anomaly**.

Related internal docs: `docs/CDP_CVM_HUB_FLOW.md`, `docs/HUB_MAS_ARCHITECTURE.md`.

---

*Worktual Hub — Tier-1 orchestrator. Spokes own execution; Hub owns enterprise strategy and validated dispatch.*
