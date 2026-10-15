# Webchat & Live Agent — Service Flow

End-to-end flows showing **which service talks to which**, **over what protocol**, and **which database tables** are read or written at each step.

**Services:**

| Service | Port | Role |
|---------|------|------|
| **Webchat widget** | — | Customer browser; WebSocket client |
| **chat-service** | 3002 | WebSocket gateway; orchestrates bot + persistence |
| **cc-core** | 3000 | System of record; routing, presence, APIs, Socket.IO |
| **nlp** | 8000 | Customer webchat bot (`/api/v1/webchat/turn`) + shared Copilot (`/api/v1/copilot`) |
| **web** | 5173 | Agent workspace UI |

**Databases:**

| Schema | Owner | Contents |
|--------|-------|----------|
| `accounts` | Platform | Tenant + webchat configuration |
| `ccass` | cc-core | Conversations, NLP turns, routing, Copilot runtime |
| `cdp` | cc-core (projection) | Customer interaction summaries only |

---

## 1. System context (block diagram)

```mermaid
flowchart TB
  subgraph Customer["Customer browser"]
    WIDGET[Webchat Widget]
  end

  subgraph Apps["Application services"]
    CHAT[chat-service<br/>:3002]
    CORE[cc-core<br/>:3000]
    NLP[nlp<br/>:8000]
    WEB[web Agent Workspace<br/>:5173]
  end

  subgraph Data["PostgreSQL"]
  ACC[(accounts)]
  CCASS[(ccass)]
  CDP[(cdp)]
  end

  subgraph Cache["Redis"]
  REDIS[(presence cache)]
  end

  WIDGET <-->|WebSocket<br/>/ws/webchat| CHAT
  CHAT -->|HTTP internal<br/>/internal/v1/*| CORE
  CHAT -->|HTTP<br/>/api/v1/webchat/turn| NLP
  WEB -->|HTTP JWT<br/>/api/v1/workspace/*| CORE
  WEB -->|HTTP SSE<br/>/api/v1/copilot/stream| NLP
  NLP -->|HTTP tools<br/>/api/v1/*| CORE
  WEB <-->|Socket.IO<br/>/socket.io| CORE

  CORE --> ACC
  CORE --> CCASS
  CORE --> CDP
  CORE <-->|read/write presence| REDIS
  NLP -.read-only later.-> CCASS
```

---

## 2. Communication matrix

| From | To | Protocol | Auth | Purpose |
|------|----|----------|------|---------|
| Widget | chat-service | **WebSocket** | `webchatId` + `visitorId` | `session.start`, `message` frames |
| chat-service | cc-core | **HTTP** | `x-internal-service-key` + `x-tenant-id` | Persist conversation, messages, handoff, NLP turns |
| chat-service | nlp | **HTTP** | `x-tenant-id` | Customer bot turn (stateless compute) |
| nlp | cc-core | **HTTP** | JWT / service key | Tool calls & read context (Copilot; webchat bot via chat-service today) |
| web | cc-core | **HTTP** | JWT Bearer | Inbox, replies, presence |
| web | cc-core | **Socket.IO** | JWT / dev auth | Realtime inbox updates |
| web | nlp | **SSE** | JWT Bearer | Copilot assist (not customer-facing) |
| cc-core | PostgreSQL | **SQL** | RLS `app.organization_id` | All writes to `ccass`; projection to `cdp` |
| cc-core | Redis | **Redis protocol** | `REDIS_URL` | Agent presence cache (write-through) |

---

## 3. Session start flow

Customer opens webchat and sends `session.start`.

```mermaid
sequenceDiagram
  autonumber
  participant W as Webchat Widget
  participant C as chat-service
  participant A as accounts API
  participant R as cc-core
  participant DB as PostgreSQL

  W->>C: WS session.start { webchatId, visitorId, pageUrl }
  C->>A: GET public webchat config (optional)
  C->>R: GET /internal/v1/webchat/:webchatId/context
  R->>DB: READ accounts.setup_webchat_configs<br/>JOIN organizations, ccass.queues
  R-->>C: { organizationId, greeting, routingQueueId, nlpEnabled }

  C->>R: POST /internal/v1/conversations
  R->>DB: INSERT ccass.conversations
  R->>DB: INSERT ccass.webchat_sessions
  R->>DB: INSERT ccass.conversation_participants
  R->>DB: INSERT ccass.nlp_conversations (if nlp_enabled)
  R->>DB: UPSERT cdp.interactions + INSERT cdp.interaction_events
  R-->>C: { conversationId }

  C->>R: POST /internal/v1/conversations/:id/messages (bot greeting)
  R->>DB: INSERT ccass.conversation_messages
  R-->>C: { message }

  C-->>W: WS session.ready + WS message (greeting)
```

