# Contact Center modules and access

Who may open each part of the product, and whose rows they may read.
A domain agent is a software agent in the co-worker stack. A human role is a person who signs in. They are not the same list.

Human access is decided in `apps/cc-core/src/services/auth.ts` (`resolveRole`).
The stored role name on `accounts.setup_roles` is folded to one of two product scopes. Admin, administrator, manager, and supervisor all become the admin scope. Every other role name, including agent, becomes the agent scope.

---

## Product modules

Each module is a surface a person or a domain agent can be aimed at. Data still stays inside one `organization_id`.

| Module | What it is for |
|--------|----------------|
| Workspace inbox | Live and closed customer conversations, offers, replies, transfer, and wrap-up |
| Workspace customer | Contact card, previous interactions, orders, tickets, and notes for the open conversation |
| Co-worker | Suggested replies and approved actions beside the conversation |
| Internal chat | Agent-to-agent chat. This is not the customer transcript |
| Contacts | The customer directory and identity |
| Tasks | Callbacks, follow-ups, and other agent tasks |
| Queues and workforce | Teams, business hours, queue setup, and who is staffed on which shift |
| Monitoring | Live waiting, active, missed, callbacks, agent presence, and SLA risk |
| Reports and performance | Period KPIs, charts, and agent scorecards |
| Analytics | Incidents, missed-contact rate, forecasts, and recommendations |
| Channels | Web chat, email, social, and voice configuration |
| Knowledge | Organization documents the bot and co-worker may quote |
| Presence | Ready, not ready, busy, and break for the signed-in person |
| Voice | SIP registration, inbound and outbound calls, consult, and transfer |

---

## Human roles

### Agent scope

The person is a support agent. Reports, inbox queries, and task lists add a filter so `assigned_user_id` or `assigned_agent_id` is that person's own setup user id.
They can open their own conversations, their own presence, their own tasks, and the customer on the conversation they are handling. They cannot open another agent's handled list, another agent's presence history, or an organization-wide report.

They may see a queue roster only as far as the product needs it to transfer or to show the queue on their own conversation.
They may not edit organization channels, business hours, or another person's shift assignment.

### Admin scope

The stored role is admin, administrator, manager, or supervisor. All four names resolve to this same scope.
They can see every agent in the organization, including themselves, and every conversation, task, queue, and report. An admin report does not add the "only my user id" filter.

They can change queue staffing, presence of another agent where the product allows supervisor presence, monitoring for every queue, and Analytics for the whole organization.
They still cannot see another organization's rows. Tenant isolation stays on `organization_id`.

| Stored role name | Product scope | Whose customer and performance rows |
|------------------|---------------|--------------------------------------|
| agent (and any name that is not in the admin list) | agent | Only conversations and tasks assigned to that user |
| admin | admin | Every user in the organization, including that admin's own |
| administrator | admin | Same as admin |
| manager | admin | Same as admin |
| supervisor | admin | Same as admin |

A callback cannot be assigned to an admin-scope user. `assertCallbackAssigneeIsAgent` rejects admin, administrator, manager, and supervisor. The task must sit on an agent-scope user.

---

## Domain agents

The co-worker stack is `contact_center_super`, then one domain, then one executor. The super agent does not answer and does not call business tools. It only picks a domain.
A domain agent also does not answer. It picks one executor from its own handoff list. Only the executor reads or writes data, and only through the tools listed for it.
The super agent's prompt text mentions contacts and navigation under interaction operations. The domain that actually accepts `contact` and `general` is `agent_assist_domain`. `interaction_operations_domain` accepts only `task`.

### `agent_assist_domain`

This domain is for help on the conversation the human already has open.
It may route to `coworker_task_assist`, `inbox`, `contact`, and `general`.

| Executor | Modules it may use | What it must not do |
|----------|--------------------|---------------------|
| `coworker_task_assist` | Workspace conversation, contacts, tasks, navigation, organization knowledge | Send a customer message, or claim an action succeeded without the tool result |
| `inbox` | The open conversation and suggested reply | Change queue staffing or organization reports |
| `contact` | Contact search, identity, create, and update | Conversation volume or channel-mix KPIs |
| `general` | Navigation and organization questions | Specialist writes |

`conversation_assist` is the passive suggested-reply path on the inbox surface. It may read the conversation, organization knowledge, and contact extraction. It must not send the reply.

### `interaction_operations_domain`

This domain is for follow-up work, not for live staffing and not for KPI analysis.
It may route only to the `task` executor.

The task executor may search and update tasks for the organization when the signed-in human is an admin, and only that human's tasks when the signed-in human is an agent.
It does not publish queue members and it does not compute dashboard KPIs.

### `workforce_management_domain`

This domain is for how work is staffed and what is happening live.
It may route to `queue` or `monitoring`.

| Executor | Modules it may use | What it must not do |
|----------|--------------------|---------------------|
| `queue` | Queues, teams, business hours, eligible agents, presence setup | Invent a shift name. A shift must be one that exists on that queue's hours template |
| `monitoring` | Live queues, waiting, missed, callbacks, agent presence, attendance, SLA risk | Rewrite historical report KPIs |

Monitoring reads a snapshot of open work. It is not a license to read another tenant.

### `performance_intelligence_domain`

This domain is for numbers over a period.
It may route only to `analytics`.

The analytics executor may read Reports KPIs, charts, channel mix, SLA, incidents, missed-contact rate, forecasts, and peak hour.
It must not answer contact-directory questions such as how many contacts were created. That belongs to the contact executor.
Analytics recommendations do not by themselves add or remove queue members.

---

## How the two scopes combine

The domain agent does not get a wider view than the human who is signed in.
If an agent-scope human asks the co-worker for "everyone's handle time", the analytics read still has to be limited to that user, the same way `loadAgentAggregate` adds the user filter.
If an admin-scope human asks the same question, the read is the whole organization, including that admin's own conversations.

A customer bot (Lola on web chat, voice, or email) is not one of these domain agents. It talks to the customer. It does not open Monitoring, Reports, or another agent's inbox.
