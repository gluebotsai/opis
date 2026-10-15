# Contact Center Agent Capabilities Enhancement

## Purpose

This document defines the capabilities required to complete the Contact Center
agent pool before adding the CCaaS super agent and connecting it to the Hub
through A2A.

The comparison is based on capabilities already available in the Agent and
Admin portal UI. It is intended to be a discussion and implementation backlog,
not a final product specification.

## Scope

Included:

- Contact Center co-worker specialists
- Customer-facing support bot
- Existing UI operations that should become agent capabilities
- Missing read, draft, mutation, confirmation, and authorization behavior
- Proposed implementation priorities

Deferred:

- Hub implementation
- Web tracking
- A2A transport and Agent Card
- CRM, Ticketing, and Campaign spoke capabilities
- CCaaS super-agent implementation

## Status legend

- **Available** — agent and tool capability exist
- **Partial** — only part of the UI workflow is available to the agent
- **Missing** — UI or backend capability exists but is not exposed to the agent
- **Proposed** — new specialist or capability boundary is recommended
- **Decision required** — product or security decision is needed before implementation
- **Phase 1 complete** — core UI parity achieved; only listed follow-up items remain

---

## 1. Current agent pool

### Existing co-worker specialists

| Agent | Current responsibility | Current surfaces | Enhancement status |
| --- | --- | --- | --- |
| `general` | Navigation, organization questions, requests outside specialist domains | General, dashboard, other | In progress |
| `contact` | Contact search, identity, creation, and updates | Contact list and detail | **Phase 1 complete** |
| `inbox` | Conversation context, summaries, reply suggestions, contact enrichment | Agent/admin workspace | In progress |
| `task` | Task search, detail, updates, and opening linked workspace | Task list and detail | **Phase 1 complete** |
| `queue` | Queue setup, workforce eligibility, and presence | Queue and workforce pages | In progress |
| `analytics` | Performance metrics, reports, plots, and read-only analytics | Performance, reports, dashboard | In progress |
| `support_bot` | Customer-facing assistance across supported channels | Webchat, WhatsApp, social, email | In progress |
| `proactive` | Missed-contact callback planning | Background/internal only | In progress |

### Proposed additions

| Agent | Reason |
| --- | --- |
| `monitoring` | Live Monitoring is a major supervisor domain with no dedicated agent capability |
| `workforce` | Skills, shifts, presence, capacity, and attendance are broader than queue configuration |
| `internal_chat` | Optional specialist for thread summaries, search, and reply assistance |

The CCaaS super agent should be added only after the specialist capabilities
and their permission boundaries are complete.

---

## 2. Shared capability requirements

Every specialist should follow the same capability contract.

### Required metadata

- Capability name and version
- Owning specialist
- Supported UI surfaces
- Allowed roles
- Required organization context
- Read-only or mutation classification
- Confirmation policy
- Input and output schema
- Idempotency behavior
- Audit fields
- Timeout and retry behavior

### Operation classes

1. **Read**
   - May run immediately when the role is authorized.
   - Must remain organization-scoped.

2. **Draft**
   - Agent prepares and previews a change.
   - No backend mutation occurs.

3. **Confirmed mutation**
   - User must explicitly approve the prepared change.
   - Appropriate for contact, queue, assignment, and task changes.

4. **Privileged mutation**
   - Requires supervisor/admin authorization and explicit confirmation.
   - Appropriate for takeover, force close, force logout, destructive deletion,
     and bulk operations.

### Shared response expectations

Agent tools should return structured results in addition to conversational text:

```json
{
  "status": "completed",
  "capability": "conversation.transfer",
  "organizationId": "1003",
  "resourceId": "conversation-id",
  "requiresConfirmation": false,
  "result": {}
}
```

Shared error categories should include:

- `validation_error`
- `not_found`
- `permission_denied`
- `confirmation_required`
- `conflict`
- `temporarily_unavailable`
- `dependency_failure`

---

## 3. General agent

### Available