### Tables touched — session start

| Step | Service | Tables | Operation |
|------|---------|--------|-----------|
| Resolve tenant | cc-core | `accounts.setup_webchat_configs`, `accounts.organizations`, `ccass.queues` | SELECT |
| Create conversation | cc-core | `ccass.conversations` | INSERT |
| Bind session | cc-core | `ccass.webchat_sessions` | INSERT |
| Start NLP runtime | cc-core | `ccass.nlp_conversations` | INSERT |
| Project to CDP | cc-core | `cdp.interactions`, `cdp.interaction_events` | UPSERT + INSERT |
| Greeting | cc-core | `ccass.conversation_messages` | INSERT |

---

## 4. Customer message + NLP bot turn

Customer sends a message while conversation is `bot_active`.

```mermaid
sequenceDiagram
  autonumber
  participant W as Webchat Widget
  participant C as chat-service
  participant N as nlp
  participant R as cc-core
  participant DB as PostgreSQL

  W->>C: WS message { text }
  C->>R: POST /internal/v1/conversations/:id/messages
  Note over C,R: sender_type = customer
  R->>DB: INSERT ccass.conversation_messages
  R->>DB: UPDATE cdp.interactions.last_activity_at
  R-->>C: { customerMessageId }

  C->>N: POST /api/v1/webchat/turn
  Note over N: Stateless bot compute<br/>(no DB write in nlp)
  N-->>C: { reply, confidence, intent, handoff_recommended }

  C->>R: POST /internal/v1/conversations/:id/messages
  Note over C,R: sender_type = bot
  R->>DB: INSERT ccass.conversation_messages

  C->>R: POST /internal/v1/conversations/:id/nlp-turns
  R->>DB: INSERT ccass.nlp_turns
  R->>DB: UPDATE ccass.nlp_conversations.updated_at
  R-->>C: { turn }

  C-->>W: WS message { from: bot, text }
```

### Tables touched — bot turn

| Step | Service | Tables | Operation |
|------|---------|--------|-----------|
| Customer message | cc-core | `ccass.conversation_messages` | INSERT |
| Activity projection | cc-core | `cdp.interactions`, `cdp.interaction_events` | UPDATE / INSERT |
| Bot reply | cc-core | `ccass.conversation_messages` | INSERT |
| NLP audit trail | cc-core | `ccass.nlp_turns` | INSERT |
| NLP session | cc-core | `ccass.nlp_conversations` | UPDATE |

**Important:** NLP bot logic runs in the **`nlp` service**, but **all conversation/NLP persistence is in `ccass`** via **cc-core**. The `nlp` service does not write to the database for webchat turns.

---

## 5. Handoff to live agent

Triggered by explicit human request, low confidence, or business rules. Bot stops; routing begins.

```mermaid
sequenceDiagram
  autonumber
  participant W as Webchat Widget
  participant C as chat-service
  participant R as cc-core
  participant DB as PostgreSQL
  participant RD as Redis
  participant SIO as Socket.IO
  participant WEB as Agent Workspace

  C->>R: POST /internal/v1/conversations/:id/handoff
  R->>DB: UPDATE ccass.conversations<br/>status=queued, bot_active=false
  R->>DB: UPDATE ccass.nlp_conversations<br/>status=ended, end_reason
  R->>DB: INSERT ccass.routing_attempts

  R->>DB: SELECT ccass.queue_members, agent_capacity
  R->>RD: SMEMBERS cc:presence:ready:{orgId}
  R->>DB: SELECT/UPDATE ccass.routing_cursors (FOR UPDATE)
  R->>DB: INSERT ccass.conversation_assignments
  R->>DB: UPDATE ccass.conversations assigned_agent_id
  R->>DB: UPDATE cdp.interactions (assigned)

  R->>SIO: emit conversation.offer
  SIO-->>WEB: conversation.offer event
  WEB->>R: POST accept
  R->>DB: assignment accepted; capacity +1; presence busy

  R->>DB: INSERT system handoff message
  R->>C: POST /internal/v1/webchat/deliver
  C->>R: POST nlp-turns (final bot turn record)
  C-->>W: WS system message (please hold)
```

