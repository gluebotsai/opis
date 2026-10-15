# Worktual Ticketing — Database Tables

Catalog of every table in the Worktual ticketing system: purpose and how it is used.

Almost every business table is multi-tenant and scoped by `organisation_id` / `organization_id`.

---

## Core multi-tenant & identity

| Table | Purpose |
|---|---|
| **organisations** / **organizations** | Tenant root. Each company/workspace; almost every other row is scoped by organization id. Holds name, slug, status, and prefs like ticket prefix, portal label, timezone. |
| **users** | Agents/admins/viewers in an org. Auth (`password_hash`), role, status, profile, notification prefs, 2FA flag, locale/timezone. |
| **user_sessions** | Active login sessions (device, browser, OS, IP, last active). Used for “signed-in devices” and revoke. |
| **user_login_events** | Append-only login history for security/account UI. |

---

## Customers & tickets

| Table | Purpose |
|---|---|
| **customers** | End customers who open tickets. Email/phone, status, ticket count; unique per org by email/external id. |
| **tickets** | Main support cases: subject, description, channel, priority, status, assignee, queue, timestamps (`created_at`, `resolved_at`, `due_at`, `first_response_at`), attachments, denormalized customer/assignee names. |
| **ticket_notes** | Conversation thread on a ticket (agent notes / replies). `visibility` distinguishes internal vs public. |
| **ticket_presence** | Who is currently viewing a ticket (heartbeat + TTL) so agents can avoid collisions. |
| **activity_logs** | Lightweight human-readable activity feed (e.g. dashboard “recent activity”). |
| **audit_events** | Append-only compliance trail for ticket create/update/assign/escalate/note/status with JSON `meta`. |

---

## Queues & routing

| Table | Purpose |
|---|---|
| **agent_queues** | Teams/queues that tickets land in (Private/Shared), with open/assigned counts and SLA status. |
| **agent_queue_members** | Many-to-many: which agents belong to which queues. |

---

## SLA policies

| Table | Purpose |
|---|---|
| **sla_policy_defaults** | Global default hours per priority (`resolution_hours`, `first_response_hours`). Source of truth when seeding a new org — not hardcoded in app logic. |
| **sla_policies** | Per-organization SLA windows by priority. Used to compute `tickets.due_at` on create / priority change. |

Default seed (editable in DB):

| Priority | Resolution | First response |
|---|---|---|
| urgent | 4h | 1h |
| high | 8h | 2h |
| medium | 24h | 4h |
| low | 72h | 8h |

Ticket timing columns:

| Column | Meaning |
|---|---|
| `tickets.created_at` | Ticket creation time |
| `tickets.resolved_at` | Ticket solved time (set when status → Resolved; cleared if reopened) |
| `tickets.due_at` | SLA resolution deadline from `sla_policies` |
| `tickets.first_response_at` | First agent response time |

---

## Knowledge, macros & dashboard

| Table | Purpose |
|---|---|
| **kb_articles** | Knowledge-base articles (category, draft/published, views) for agents/customers. |
| **macros** | Saved reply templates (title + body) agents can insert into notes. |
| **dashboard_metrics** | Cached KPI snapshot per org (open, on hold, overdue, due today, unassigned + change labels). |
| **notifications** | In-app alerts to users (assignments, updates, etc.), with read/unread. |

---

## Automation & integrations

| Table | Purpose |
|---|---|
| **automation_rules** | Org if/then rules on `ticket.created` / `ticket.updated` (conditions + actions as JSONB: priority, queue, assign, notify). |
| **org_api_keys** | Integration API keys; only SHA-256 hash stored; prefix for display; revoke + last used. |
| **org_widgets** | Embeddable Help widgets (`public_id`, allowed origins, button label) that create tickets via public intake. |
| **email_message_refs** | Maps inbound email `Message-ID` → ticket so replies thread onto the right case. |
| **outbound_email_log** | Log of emails sent to customers (created / reply / resolved): to, subject, status, errors. |

---

## Skills DB (separate database: `ticketing_skills`)

| Table | Purpose |
|---|---|
| **skill_agents** | Agents known to the skills service (name, email, status) used for skill-based assignment. |
| **agent_skills** | Skills attached to those agents (e.g. Billing, Networking); queried when routing tickets. |

---

## How they fit together

```
organizations
  ├── users ── user_sessions / user_login_events
  ├── customers
  ├── agent_queues ── agent_queue_members ── users
  ├── sla_policies  ← seeded from sla_policy_defaults
  ├── tickets ── ticket_notes / ticket_presence / activity_logs / audit_events
  ├── kb_articles / macros / notifications / dashboard_metrics
  ├── automation_rules / org_api_keys / org_widgets
  └── email_message_refs / outbound_email_log

sla_policy_defaults  →  copied into each org’s sla_policies

(skills DB) skill_agents ── agent_skills   ← used for auto-assignment
```

Every business table is multi-tenant: rows are isolated by organization id.