- Answer organization-level questions
- Retrieve organization knowledge
- Navigate to known application pages
- Route requests to contact, inbox, task, queue, or analytics specialists

### Enhancements

- Add routing targets for monitoring and workforce
- Make navigation role-aware so admin and agent users land on the correct route
- Return a clear unsupported-capability response instead of guessing
- Preserve user intent and relevant entity IDs during specialist handoff
- Distinguish customer-support requests from staff co-worker requests

### Decision required

- Should `general` remain a fallback/router only, or also answer cross-domain
  operational questions?

Recommendation: keep it lightweight. Multi-domain workflows should eventually
belong to the CCaaS super agent.

---

## 4. Contact agent

**Status: Phase 1 complete** — core Contacts page parity is sufficient for current
spoke work. One follow-up item (interaction history) is recommended before A2A;
remaining gaps are deferred.

### Phase 1 complete (available today)

- List/search contacts
- Get contact details
- Stage a contact draft
- Create a contact after confirmation
- Update a contact after confirmation
- Mark a contact inactive through update (acceptable substitute for delete)
- Enrich a contact during a conversation
- Resolve contact identity

### Prompt stabilization completed

- Uses the latest staged draft as cumulative workflow state
- Re-passes all collected values and skipped fields on every gathering turn
- Extracts multiple supported details when supplied in one user response
- Never re-asks fields that are already collected or skipped
- Immediately advances after an answer or skip
- Supports skipping all remaining optional fields
- Copies the primary phone when the user confirms WhatsApp uses the same number
- Keeps update flows focused on requested changes instead of replaying creation
- Uses valid `stage_contact_draft` arguments and never sends an unsupported
  `fields` object

### UI capabilities

- Search and filter contacts
- View contact details
- Create contacts
- Edit contacts
- Delete contacts
- View interaction history
- View contact context from conversations

### Phase 1 follow-up (recommended soon)

| Capability | Status | Recommended behavior |
| --- | --- | --- |
| Interaction history | Missing | Read contact interactions with channel, date, direction, and related conversation |

### Deferred (not blocking other agents)

| Capability | Status | Recommended behavior |
| --- | --- | --- |
| Omni-channel summary | Partial | Return bounded customer summary and recent interactions |
| Delete contact | Missing | Prefer deactivate; hard delete only under explicit admin policy |
| Duplicate detection | Missing | Show candidate duplicates and confidence before any merge |
| Merge contacts | Missing | Privileged confirmed mutation with source/target preview |
| Anonymous-to-known linking | Partial | Preview identity evidence and preserve conversation continuity |
| Communication preferences | Missing | Read and update preferred channel (may be covered via `update_contact`) |
| Consent/suppression | Missing | Read before outreach and require confirmation for changes |
| Deep-link to interaction | Missing | Return a route to the relevant conversation or contact event |

### Permission expectations

- Agent: read, create, update, enrich
- Supervisor: agent permissions plus identity-link review
- Admin: merge, deactivate, policy-approved deletion

### Acceptance examples

- “Show the last five interactions for this customer.”
- “Update the customer’s preferred channel to WhatsApp.”
- “Are these two contacts duplicates?”
- “Link this anonymous webchat visitor after showing the identity evidence.”

---

## 5. Inbox / conversation agent

### UI capabilities

- View inbox and conversation context
- Send customer messages
- Accept or reject conversation offers
- Transfer conversations
- Add dispositions
- Resolve or end conversations
- Add personal and common notes
- Change agent presence
- Request live-agent handoff
- View contact context and sentiment

### Available agent capabilities

- Get bounded conversation context
- Summarize a conversation
- Suggest a reply
- Enrich the contact
- Retrieve organization knowledge
- Recommend live-agent handoff

### Current limitation

The inbox agent is primarily a reply coach. It cannot perform most workspace
operations that are already available in the UI.

### Missing capabilities