### Handoff decision block

```mermaid
flowchart TD
  A[Customer message] --> B{NLP handoff_recommended<br/>OR confidence < threshold?}
  B -->|No| C[Persist bot reply<br/>ccass.conversation_messages<br/>ccass.nlp_turns]
  B -->|Yes| D[POST handoff to cc-core]
  D --> E[bot_active = false<br/>nlp_conversations ended]
  E --> F{Ready agent in Redis<br/>+ chat capacity?}
  F -->|Yes| G[Round-robin assign<br/>ccass.conversation_assignments]
  F -->|No| H[Stay queued<br/>ccass.conversations.status = queued]
  G --> I[Socket.IO offer → agent inbox]
  I --> K{Accepted before timeout?}
  K -->|Yes| L[Capacity reserved<br/>presence busy]
  K -->|No| M[Expire and offer next agent]
  H --> J[Wait for agent ready event]
```

### Tables touched — handoff

| Step | Tables | Operation |
|------|--------|-----------|
| Stop bot | `ccass.conversations`, `ccass.nlp_conversations` | UPDATE |
| Route | `ccass.routing_attempts`, `ccass.routing_cursors`, `ccass.queue_members`, `ccass.agent_presence`, `ccass.agent_capacity` | SELECT / INSERT / UPDATE |
| Assign | `ccass.conversation_assignments`, `ccass.conversations` | INSERT / UPDATE |
| Notify agent | — | Socket.IO event (no DB) |
| CDP | `cdp.interactions`, `cdp.interaction_events` | UPDATE / INSERT |

---

## 6. Agent reply flow

After handoff, only the **live agent** replies to the customer. **Copilot** may assist the agent internally (separate path).

```mermaid
sequenceDiagram
  autonumber
  participant WEB as Agent Workspace
  participant R as cc-core
  participant DB as PostgreSQL
  participant SIO as Socket.IO
  participant C as chat-service
  participant W as Webchat Widget

  WEB->>R: POST /api/v1/workspace/conversations/:id/messages
  Note over WEB,R: JWT auth, sender_type = agent
  R->>DB: INSERT ccass.conversation_messages
  R->>DB: UPDATE ccass.conversations → active
  R->>DB: UPDATE cdp.interactions
  R->>SIO: emit message.created
  R->>DB: INSERT message_delivery_attempts
  R->>C: POST /internal/v1/webchat/deliver
  C-->>W: WS message { from: agent }
  C-->>R: delivered / failed
  R->>DB: UPDATE delivery_state
  R-->>WEB: { message with deliveryState }
```

### Copilot assist (parallel, internal only)

```mermaid
sequenceDiagram
  participant WEB as Agent Workspace
  participant N as nlp Copilot
  participant R as cc-core

  WEB->>N: SSE POST /api/v1/copilot/stream
  Note over WEB,N: surface=inbox, conversationId
  N->>R: HTTP tool calls (read queues, context)
  N-->>WEB: SSE suggested reply
  WEB->>R: Persist ccass.copilot_turns
  WEB->>R: POST workspace message with copilotTurnId
  R->>R: Link sent_message_id to copilot_turn
```

Copilot never sends directly to the customer. Agent explicitly sends via workspace API.

---

## 7. Agent presence flow

Presence uses a **write-through Redis cache** backed by `ccass.agent_presence`. See [PRESENCE_REDIS_CACHE.md](./PRESENCE_REDIS_CACHE.md) for key layout and configuration.

```mermaid
sequenceDiagram
  autonumber
  participant WEB as Agent Workspace
  participant R as cc-core
  participant PG as PostgreSQL
  participant RD as Redis
  participant SIO as Socket.IO

  WEB->>R: PATCH /api/v1/workspace/presence { state: ready }
  R->>PG: UPSERT ccass.agent_presence
  R->>PG: INSERT ccass.agent_presence_history
  R->>RD: SET cc:presence:agent:{org}:{agentId}
  R->>RD: SADD cc:presence:ready:{orgId}
  R->>RD: SET cc:presence:lease:{org}:{agentId} EX 90
  R->>SIO: emit presence.updated
  R-->>WEB: { presence }

  loop Every 60s
    WEB->>R: POST /api/v1/workspace/presence/heartbeat
    R->>PG: UPDATE heartbeat_at, lease_expires_at
    R->>RD: refresh lease TTL + JSON heartbeat
  end

  Note over R,RD: Routing reads cc:presence:ready:{orgId}<br/>before round-robin assignment
```

