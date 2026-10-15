# Omnichannel Architecture Contract

This directory is the **source of truth** for omnichannel bot and live-agent behavior across webchat, email, and WhatsApp. Runtime code must conform to these contracts.

## Contents

| Document | Purpose |
|----------|---------|
| [flow-diagrams.md](./flow-diagrams.md) | End-to-end flows per channel and combined omnichannel |
| [erd.md](./erd.md) | Entity-relationship model for setup, runtime, NLP, routing, CDP |
| [lifecycle-contract.md](./lifecycle-contract.md) | Status/lifecycle state machine, policy precedence, escalation rules |
| [acceptance-scenarios.md](./acceptance-scenarios.md) | Scenario matrix mapped to state transitions |

## Owning Services

| Layer | Service | Port | Responsibility |
|-------|---------|------|----------------|
| Webchat adapter | `chat-service` | 3002 | WebSocket widget, session store, NLP client |
| Email adapter | `chat-service` | 3002 | Gmail ingest, email orchestrator, outbox |
| WhatsApp adapter | `social-service` | 3004 | Meta webhook, outbound Meta API |
| Control plane | `cc-core` | 3001 | Conversations, policy, routing, NLP persistence |
| NLP | `nlp` | 8000 | Tenant-scoped bot turns, memory, knowledge |
| Agent UI | `web` | 5173 | Workspace, offers, replies, disposition |

## Policy Precedence (Canonical)

1. **Active runtime DB policy** (`ccass.channel_automation_policies` or channel-specific table while migrating)
2. **Published setup configuration** (`accounts.setup_*_configs`)
3. **DB default** (see lifecycle-contract.md)

An explicit DB disable (`bot_enabled = false`) **always wins** over setup defaults.

## Default Policy Values

| Field | Default |
|-------|---------|
| `bot_enabled` | `true` |
| `live_agent_enabled` | `true` |
| `automation_mode` (email) | `auto_send` |
| `confidence_threshold` | `0.85` |
| `no_agent_behavior` | `queue_and_notify` |

## Canonical Status Progression

```
bot_active → queued → assigned → active → resolved | closed
```

Lifecycle mapping:

```
bot → waiting → offered → connected → ended
```