| Capability | Status | Recommended behavior |
| --- | --- | --- |
| Send message | Missing | Draft first; send only after explicit confirmation |
| Accept offer | Missing | Confirm active offer and agent capacity |
| Reject offer | Missing | Require or capture reason when policy requires it |
| Transfer conversation | Missing | List eligible queues/agents and preview target |
| Save disposition | Missing | Validate against organization disposition catalog |
| Resolve conversation | Missing | Confirm resolution and required wrap-up fields |
| End conversation | Missing | Privileged or confirmed mutation depending on state |
| Add notes | Missing | Distinguish personal, customer, and common notes |
| Read notes | Missing | Respect note visibility and role restrictions |
| Change presence | Missing | Validate allowed presence transition |
| Sentiment explanation | Partial | Return current sentiment and evidence without overstating certainty |
| Deep-link to conversation | Partial | Open the exact conversation, not only the workspace page |

### Acceptance examples

- “Draft a reply explaining the refund timeline.”
- “Send that reply.” → requires confirmation
- “Transfer this conversation to Billing.”
- “Resolve this conversation with Issue Resolved.”
- “Add a private note that the customer prefers afternoon calls.”

---

## 6. Task agent

**Status: Phase 1 complete for Agent Portal My Tasks** — the agent now matches the
current UI workflow, including opening the exact conversation workspace linked
to a task. Task creation and administration remain deferred spoke enhancements.

### UI capabilities

- List and filter tasks
- View task details
- Complete tasks
- Dismiss tasks
- Accept co-worker suggestions
- Open the related workspace

### Available agent capabilities

- List tasks
- Get task details
- Complete a task
- Dismiss a task
- Accept a task suggestion
- Open the related conversation workspace when explicitly requested

### Prompt stabilization completed

- Uses live task tools before answering status, due-date, tab, or count questions
- Uses selected-task context for “this task” on task detail
- Requires a uniquely identified task before list-page actions
- Keeps complete, dismiss, and accept-suggestion actions distinct
- Calls `open_task_workspace` only on an explicit request because opening may
  assign or create a conversation and change agent presence
- Navigates using the exact conversation path returned by the tool
- Clearly rejects unsupported task creation, reassignment, priority, and
  due-date mutations

### Deferred spoke enhancements

| Capability | Status | Recommended behavior |
| --- | --- | --- |
| Create follow-up task | Missing | Confirm assignee, due time, contact, and conversation |
| Create callback task | Missing | Validate callback channel and preferred time |
| Assign/reassign task | Missing | Check assignee eligibility and role |
| Update due date/priority | Missing | Confirm material scheduling changes |
| Create escalation task | Missing | Require reason and escalation target |
| Bulk task updates | Proposed | Admin/supervisor only with explicit summary and confirmation |

### Decision required

The current UI treats tasks mainly as system-generated. Decide whether manually
created follow-up tasks are part of the product. Callback task creation is
already an operational requirement and should be supported.

### Acceptance examples

- “Show my overdue tasks.”
- “Open the workspace for this task.”
- “Complete this task.”

---

## 7. Queue agent

### UI capabilities

- List and inspect queues
- Create queues
- Edit queue details
- Activate/deactivate queues
- Delete queues
- Configure agents
- Configure teams
- Configure channels
- Configure business hours and shifts
- View eligible agents and presence

### Available agent capabilities

- List queues
- List teams
- List business hours
- Stage queue draft
- Create queue after confirmation
- Activate/deactivate queue
- Delete queue
- List agents
- List eligible agents
- List presence

### Missing or partial capabilities

| Capability | Status | Recommended behavior |
| --- | --- | --- |
| Full queue edit | Missing | Draft field-level changes and show before/after |
| Add/remove queue agents | Missing | Validate eligibility and preserve minimum staffing |
| Team assignment | Missing | Validate team and queue relationship |
| Channel bindings | Missing | Show existing binding and prevent conflicting ownership |
| Routing policy | Partial | Read and update strategy, priority, and capacity rules |
| Business-hours creation | Missing | Validate timezone and overlapping schedules |
| Business-hours update | Missing | Preview affected queues/channels |
| Shift assignment | Missing | Coordinate with workforce capability |
| Agent skill assignment | Missing | Coordinate with workforce capability |
| Queue health explanation | Missing | Use monitoring data for waiting, SLA, and capacity |

