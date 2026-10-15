# Contact Centre — My Understanding

> **Source:** `contact_center_portals_understanding.pdf`  
> **Related:** [AI_CONTACT_CENTER_PLAN.md](./AI_CONTACT_CENTER_PLAN.md) · [DESIGN_GUIDELINES.md](./DESIGN_GUIDELINES.md)

This document captures product understanding for the **Worktual Contact Centre** portals — what they contain, how they behave, and how AI fits in. It is the human-readable companion to the technical build plan.

---

## 1. Design principles

| Principle | Meaning |
|-----------|---------|
| **Conversation-centric** | Not channel-centric; one workspace for all channels |
| **Configuration ownership** | Platform Services owns org/users/teams/hours/KB — not Contact Centre |
| **Operations ownership** | Contact Centre owns conversations, queues, routing, live ops |
| **Embedded AI** | AI inside workflows — never a separate "AI module" in navigation |
| **Omnichannel by design** | Voice, Chat, Email, WhatsApp, SMS, Social, future channels in one workspace |
| **Hybrid roles** | Admins can act as support agents when needed |
| **Scalable navigation** | Simple nav that scales for enterprise |

---

## 2. Support Admin Portal

Administrators manage operations, workforce, and monitoring. They can also work customer conversations via **My Workspace**.

### 2.1 Navigation structure

```text
Support Admin Portal
├── Dashboard
│   ├── KPIs
│   └── Insights
├── Workforce Management
│   ├── Agents
│   ├── Queues
│   ├── Skills
│   ├── Presence
│   └── Shift Assignment
├── My Workspace                    # same as Agent Workspace
│   ├── My Queue
│   ├── Assigned
│   ├── Waiting
│   ├── In Progress
│   ├── Callbacks
│   └── Closed
├── Live Monitoring
│   ├── Queue Monitoring
│   ├── Agent Monitoring
│   ├── Active Conversations
│   └── SLA Monitoring
└── Reports & Analytics
    ├── Saved Reports
    ├── Generate Report
    ├── Scheduled Reports
    └── Exports
```

### 2.2 Module overview

#### Dashboard

Real-time operational overview of the contact centre.

**Includes:**

- Queue KPIs
- Active conversations
- Agent availability
- SLA status
- Operational insights
- AI operational insights

#### Workforce Management

Manages operational resources.

**Includes:**

- Agents
- Queues
- Skills
- Presence status
- Shift assignment

**Future enhancements:**

- Capacity planning
- Workforce forecasting
- Queue balancing

#### My Workspace

Admin workspace — **identical to the Agent Workspace**. Admins can participate in customer conversations like agents when needed.

**Conversation views:**

- My Queue
- Assigned
- Waiting
- In Progress
- Callbacks
- Closed

**Channels:** Voice, Chat, Email, WhatsApp, SMS, Social Media, future channels.

#### Live Monitoring

Real-time operational oversight.

**Includes:**

- Queue monitoring
- Agent monitoring
- Active conversations
- SLA monitoring

**Future enhancements:**

- Silent monitoring
- Whisper coaching
- Barge-in

#### Reports & Analytics

Historical operational reporting.

**Includes:**

- Saved reports
- Generate report
- Scheduled reports
- Exports

**Report categories:**

- Queue performance
- Agent performance
- SLA
- Channel analytics
- Productivity
- CSAT

**Future:** Queue heatmaps.

---

## 3. Support Agent Portal

Agents handle customer conversations and personal work.

### 3.1 Navigation structure

```text
Support Agent Portal
├── Agent Workspace
│   ├── My Queue
│   ├── Assigned
│   ├── Waiting
│   ├── In Progress
│   ├── Callbacks
│   └── Closed
├── My Tasks
│   ├── Follow-ups
│   ├── Pending Actions
│   ├── Escalations
│   ├── Scheduled Callbacks
│   └── Completed
└── My Performance
    ├── Today's KPIs
    ├── Productivity
    ├── SLA
    ├── CSAT
    └── Interaction Summary
```

### 3.2 Module overview

#### Agent Workspace

Primary omnichannel workspace for managing customer conversations. **Conversation-centric, not channel-centric.**

**Conversation views:** My Queue, Assigned, Waiting, In Progress, Callbacks, Closed.

**Channels:** Voice, Chat, Email, WhatsApp, SMS, Social Media, future channels.

#### Conversation workspace layout

Every conversation opens in a **unified three-panel workspace**:

```text
┌──────────────────┬────────────────────────────┬──────────────────┐
│ Conversation     │ Conversation Window        │ Customer 360     │
│ List             │ (messages, reply, AI       │ Panel            │
│ (filters/views)  │  assists inline)           │                  │
└──────────────────┴────────────────────────────┴──────────────────┘
```

