# Skill: `telemetry-ground-truth-protocol`

## Overview & Purpose
Defines the authoritative dictionary of CCaaS telemetry properties, distinguishing hard telemetry data from free-text notes and establishing exact field semantics.

---

## The Telemetry Ground-Truth Dictionary

| Property | Node Label | Type | Semantic Role & Ground-Truth Definition |
| :--- | :--- | :--- | :--- |
| **`c.resolution_code`** | `Conversation` | String | Primary resolution state (`'resolved'`, `'unresolved'`, `null`). |
| **`c.disposition_code`**| `Conversation` | String | Explicit operational outcome (`'agent_declined'`, `'browser_disconnected'`, etc.). |
| **`c.end_actor`** | `Conversation` | String | Session terminator (`'agent'`, `'customer'`, `'system'`). Prevents hallucinating who dropped. |
| **`c.end_reason`** | `Conversation` | String | Technical trigger for termination (`'agent_completed'`, `'customer_ended'`, `'idle_timeout'`). |
| **`c.handoff_reason`** | `Conversation` | String | Escalation trigger (`'User requested live agent'`). Note: `'bot_handoff'` is NOT an end_reason! |
| **`c.previous_conversation_id`** | `Conversation` | String/Int | Preceding session ID in a reconnect or transfer continuation chain. |
| **`c.assigned_agent_id`** | `Conversation` | Int | Human staff attribution ID. Identifies agent-specific metric skews. |
| **`c.queue_id`** | `Conversation` | Int | Routing queue attribution ID. Reveals queue-concentrated bottlenecks. |
| **`c.facts`** | `Conversation` | Array | System failure flags (`['live_agent_unavailable', 'no_ready_agents', 'bot_continue']`). |
| **`c.summary`** | `Conversation` | String | Machine-generated system codes (e.g. `reason_code=no_ready_agents`). |
| **`c.queued_at`** | `Conversation` | Timestamp | Timestamp when conversation entered routing queue. |
| **`c.first_response_at`** | `Conversation` | Timestamp | Timestamp of first bot or agent response. |
| **`c.first_agent_response_at`** | `Conversation` | Timestamp | Timestamp of first live human agent response. |
| **`c.custom_sentiment`** | `Conversation` | String | Interaction sentiment score or label. |
| **`s.presence_state`** | `ContactCentreAgent` | String | Agent presence state (`'ready'`, `'not_ready'`, `'offline'`). |
| **`s.reason_code`** | `ContactCentreAgent` | String | Agent unavailable reason code (`'lunch'`, `'break'`, `'not_reached'`). |

---

## Ground-Truth Rules & Hierarchy
1. **Telemetry Over Text**: Hard telemetry properties (`c.end_actor`, `c.end_reason`, `c.facts`) always override free-text agent comments.
2. **Intentionality Enforcement**: If `c.end_actor = 'agent'` and `c.end_reason = 'agent_completed'`, it is strictly an intentional agent termination, never a "network or technical drop".
3. **Escalation Tracking**: Handoffs and escalations must be identified via `c.handoff_reason IS NOT NULL` or `(:Conversation)-[:HAS]->(:MissedContact)`.