### Permission expectations

- Agent: read-only queue and presence information when needed for transfer
- Supervisor: operational assignment changes where permitted
- Admin: queue create/edit/delete, policies, channels, and business hours

### Acceptance examples

- “Create a support queue for webchat during India business hours.”
- “Add these three eligible agents to Billing.”
- “Move WhatsApp routing from General to Customer Support.”
- “Why is the Sales queue congested?”

---

## 8. Monitoring agent — proposed

### Why a separate specialist

The Live Monitoring UI contains a distinct supervisor domain. Today the
co-worker panel is present, but the page maps to the generic surface and cannot
answer core monitoring questions.

### UI capabilities to expose

#### Read capabilities

- Live queue snapshot
- Live agent snapshot
- Waiting contacts
- Active conversations
- Missed contacts
- Queue backlog
- SLA risk
- Agent presence, capacity, and workload
- Callback attempts
- Attendance
- Not-ready escalations and insights

#### Controlled actions

- Create or assign callback task
- Acknowledge missed-contact/callback alerts
- Acknowledge not-ready escalation
- Reassign conversation
- Supervisor takeover
- Force-close conversation
- Force agent logout

### Confirmation and authorization

| Operation | Minimum policy |
| --- | --- |
| Read monitoring snapshot | Supervisor/admin |
| Create callback task | Supervisor/admin; confirm assignee and schedule |
| Reassign conversation | Supervisor/admin; confirm source and destination |
| Take over conversation | Supervisor/admin; explicit confirmation |
| Force close | Supervisor/admin; explicit confirmation and reason |
| Force logout | Admin or approved supervisor policy; explicit confirmation |

### Safety expectations

- Never infer an agent ID from name alone when names are ambiguous
- Refresh live state immediately before a privileged mutation
- Reject stale operations when conversation or presence state changed
- Explain why a recommended action helps
- Separate recommendations from executed actions

### Acceptance examples

- “Who is waiting longer than five minutes?”
- “Which queue is closest to breaching SLA?”
- “Show agents who are not ready and have active work.”
- “Reassign conversation 123 to an eligible agent.”

---

## 9. Workforce agent — proposed

### Why separate it from queue

Queue configuration consumes workforce information, but workforce management
owns broader concepts such as skills, shifts, attendance, presence, and
capacity. Keeping it separate prevents the queue agent from becoming too broad.

### UI/backend capabilities

- List workforce agents
- Read and update skills
- List shifts
- Create/read business hours
- List presence
- Inspect eligibility and capacity
- View attendance

### Capabilities to add

- Get agent profile and queue memberships
- Update agent skills with confirmation
- Read and manage shifts
- Read and manage business hours
- Explain agent eligibility
- Detect staffing gaps
- Recommend staffing changes
- Read attendance and presence history
- Coordinate assignment changes with queue agent

### Permission expectations

- Agent: own presence, schedule, and performance-related read operations
- Supervisor: team presence, attendance, and operational recommendations
- Admin: skills, shifts, hours, and assignment mutations

---

## 10. Analytics agent

### UI capabilities

- Organization dashboard KPIs
- Agent performance KPIs
- Charts and comparisons
- Export PDF/CSV
- Scheduled reports
- Dashboard analytics incidents
- Forecast and workforce recommendations

### Available agent capabilities

- Ask semantic-layer questions
- Execute organization-scoped read-only analytics
- Generate plots
- Generate agent performance reports
- Access metric definitions

### Missing or partial capabilities

| Capability | Status | Recommended behavior |
| --- | --- | --- |
| Export PDF/CSV | Missing | Generate downloadable artifact using the active scope |
| Scheduled reports | Missing | List, create, update, run, and disable with confirmation |
| Dashboard incidents | Missing | Explain active incidents and supporting evidence |
| Forecast explanation | Missing | Explain assumptions, horizon, and confidence |
| Workforce recommendations | Partial | Produce recommendations; delegate mutations to workforce/queue |
| Monitoring analytics | Missing | Compare current live state with historical baseline |
| Role-aware navigation | Partial | Route admins to dashboard and agents to personal performance |