#### Customer 360

Right-side panel — **not a separate navigation menu**.

**Includes:**

- Customer profile
- Timeline
- Internal notes
- Attachments
- Previous conversations
- CRM information
- Tickets
- Campaign history

> **Note:** Internal notes are part of the conversation workspace, not a separate nav item.

#### My Tasks

Personal work queue generated from customer interactions.

**Includes:**

- Follow-ups
- Pending actions
- Escalations
- Scheduled callbacks
- Completed tasks

Many tasks can be **automatically created by AI**.

#### My Performance

Personal operational dashboard.

**Includes:**

- Today's KPIs
- Productivity
- SLA compliance
- CSAT
- Interaction summary

**Future additions:**

- Quality score
- Coaching
- AI feedback
- Performance trends

---

## 4. AI integration

**AI is embedded throughout the Contact Centre.** Users should never navigate to an "AI Module" — AI works silently inside existing workflows.

| Capability | Where it appears |
|------------|------------------|
| Conversation summary | Conversation window |
| Suggested replies | Reply composer |
| Intent detection | Routing, classification |
| Sentiment analysis | Conversation header / monitoring |
| Language translation | Message thread |
| Auto classification & tagging | Ingest + workspace |
| Smart routing | Queue assignment |
| Knowledge suggestions | Agent assist panel |
| Next best action | Agent assist panel |
| Auto wrap-up | Post-conversation flow |
| Conversation priority | Queue + list sorting |

---

## 5. User experience guidelines

### 5.1 AI-first interaction model

**Hybrid interaction model:**

- **AI Workspace** is the primary way users interact with the platform
- **Traditional UI** remains available whenever required
- Users can switch between AI and traditional UI at any time

### 5.2 Interaction modes

#### AI Workspace (primary)

Users perform business operations through natural language or voice.

**Examples:**

- Create a queue
- Assign an agent
- Transfer a conversation
- Generate a report
- Schedule a callback

AI understands intent → validates permissions → executes platform APIs → confirms result.

#### Traditional UI (secondary)

Forms, tables, dashboards, and wizards for:

- Precise configuration
- Bulk operations
- Complex data entry
- Compliance and auditing
- User preference

### 5.3 UI responsibility

| Component | Responsibility |
|-----------|----------------|
| **AI Workspace** | Conversational interface for executing business operations using natural language |
| **Forms & Wizards** | Structured configuration and detailed data entry |
| **Tables & Lists** | Browse, search, filter, and bulk operations |
| **Dashboards** | Visualize operational KPIs, trends, and insights |
| **Workspace** | Handle customer conversations and operational tasks |
| **Microservices** | Execute business logic through secure APIs |

### 5.4 Implementation flow

```text
User
 ├── AI Workspace (Chat / Voice)
 └── Traditional UI (Forms / Tables / Dashboards)
        ↓
   Platform APIs
        ↓
 Enterprise Microservices
```

**Design principle:** Every business capability should be accessible through AI. Traditional forms and screens remain available as a complementary interface, ensuring flexibility, precision, and enterprise usability.

---

## 6. Configuration vs operations (platform boundary)

| Owned by Platform Services | Owned by Contact Centre |
|----------------------------|-------------------------|
| Organization, branches | Conversations & messages |
| Users, teams, roles | Queues, routing rules, skills |
| Business hours | Agent presence & assignment |
| Entitlements, channel config | SLA policies & monitoring |
| Knowledge base (platform) | Live ops, tasks, audit log |

Contact Centre **reads** platform configuration via `platform-service` — it does not own or duplicate platform master data.

---

## 7. Build phasing (from product understanding)

| Phase | Portals / modules |
|-------|-------------------|
| **Phase 1 — Admin** | Dashboard, Workforce Management, My Workspace (basic), Live Monitoring |
| **Phase 2 — Agent** | Agent Workspace (full), My Tasks, embedded AI in workspace |
| **Phase 3 — Analytics** | Reports & Analytics, My Performance |

Channel services (voice, chat, email, social) and NLP integrate progressively — see [AI_CONTACT_CENTER_PLAN.md](./AI_CONTACT_CENTER_PLAN.md) for technical phasing.

---

## 8. Key takeaways for builders

1. **One conversation workspace** — same layout for admin My Workspace and agent portal
2. **Channel is metadata** — do not build separate apps per channel
3. **Customer 360 is a panel**, not a top-level nav item
4. **AI is inline** — summaries, suggestions, routing intelligence inside the conversation flow
5. **Hybrid UX** — ship traditional UI first (tables/forms); AI Workspace layers on top via APIs
6. **Admin dual-role** — admins need the full agent workspace, not a read-only monitor-only view