Presence states: `offline`, `ready`, `not_ready`, `away`, `busy`, `after_contact_work`.

Only `ready` agents with a valid lease and remaining `agent_capacity` are eligible for webchat routing.

---

## 8. Data ownership map

Which service may write which schema:

```mermaid
flowchart LR
  subgraph Writers
    CORE[cc-core]
    NLP[nlp]
    CHAT[chat-service]
  end

  subgraph ReadOnly
    NLP_R[nlp read-only role<br/>future]
  end

  ACC[(accounts)]
  CCASS[(ccass)]
  CDP[(cdp)]

  CORE -->|read config| ACC
  CORE -->|read/write| CCASS
  CORE -->|project write| CDP
  CHAT -->|via cc-core APIs only| CCASS
  NLP -->|tool_call mutations| CORE
  NLP_R -.SELECT only.-> CCASS
  NLP_R -.SELECT only.-> CDP
```

| Data | Canonical store | Written by | Read by |
|------|-----------------|------------|---------|
| Webchat config | `accounts` | Admin/setup APIs | cc-core (context resolver) |
| Conversation transcript | `ccass.conversation_messages` | cc-core | cc-core, web workspace |
| NLP bot turns | `ccass.nlp_turns` | cc-core (via chat-service) | cc-core, analytics |
| NLP bot session | `ccass.nlp_conversations` | cc-core | cc-core |
| Routing state | `ccass.routing_*`, `agent_presence` + **Redis presence cache** | cc-core | cc-core |
| Copilot memory | `ccass.copilot_*` | cc-core / nlp via tools | nlp Copilot |
| Customer interaction | `cdp.interactions` | cc-core projection | CDP APIs, CRM views |

---

## 9. Internal API reference (chat-service → cc-core)

| Method | Path | ccass tables |
|--------|------|--------------|
| GET | `/internal/v1/webchat/:webchatId/context` | READ `accounts.*`, `ccass.queues` |
| POST | `/internal/v1/conversations` | INSERT `conversations`, `webchat_sessions`, `nlp_conversations` |
| GET | `/internal/v1/conversations/:id` | READ `conversations`, `conversation_messages` |
| POST | `/internal/v1/conversations/:id/messages` | INSERT `conversation_messages` |
| POST | `/internal/v1/conversations/:id/nlp-turns` | INSERT `nlp_turns` |
| POST | `/internal/v1/conversations/:id/handoff` | UPDATE `conversations`, `nlp_conversations`, routing tables |

All paths also trigger **`cdp.interactions`** projection where applicable.

---

## 10. Socket.IO events (cc-core → web)

| Event | Room | Payload | When |
|-------|------|---------|------|
| `conversation.created` | `org:{tenantId}` | `{ conversation }` | New webchat conversation |
| `conversation.assigned` | `agent:{tenantId}:{userId}` | `{ conversation }` | Routed to agent |
| `message.created` | `conversation:{tenantId}:{id}` | `{ conversationId, message }` | New message |
| `presence.updated` | `org:{tenantId}` | `{ presence }` | Agent presence change |

Client joins rooms via `conversation.join` after selecting a conversation.

---

## 11. Lifecycle state machine

```mermaid
stateDiagram-v2
  [*] --> bot_active: session.start
  bot_active --> queued: handoff initiated
  queued --> assigned: agent routed
  assigned --> active: agent first reply
  active --> resolved: agent resolves
  resolved --> closed: wrap-up complete
  queued --> queued: no eligible agent

  note right of bot_active
    NLP writes ccass.nlp_turns
    Bot replies via chat-service
  end note

  note right of queued
  nlp_conversations ended
  bot_active = false
  end note

  note right of active
    Only agent + Copilot assist
    No customer bot replies
  end note
```

---

## Related docs

- [WEBCHAT_SCHEMA_ERD.md](./WEBCHAT_SCHEMA_ERD.md) — entity-relationship diagrams
- [WEBCHAT_LIVE_AGENT_PLAN.md](./WEBCHAT_LIVE_AGENT_PLAN.md) — implementation plan
- [COPILOT_BACKEND_SSE.md](./COPILOT_BACKEND_SSE.md) — shared Copilot architecture