### Guardrails

- Read-only SQL only
- Organization context must be enforced outside model-generated SQL
- Apply bounded time ranges and result limits
- Avoid exposing another agent’s personal data to unauthorized users
- Clearly label measured values, forecasts, and recommendations

---

## 11. Internal chat agent — optional

### UI capabilities

- Direct messages
- Group conversations
- Attachments
- Room and message history

### Potential agent capabilities

- Search accessible messages
- Summarize a selected thread
- Suggest a reply
- Extract action items
- Create a task from an action item after confirmation
- Link a relevant contact or conversation

### Exclusions for the first release

- Autonomous message sending
- Reading rooms the user cannot access
- Organization-wide monitoring of private conversations

Recommendation: implement after core operational agents unless internal chat is
a high-priority workflow.

---

## 12. Support bot

### Role

The support bot is customer-facing. It should not receive staff, supervisor, or
administrative capabilities merely because those tools exist in the shared
Contact Center capability layer.

### Existing capabilities

- Organization knowledge and FAQ
- Contact entity extraction
- Contact identity resolution and enrichment
- Live-agent handoff recommendation
- Webchat, WhatsApp, social, and email surfaces
- Organization-specific Custom Lola routing for configured organizations

### Enhancements

- Consistent capability contract across default support bot and Custom Lola
- Read safe customer profile context
- Read customer-visible interaction or request status where policy permits
- Create callback request
- Create or check appointments where configured
- Request ticket operations through the future Ticketing spoke
- Receive an approved proactive engagement instruction from the future CCaaS
  super agent
- Explain and initiate human handoff consistently
- Preserve context across specialist or human handoff
- Enforce channel-specific response formatting

### Explicitly prohibited

- Queue administration
- Workforce administration
- Monitoring other customers
- Agent presence or attendance access
- Supervisor takeover
- Force close/logout
- Organization-wide analytics

### Custom Lola alignment

Custom Lola currently uses a separate multi-agent implementation and direct
tools for several workflows. Before adding the CCaaS super agent:

- Normalize its result and error schema
- Align contact identity and handoff behavior with the default support bot
- Separate reusable capabilities from organization-specific prompts
- Keep organization-specific booking and service policy isolated
- Ensure its tools are subject to the same authorization, audit, timeout, and
  idempotency rules

---

## 13. Proactive agent

### Current role

The current proactive agent plans missed-contact callbacks. It is not the Hub
web-tracking or proactive-popup decision-maker.

### Enhancements

- Read missed-contact context
- Recommend callback channel and time
- Check contact consent and preferred channel
- Create a callback task through the task capability
- Return structured recommendation evidence
- Record why a proactive callback was or was not created

### Boundary

Hub and web tracking remain outside this scope. In the future, the CCaaS super
agent may receive an engagement request and delegate the customer interaction
to the support bot, but the Contact Center should not duplicate Hub tracking.

---

## 14. Cross-agent workflows

Specialists should delegate domain work instead of duplicating tools.

### Transfer a conversation

1. Inbox agent reads conversation state.
2. Queue agent returns eligible destinations.
3. Inbox agent stages the transfer.
4. User confirms.
5. Inbox agent executes and returns the updated assignment.

### Create a callback from monitoring

1. Monitoring agent identifies the waiting or missed contact.
2. Contact agent resolves profile and preferred channel.
3. Task agent stages the callback task.
4. Supervisor confirms.
5. Task agent creates it and returns task ID.

### Respond to a customer and hand off

1. Support bot handles the customer turn.
2. Support bot recommends human handoff with reason.
3. Queue capability identifies the appropriate queue.
4. Conversation service starts the handoff.
5. Inbox agent supports the assigned human agent.

### Resolve a conversation

1. Inbox agent summarizes the outcome.
2. Inbox agent retrieves valid dispositions.
3. User selects or confirms disposition.
4. Inbox agent resolves the conversation.
5. Task agent creates follow-up work when required.

