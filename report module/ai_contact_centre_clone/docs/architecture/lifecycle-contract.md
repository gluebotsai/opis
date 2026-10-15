# Lifecycle and Policy Contract

## Conversation Status

| Status | `lifecycle_state` | `bot_active` | `nlp_enabled` | Description |
|--------|-------------------|--------------|---------------|-------------|
| `bot_active` | `bot` | `true` | `true` | Bot handling customer messages |
| `queued` | `waiting` | `false` | `false` | Awaiting agent assignment |
| `assigned` | `offered` | `false` | `false` | Offer sent to agent |
| `active` | `connected` | `false` | `false` | Agent owns conversation |
| `resolved` | `ended` | `false` | `false` | Conversation ended with disposition |
| `closed` | `ended` | `false` | `false` | Terminal state |

## Legal Transitions

| Event | From | To | Side Effects |
|-------|------|-----|--------------|
| `start_bot` | (new) | `bot_active` | Create conversation, NLP session, optional greeting |
| `escalate` | `bot_active` | `queued` | End NLP session, reserve queue, route |
| `offer` | `queued` | `assigned` | Reserve capacity, emit workspace offer |
| `accept` | `assigned` | `active` | Confirm capacity, cancel offer timer |
| `reject` | `assigned` | `queued` | Release capacity, re-route |
| `offer_timeout` | `assigned` | `queued` | Release capacity, re-route |
| `transfer` | `active` | `assigned` or `queued` | Release old agent, route to new queue |
| `resolve` | `active` | `resolved` | Release capacity, CDP projection |
| `close` | `bot_active`, `queued`, `active` | `closed` | Release capacity, notify customer |
| `policy_reconcile` | `queued` (no agent) | `bot_active` | When policy changes to bot enabled |
| `reopen` | `resolved`, `closed` | `bot_active` or `queued` | Customer follow-up on closed thread |

Illegal transitions must be rejected with a typed error; idempotent re-application of the same transition is allowed.

## Policy Precedence

```
1. ccass.channel_automation_policies (status = 'active')
2. Channel-specific runtime policy (email_mailbox_policies, whatsapp_channel_policies)
3. Published setup config (setup_webchat_configs, setup_email_configs, setup_social_configs)
4. DB defaults
```

## Default Policy

```json
{
  "botEnabled": true,
  "liveAgentEnabled": true,
  "automationMode": "auto_send",
  "confidenceThreshold": 0.85,
  "noAgentBehavior": "queue_and_notify",
  "inactivityCloseSeconds": 86400
}
```

Email-specific: `automationMode = auto_send` means bot replies are sent without agent review when grounding passes.

## Escalation Triggers

Escalation from bot to live agent occurs when **any** of:

1. **Explicit human request** — customer asks for agent/human (rule-based, before LLM)
2. **Policy threshold failure** — NLP confidence below `confidence_threshold`
3. **Grounding/guard failure** — reply not grounded in knowledge (email enforced; all channels target parity)
4. **Provider failure** — LLM timeout, malformed output, or auth error
5. **Unsupported content** — attachment/media type bot cannot handle
6. **Bot timeout** — inactivity exceeds `inactivity_close_seconds` (sweeper)
7. **Intent exhaustion** — clarification limit reached for missing entities
8. **Policy disable** — `bot_enabled = false` at conversation start or reconciliation

## No-Agent Behavior

When `live_agent_enabled = true` but no agent is available:

| `no_agent_behavior` | Behavior |
|---------------------|----------|
| `queue_and_notify` | Remain queued; send approved waiting message |
| `bot_continue` | Return to bot if policy allows |
| `close_with_message` | Close with approved service message |

## Policy Change Reconciliation

When an admin disables bot on an open `bot_active` conversation:
- Transition to `queued` and route if `live_agent_enabled`

When an admin enables bot on a `queued` conversation with no assigned agent:
- Transition to `bot_active`, enable NLP, clear `queued_at`

Contradictory flags (`bot_active=true` + `status=queued`) are invalid and must be corrected by reconciliation.