---

## 15. Surface and routing enhancements

### Required surface changes

| UI area | Current specialist | Target specialist |
| --- | --- | --- |
| Live Monitoring | `general` through `other` | `monitoring` |
| Workforce agents | `general` through `other` | `workforce` |
| Workforce presence | `general` through `other` | `workforce` |
| Workforce shifts | `general` through `other` | `workforce` |
| Internal Chat | No co-worker | `internal_chat` if implemented |

### Routing requirements

- Preserve organization, user, role, page, and selected resource context
- Route by capability and entity, not keyword alone
- Limit repeated specialist handoffs
- Return unsupported operations clearly
- Never route around role restrictions
- Avoid exposing admin tools merely because an admin-facing agent is registered

---

## 16. Capability priorities

### P0 — operational visibility

1. Add Monitoring agent and surface
2. Add monitoring snapshot read tools
3. Add waiting, missed, SLA, agent, and queue queries
4. Add role and confirmation policy foundation

### P1 — workspace operation parity

1. Conversation transfer
2. Disposition and resolve/end
3. Accept/reject offer
4. Notes
5. Presence updates
6. Callback task creation

### P1 — queue administration parity

1. Full queue edit
2. Queue agent assignments
3. Channel bindings
4. Business hours
5. Routing policy

### P1 — contact follow-up

1. Contact interaction history (read-only)

### P2 — contact and workforce depth

1. Duplicate/merge workflow
2. Preferred channel and consent
3. Skills, shifts, attendance, and capacity
4. Task assignment and scheduling

### P2 — reporting completeness

1. Export
2. Scheduled reports
3. Dashboard incidents
4. Forecast and workforce-plan explanations

### P3 — optional productivity

1. Internal chat specialist
2. Cross-thread action extraction
3. Bulk operations with strict confirmation

---

## 17. Definition of done for each capability

A capability is complete only when:

- UI behavior and backend behavior are understood
- Input and output schemas are documented
- Organization and role authorization are enforced
- Confirmation requirements are implemented
- Idempotency is applied to mutations
- Audit events identify the user, agent, capability, and affected resource
- Errors are structured and safe
- The specialist prompt knows when and how to use it
- Surface policy exposes it only where appropriate
- Unit tests cover success, validation, authorization, and conflict
- Integration tests verify the backing API
- Conversation tests verify natural-language invocation
- The result contains resource identifiers for future orchestration

---

## 18. Decisions for discussion

1. Should sending a customer reply always require confirmation, or can an
   organization enable autonomous replies?
2. Should contact hard-delete be excluded entirely in favor of deactivate?
3. Which roles may create and reassign tasks?
4. Can supervisors edit queue membership, or is that admin-only?
5. Which monitoring actions require admin rather than supervisor?
6. Should workforce remain part of queue agent or become a dedicated agent?
7. Is internal-chat assistance required for the first capability-completion
   milestone?
8. Which operations should the support bot perform directly versus delegate to
   another spoke later?
9. Should Custom Lola be migrated to the shared runtime before the CCaaS super
   agent is implemented?
10. Which capability subset is required before declaring the Contact Center
    spoke ready for A2A?

---

## 19. Recommended milestone boundary

The Contact Center specialist pool is ready for the CCaaS super-agent phase when:

- Monitoring can answer all primary live-state questions
- Inbox can complete the supported conversation lifecycle with confirmation
- Queue can perform full configuration workflows
- Task can create and manage callbacks/follow-ups
- Contact agent is Phase 1 complete; interaction history added before A2A
- Workforce permissions and ownership are decided
- Analytics covers current UI reporting workflows
- Support bot and Custom Lola share consistent capability contracts
- Every mutation has authorization, confirmation, idempotency, and audit
  behavior

After this milestone, the CCaaS super agent can be added as an orchestration
layer over the completed specialist pool. A2A integration with the existing Hub
can then expose selected high-level CCaaS capabilities without duplicating the
underlying agents.
