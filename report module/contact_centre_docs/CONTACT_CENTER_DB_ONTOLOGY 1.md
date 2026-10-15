# Contact Center database ontology

What Contact Center stores in PostgreSQL, what each table and column means, and how the rows point at each other.
This document matches the product as it runs now: setup in `accounts`, live work in `ccass`, and the customer in `cdp`. Billing, reseller, partner, and quotation tables live in the same database and are not part of this product model.

IDs are bigint in Postgres and strings in the API, except `cdp.customer_profile.cdp_id`, which is text. `ccass.conversations.contact_id` stores that same text.
A declared foreign key is enforced by Postgres. A logical reference is a column the application joins on without a cross-schema foreign key.

Shared example, organization 1003 (Worktual):

| Symbol | Value | Meaning |
|--------|-------|---------|
| ORG | 1003 | `accounts.organizations.id` |
| USER_BHARATHI | 5012 | Setup user for Bharathi S |
| USER_SANTHOSH | 5013 | Setup user for Santhosh S |
| USER_TEST | 5014 | Setup user for Test Agent |
| AGENT_BHARATHI | 8801 | `ccass.agents.id` for Bharathi |
| QUEUE_SUPPORT | 4401 | Published Support queue |
| SETUP_QUEUE_SUPPORT | 77 | Setup row that published that queue |
| CONV | 104821 | One web chat conversation |
| CONTACT | `cdp_1003_suji` | Customer profile id |

---

## How the main rows connect

An organization owns users, teams, hours, and setup queues. Publishing a setup queue copies it into `ccass.queues` and copies each staffed person into `ccass.agents` plus `ccass.queue_members`.
A conversation belongs to one organization, one channel, and at most one published queue and one agent. Its `contact_id` is the CDP profile, not a bigint user id.

```text
organizations 1──* setup_users 1──1 agents
organizations 1──* setup_ccaas_queues ──publish── 1 queues
setup_ccaas_queues 1──* setup_ccaas_queue_agents ──publish── * queue_members
setup_business_hours 1──* setup_business_hour_shifts
queues *── business_hours_id ── setup_business_hours

conversations *── queue_id ── queues
conversations *── assigned_agent_id ── agents
conversations *── assigned_user_id ── setup_users
conversations *── contact_id ── customer_profile 1──* identity_keys
conversations 1──* conversation_messages
conversations 1──* conversation_assignments
conversations 1──* conversation_dispositions
agents 1──1 agent_presence
agents 1──* agent_presence_history
agent_tasks *── assigned_user_id ── setup_users
agent_tasks *── conversation_id ── conversations
```

Live routing reads `ccass.queue_members`, not the setup staffing table. The setup table is what the queue profile edits. Publish deletes the live members for that queue and inserts them again from setup.
A member is eligible for a new offer only when `shift_type` matches a `setup_business_hour_shifts` row whose day and clock are open in that template's timezone.

---

## `accounts.organizations`

The tenant company. Every Contact Center query is limited to one organization id, and a user from 1003 cannot read rows from another company.
The SIP domain on this row is what voice uses as `domainName` when an auto-bot call is published.

**Relations.** Users, teams, queues, and channels all store `organization_id` pointing here. `sip_domain_name` is not a foreign key. It is the hostname the media node expects, such as `1003.call.worktual.com`.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `id` | bigint | yes | | Primary key. API clients send this as the string `"1003"`. |
| `tenant_id` | varchar(16) | yes | | Short tenant key stored beside the numeric id. Contact Center queries use `id`, not this string, as `organization_id`. |
| `company_name` | varchar(255) | no | | Display name of the tenant. Shown in the shell and in reports, not used for routing. |
| `work_email` | varchar(255) | no | | Main company mailbox. This is not the mailbox that receives customer email. |
| `lifecycle_status` | varchar(32) | yes, default `active` | `active`, `inactive` | Whether the tenant may sign in and receive traffic. Inactive stops new operational use. |
| `sip_domain_name` | varchar(255) | yes | | Voice domain for this tenant. Auto-bot and agent SIP both use this host. |
| `support_portal_enabled` | boolean | yes, default false | `true`, `false` | Whether the public support portal is on. The portal slug is a separate column. |
| `created_at`, `updated_at` | timestamptz | yes | | When the tenant row was created and last changed, in UTC. |

**Example row:** `id=1003, company_name=Worktual, work_email=worktual.beta@gmail.com, lifecycle_status=active, sip_domain_name=1003.call.worktual.com, support_portal_enabled=false`.

---

## `accounts.setup_users`

A person who can sign in to Contact Center. The password hash and the work email live here, and the same id is what conversations store as `assigned_user_id`.
An agent-scope user may only see work assigned to this id. An admin-scope user may see every user in the same organization, including themselves.

**Relations.** `organization_id` references the tenant. `team_id` references `setup_teams`. Product role is not a column on this table. It is a row in `setup_user_product_access`.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `id` | bigint | yes | | Primary key. This is the id callbacks and reports call the setup user id. |
| `organization_id` | bigint | yes | | Tenant that owns the person. Login will not cross this boundary. |
| `first_name`, `last_name` | varchar | yes | | Name parts shown on the queue profile and in the inbox. |
| `work_email` | varchar | yes | | Sign-in email. Also the address used when the directory looks up an agent. |
| `status` | varchar | yes | `active`, `inactive` | Inactive people are skipped when a queue is published, so they disappear from live routing. |
| `team_id` | bigint | no | | Team they belong to. Queue staffing expects this team to match the queue's team. |
| `ext` | int | no | | SIP extension. Voice routing will not offer a call to a member with a null extension. |

**Example row:** `id=5012, organization_id=1003, first_name=Bharathi, last_name=S, work_email=bhrthsivakumar@gmail.com, status=active, team_id=12, ext=103`.

---

## `accounts.setup_roles` and `accounts.setup_user_product_access`

A role is a name such as agent or supervisor. The access row binds one user, the product `contact-center`, and one role.
Login folds that name into two scopes. `admin`, `administrator`, `manager`, and `supervisor` become admin scope. Any other name becomes agent scope.

**Relations.** `setup_user_product_access.user_id` references `setup_users`. `role_id` references `setup_roles`. Both rows carry `organization_id` so a role from another tenant cannot be attached.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `setup_roles.name` | varchar | yes | `agent`, `admin`, `administrator`, `manager`, `supervisor` | The label an administrator picks. The four admin labels share one data scope. |
| `setup_user_product_access.product_id` | varchar | yes | `contact-center` | Which product this grant is for. Contact Center ignores grants for other products. |
| `setup_user_product_access.user_id` | bigint | yes | | The person who receives the role. |
| `setup_user_product_access.role_id` | bigint | yes | | The role they receive inside this organization. |

**Example row:** user `5012` has product `contact-center` and role `agent`. User `5001` has the same product and role `supervisor`, so reports for 5001 include every agent in organization 1003.

---

## `accounts.setup_teams`

A team groups the people who may be staffed on a queue. The queue profile shows this name next to the queue, and staffing checks that the agent's team matches.
Deleting a team does not delete historical conversations. Those conversations keep the published queue id they already had.

**Relations.** `organization_id` references the tenant. `setup_ccaas_queues.team_id` and `setup_users.team_id` both point here.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `id` | bigint | yes | | Primary key. |
| `organization_id` | bigint | yes | | Tenant that owns the team. |
| `name` | varchar | yes | | Label shown on the queue, for example Sales Team. |

**Example row:** `id=12, organization_id=1003, name=Sales Team`.

---

## `accounts.setup_business_hours` and `accounts.setup_business_hour_shifts`

The hours template is the weekly clock for a queue. The parent row is the overall window. Each child row is one shift on one weekday, with a start and end time.
The queue profile builds Evening, Morning, and Night tabs from these child rows. It does not build them from the word Regular.

**Relations.** Shifts reference `business_hours_id`. A setup queue stores `business_hours_id`. Live routing joins `ccass.queues.business_hours_id` back to these rows when it decides who is on shift.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `name` | varchar | yes | | Template name, such as Worktual-Business Hour or Support Hours. |
| `timezone` | varchar | yes | IANA name, default UTC if empty in routing | The clock used for "is this shift open now". A wrong zone makes every member look off shift together. |
| `open_time`, `close_time` | time | yes | | Overall window printed on the profile, such as 00:00–23:59. |
| `working_days` | jsonb array | yes | `Monday` … `Sunday` | Days the template is open. Routing compares these strings to the database weekday name. |
| `status` | varchar | yes | `active`, `inactive` | Inactive templates fail the open-hours check for non-voice offers. |
| `shift_type` | varchar | yes | The names authored on the template, such as `Evening`, `Morning`, `Night` | Must equal `queue_members.shift_type` for that person to be offered work during this row's clock. |
| `day_of_week` | varchar | yes | `Monday`, `Tuesday`, `Wednesday`, `Thursday`, `Friday`, `Saturday`, `Sunday` | Which weekday this shift row covers. |
| `start_time`, `end_time` | time | yes | | Local start and end inside `timezone`. |
| `crosses_midnight` | boolean | yes | `true`, `false` | When true, the shift is open from start through midnight and again until end. Night 22:00–06:00 uses true. |

**Example parent:** `id=9, organization_id=1003, name=Worktual-Business Hour, timezone=Asia/Kolkata, open_time=00:00, close_time=23:59, working_days=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"], status=active`.

**Example shift:** `business_hours_id=9, shift_type=Morning, day_of_week=Monday, start_time=10:00, end_time=23:59, crosses_midnight=false`.

---

## `accounts.setup_ccaas_queues`

The queue as an administrator edits it. Saving this row does not by itself change who can receive a call. Publish copies it into `ccass.queues`.
The profile "Total agents" number is the count of distinct users on the child staffing table, not the count of people whose shift tab is currently selected.

**Relations.** `team_id` references `setup_teams`. `business_hours_id` references `setup_business_hours`. `organization_id` references the tenant. The published twin is `ccass.queues.setup_queue_id`.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `id` | bigint | yes | | Setup queue id. This is not the id voice routing uses after publish. |
| `name` | varchar | yes | | Name on the profile, such as Support or Sales. |
| `status` | varchar | yes | `active`, `inactive` | Inactive queues are unpublished and receive no new offers. |
| `team_id` | bigint | yes | | Team that owns the queue. |
| `business_hours_id` | bigint | no | | Hours template whose shift names are the legal shift tabs. |
| `shift_types` | jsonb | yes | Copy of shift names | Can lag behind the hours template. Do not treat this list as the source of the profile tabs. |
| `skills` | jsonb | yes | Skill names | Optional skills a member must have before a non-voice offer. |
| `missed_callback_grace_minutes` | int | no | `0`, `5`, `10`, `15`, `30`, or null | How the profile shows proactive recovery. Null or a mapped value becomes Off or Immediate in the UI. This does not remove agents. |

**Example row:** `id=77, organization_id=1003, name=Support, status=active, team_id=12, business_hours_id=9, skills=["English"]`.

---

## `accounts.setup_ccaas_queue_agents`

One person staffed on one setup queue for one shift. The same person may have two rows when they cover both Morning and Night.
The queue profile lists a row only when `shift_type` equals the selected tab. A row stored as Regular is counted in the total and hidden on Evening, Morning, and Night.

**Relations.** `queue_id` references `setup_ccaas_queues`. `user_id` references `setup_users`. Publish copies each row into `ccass.queue_members` with the same `shift_type`.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `queue_id` | bigint | yes | | The setup queue being staffed. |
| `user_id` | bigint | yes | | The person. |
| `shift_type` | varchar | yes, default `Regular` | Must be a `shift_type` that exists on the queue's hours template | Which tab and which live window this membership belongs to. Regular is only valid when the template actually has a Regular shift. |
| `handles_calls` | boolean | yes | `true`, `false` | Whether this membership may take voice. |
| `handles_chat` | boolean | yes | `true`, `false` | Whether this membership may take web chat. |
| `handles_email` | boolean | yes | `true`, `false` | Whether this membership may take email. |
| `handles_whatsapp`, `handles_instagram`, `handles_facebook` | boolean | yes | `true`, `false` | Whether this membership may take that social channel. |
| `call_type` | varchar | yes, default `both` | `inbound`, `outbound`, `both` | Which call direction this membership accepts. |
| `chat_concurrency`, `email_concurrency`, and the social concurrency columns | int | yes, default 1 | 1–20 | How many conversations of that channel this membership may hold at once. |

**Example row:** `queue_id=77, user_id=5012, shift_type=Morning, handles_calls=true, handles_chat=true, handles_email=true, handles_whatsapp=true, handles_instagram=true, handles_facebook=true, call_type=both, chat_concurrency=3`.

---

## `accounts.setup_channel_configs` and the channel children

A channel config is one entry point: a web chat widget, an email mailbox, a social page, or a voice path. Child tables hold the secrets and addresses for that kind of channel.
Automation policy on the channel decides whether a new conversation starts with the bot and which setup queue it should enter.

**Relations.** Each child (`setup_webchat_configs`, `setup_email_configs`, `setup_social_configs`) references one channel config. `setup_voice_dids.routing_queue_id` points at a setup queue. Conversations store `channel_config_id`.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `channel_type` | varchar | yes | `webchat`, `email`, `whatsapp`, `instagram`, `facebook`, `voice` | Which product surface this configuration is. The column name is `channel_type`, not `channel`. |
| `status` | varchar | yes, default `pending` | `pending`, `active`, `inactive` | A new config starts `pending` until it is connected. Inactive configs do not accept new inbound traffic. |
| `setup_email_configs.sender_email` | varchar | no | | The From address customers see. There is no `address` column on the email config. |
| `setup_voice_dids.phone_number` | varchar | yes for a DID | | The number published as CLI on an auto-bot call, taken from the first active DID on an active queue. |
| `setup_voice_dids.status` | varchar | yes | `active`, `inactive` | Only an active DID attached to an active queue can be the outbound caller id. |

**Example DID:** `organization_id=1003, phone_number=+919003009126, status=active, routing_queue_id=77`.

---

## `accounts.setup_knowledge_documents`

Files an administrator uploaded for the organization. The bot and the co-worker may quote text extracted from these files.
They are not the search index. Search is a separate service. This table is the source file list, and it has no title or extraction-status column.

**Relations.** `organization_id` references the tenant. `uploaded_by` points at the setup user who uploaded the file. There is no foreign key to a conversation. A bot turn does not write a row here.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `file_name` | varchar | yes | | The file name the administrator sees, such as `worktual-overview.pdf`. |
| `file_type` | varchar | yes | | The kind of file, such as `pdf` or `docx`. This is not a processing state. |
| `category` | varchar | yes | | The library bucket the file was filed under. |
| `ccaas_audience` | varchar | no | | Who in Contact Center may use the file, when the uploader set an audience. Null means the product default for that organization. |
| `storage_path` | text | yes | | Where the bytes are stored. The model reads extracted text, not this path, at answer time. |

**Example row:** `organization_id=1003, category=product, file_name=worktual-overview.pdf, file_type=pdf, ccaas_audience=bot, uploaded_by=5012`.

---

## `ccass.agents`

The published person routing uses. One setup user has at most one agent row, linked by `setup_user_id`.
Presence, skills, and queue membership all hang off this id. Reports that say "agent" mean this row, not the setup user, unless they join back.

**Relations.** `setup_user_id` is a logical reference to `accounts.setup_users.id`. `organization_id` isolates the tenant. `agent_presence.agent_id` is one-to-one.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `id` | bigint | yes | | Routing id. Offers and queue members store this, not the setup user id. |
| `organization_id` | bigint | yes | | Tenant. |
| `setup_user_id` | bigint | no, unique | | The person this agent was published from. |
| `display_name` | varchar | yes | | Name copied for routing displays. |
| `email` | varchar | no | | Work email copied onto the agent. |
| `status` | varchar | yes, default `active` | `active`, `inactive`, `disabled`, `deleted` | Routing ignores inactive, disabled, and deleted agents. |

**Example row:** `id=8801, organization_id=1003, setup_user_id=5012, display_name=Bharathi S, email=bhrthsivakumar@gmail.com, status=active`.

---

## `ccass.agent_presence` and `ccass.agent_presence_history`

Presence is whether this agent can take work right now. The current row is one per agent. History is one row per state change and is what report hours are summed from.
UMN is the writer of the current presence row. Contact Center publishes an intent and then reads what UMN stored.

**Relations.** Both tables reference `ccass.agents`. History does not reference conversations. A busy state often overlaps a live conversation, but the link is by time, not by a foreign key.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `presence_state` | varchar | yes, default `offline` | `offline`, `ready`, `not_ready`, `break`, `away`, `busy`, `after_contact_work` | The state routing and monitoring trust. Only `ready` can receive a new offer. `after_contact_work` is wrap-up and is not the same as `ready`. |
| `status` | varchar | yes, default `offline` | Same set as `presence_state` | Older column kept in sync with `presence_state`. Prefer `presence_state` when a reader has to choose one. |
| `reason_code` | varchar | no | Free text such as `supervisor_set` or `offer_rejected` | Why the state changed. Not an enum the database checks. |
| `source` | varchar | yes | `system`, `agent`, `admin`, `umn` | Who last wrote the state. |
| `previous_state`, `new_state` | varchar | history | Same presence values | The transition stored for hour totals. |
| `started_at`, `ended_at` | timestamptz | history | | The interval to clip against a report window. An open state has a null `ended_at`. |

**Example current row:** `organization_id=1003, agent_id=8801, presence_state=ready, status=ready, source=agent`.

**Example history:** `agent_id=8801, previous_state=not_ready, new_state=ready, source=agent, started_at=2026-10-06T04:30:00Z, ended_at=null`.

---

## `ccass.queues` and `ccass.queue_members`

The published queue and the people who may receive its work. Routing, transfers, and voice ACD read these tables. They do not read `setup_ccaas_queue_agents` during an offer.
Publish replaces every `queue_members` row for that queue. If the rewrite stops after the delete, the live queue is empty while the setup profile still shows the people.

**Relations.** `queues.setup_queue_id` points at `setup_ccaas_queues`. `queues.business_hours_id` points at the hours template. `queue_members.agent_id` references `agents`. `queue_members.setup_user_id` points at the setup user. Unique key is `(queue_id, agent_id, shift_type)`, so one person can sit on two shifts of the same queue.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `queues.status` | varchar | yes | `active`, `inactive` | Inactive published queues are not offered new work. |
| `queues.skills` | jsonb | yes | | Skill filter copied from setup. |
| `queue_members.shift_type` | varchar | yes, default `Regular` | A shift name from the hours template | Which window this membership is eligible in. |
| `queue_members.handles_*` | boolean | yes | `true`, `false` | Per-channel permission copied from setup. |
| `queue_members.call_type` | varchar | yes, default `both` | `inbound`, `outbound`, `both` | Voice direction filter. |
| `queue_members.*_concurrency` | int | yes | | Cap copied from setup. Offers stop when active plus reserved reaches this cap. |

**Example member:** `queue_id=4401, agent_id=8801, setup_user_id=5012, shift_type=Morning, handles_calls=true, handles_chat=true, call_type=both, chat_concurrency=3`.

---

## `ccass.conversations`

One customer session on one channel. Reports, the inbox, and monitoring all start from this row.
Handled, SLA, and handle time are computed from its timestamps. They are not stored as separate metric tables.

**Relations.** `organization_id` is the tenant. `queue_id` references `ccass.queues` when the session has a queue. `assigned_agent_id` references `agents`. `assigned_user_id` points at `setup_users`. `contact_id` is the CDP profile text. `channel_config_id` points at the channel that received the session. `previous_conversation_id` points at an earlier conversation for the same customer when the product links them.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `channel` | varchar | yes, default `webchat` | `webchat`, `email`, `voice`, `whatsapp`, `instagram`, `facebook` | Which channel this session is on. Charts split on this value. |
| `status` | varchar | yes, default `bot_active` | `bot_active`, `queued`, `assigned`, `active`, `resolved`, `closed` | Where the session is in the inbox. Handled is `resolved`, `closed`, or any row with `ended_at`. There is no `waiting` status. Waiting is a lifecycle value. |
| `lifecycle_state` | varchar | yes, default `bot` | `bot`, `waiting`, `offered`, `connected`, `transferred`, `wrap_up`, `ended` | The finer phase beside `status`. A queued conversation is `waiting`. An accepted conversation is `connected`. Reports still use `status` and the timestamps, not this column, for handled and SLA. |
| `bot_active` | boolean | yes, default true | `true`, `false` | True while the bot still owns the session. |
| `visitor_id` | varchar | no | | Channel identity of the customer, such as a phone number or web visitor id. Agent assist treats this as the caller on a call. |
| `contact_id` | text | no | | CDP profile id. Null until the customer is matched. |
| `queued_at` | timestamptz | no | | When the session entered a queue. |
| `assigned_at` | timestamptz | no | | When an agent was assigned. The 60-second first-reply SLA starts here, not at `created_at`. |
| `first_response_at` | timestamptz | no | | When the first reply was sent. |
| `resolved_at` | timestamptz | no | | When a resolution was saved. This is the resolved count, not merely the end of a call. |
| `ended_at` | timestamptz | no | | When the session ended. Together with `resolved_at` this closes handle time. |
| `transferred_at` | timestamptz | no | | When a transfer completed. |
| `sla_status` | varchar | yes, default `not_started` | Values the product writes: `not_started`, `running`, `responded`, `first_response_breached` | Email moves this to `running` when the clock starts, `responded` when an agent replies in time, and `first_response_breached` when the reply is after `first_response_due_at`. The Reports SLA percent does not read this column. It recomputes a 60-second gap from `assigned_at` to `first_response_at`. |
| `disposition_code` | varchar | no | Wrap-up code the agent picked | Why the session was closed, stored for the conversation itself. |
| `end_reason` | varchar | no | | Short reason the session ended, such as customer hangup. |
| `end_actor` | varchar | no | `agent`, `customer`, `session`, `system` | Who ended the session. `session` is the channel session itself, such as a dropped call, rather than a person pressing end. |

**Example row:** `id=104821, organization_id=1003, channel=webchat, status=resolved, queue_id=4401, assigned_agent_id=8801, assigned_user_id=5012, contact_id=cdp_1003_suji, assigned_at=2026-10-06T09:15:00Z, first_response_at=2026-10-06T09:15:22Z, resolved_at=2026-10-06T09:24:10Z, sla_status=met`.

---

## `ccass.conversation_messages`

One turn in a conversation: something the customer, the bot, or an agent said. Handled counts do not count these rows.
The inbox transcript is this table, paged. The inbox preview line is the latest body, not a second store.

**Relations.** `conversation_id` references `conversations` and deletes with it. `reply_to_message_id` references another message in the same table when a reply is threaded.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `sender_type` | varchar | yes | `customer`, `agent`, `bot`, `system` | Who produced the turn. First response is the first non-customer send. |
| `direction` | varchar | yes, default `inbound` | `inbound`, `outbound` | Whether the turn came in from the customer or went out from the business. |
| `visibility` | varchar | yes, default `customer` | `customer`, `internal` | Internal notes must not be sent to the customer channel. |
| `body` | text | yes | | The text of the turn. |
| `delivery_state` | varchar | yes, default `delivered` | `sent`, `delivered`, `read`, `failed` | How far outbound delivery got. |
| `message_type` | varchar | yes, default `text` | `text`, `note`, `attachment` | Distinguishes a normal turn from an internal note or a file. |
| `created_at` | timestamptz | yes | | When Contact Center stored the turn. |

**Example row:** `conversation_id=104821, sender_type=agent, direction=outbound, visibility=customer, body=I have updated the booking for Friday., delivery_state=read, message_type=text`.

---

## `ccass.conversation_assignments`

An offer of a conversation to one agent. The ringing state in the workspace is an assignment that is still offered.
Accepting the offer assigns the conversation. Rejecting it returns the conversation to the queue and can set the agent not ready.

**Relations.** `conversation_id` references `conversations`. `agent_id` references `agents`. The assignment does not by itself change `queue_members`.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `state` | varchar | yes, default `offered` | `offered`, `accepted`, `rejected`, `expired`, `cancelled`, `ended` | Where this offer is. Only `offered` should ring. `ended` is an assignment that finished with the conversation, and `accepted` is the one that became the live handle. |
| `offered_at`, `accepted_at`, `rejected_at` | timestamptz | no | | When each transition happened. |

**Example row:** `conversation_id=104821, agent_id=8801, state=accepted, offered_at=2026-10-06T09:14:40Z, accepted_at=2026-10-06T09:15:00Z`.

---

## `ccass.conversation_dispositions`

The wrap-up the agent saved after the conversation. A conversation can have more than one disposition when a merge or a transfer records an intermediate outcome.
The resolution rate uses `conversations.resolved_at`, which is set when a final disposition is saved. It does not count rows in this table directly.

**Relations.** `conversation_id` references `conversations` and is removed with the conversation. `disposition_id` references `ccass.dispositions`, which holds the organization's code and label. `agent_id` references the published agent who applied it. `applied_by_user_id` is the setup user. `transfer_id` points at `conversation_transfers` when the wrap-up belongs to a transfer.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `disposition_id` | bigint | yes | | The catalog row the agent picked. The human-readable code lives on `dispositions`, not as a free string on this row. |
| `resolution_code` | varchar | no | | Extra resolution detail when the catalog disposition requires one. This is not the Reports resolved count. |
| `is_final` | boolean | yes, default false | `true`, `false` | True when this wrap-up closes the conversation. An intermediate transfer note stays false. |
| `source` | varchar | yes, default `agent` | `agent`, `transfer`, `merge`, `customer`, `system` | Who recorded the wrap-up. A customer hangup before wrap-up can be stored as `system` or `customer`. |
| `note` | text | no | | Free-text wrap-up the agent typed. |
| `applied_at` | timestamptz | yes | | When the wrap-up was saved. This is the column name. There is no `created_at` on this table. |

**Example row:** `conversation_id=104821, disposition_id=3, agent_id=8801, applied_by_user_id=5012, source=agent, is_final=true, resolution_code=resolved, note=Booking moved to Friday 3 PM, applied_at=2026-10-06T09:24:10Z`.

## `ccass.dispositions`

The organization's wrap-up catalog. Each row is a code an agent can pick, such as resolved or callback.
Saving a conversation disposition points at one of these rows. The Reports resolved count still comes from `conversations.resolved_at`, not from how many catalog rows exist.

**Relations.** `organization_id` isolates the catalog. `conversation_dispositions.disposition_id` references `id`. Unique key is `(organization_id, code)`.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `code` | varchar | yes | | Stable key stored in APIs, unique inside the organization. |
| `label` | varchar | yes | | Words the agent sees in the wrap-up list. |
| `category` | varchar | yes, default `general` | | Grouping for the picker, such as general or voice. |
| `outcome` | varchar | no | | Optional outcome family used when a disposition implies resolved, transferred, or callback. |
| `requires_note` | boolean | yes, default false | `true`, `false` | When true, the agent must type a note before the wrap-up saves. |
| `requires_resolution` | boolean | yes, default false | `true`, `false` | When true, the agent must also supply a resolution code. |
| `is_active` | boolean | yes, default true | `true`, `false` | Inactive codes stay for history and disappear from the picker. |

**Example row:** `organization_id=1003, code=resolved, label=Resolved, category=general, requires_note=false, requires_resolution=false, is_active=true`.

---

## `ccass.agent_tasks`

A callback, follow-up, escalation, or suggestion sitting in an agent's task list. Proactive recovery and the bot callback API insert a callback here.
Creating a task does not remove anyone from a queue. The assignee must be an agent-scope setup user, not an admin.

**Relations.** `assigned_user_id` points at `setup_users`. `conversation_id` references `conversations` when the task came from a session. `contact_id` is the CDP profile text when the customer is known.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `task_type` | varchar | yes | `follow_up`, `callback`, `escalation`, `suggestion` | What kind of work this is. Bot callbacks use `callback`. |
| `status` | varchar | yes, default `open` | `open`, `completed`, `dismissed` | Open tasks stay in the inbox. Completed and dismissed leave the active list. |
| `priority` | varchar | yes, default `normal` | `low`, `normal`, `high`, `critical` | Sort and emphasis. A higher requested priority replaces a lower one when two callbacks collapse into one. |
| `source` | varchar | yes | `self`, `admin`, `coworker`, `system` | Who created it. Co-worker and bot callbacks use `coworker` or `system` as the writer sets it. |
| `channel` | varchar | no | `voice`, `webchat`, `email`, `whatsapp`, `instagram`, `facebook` | Which channel the follow-up should use. |
| `due_at` | timestamptz | no | | When the agent should act. This is the preferred callback time after it has been converted to UTC. |
| `summary`, `notes` | text | summary required | | What the agent sees. Notes hold the phone, email, and the customer's wording. |

**Example row:** `organization_id=1003, assigned_user_id=5012, conversation_id=104821, task_type=callback, status=open, priority=normal, source=coworker, channel=voice, title=Callback · Voice, summary=Callback requested by Yaswanth for 2026-10-09T09:30:00Z, due_at=2026-10-09T09:30:00Z`.

---

## `ccass.conversation_memory` and `ccass.conversation_session_state`

Memory is the rolling summary and extracted facts for one conversation, used when a later turn should not re-read the whole transcript.
Session state is a JSON document per conversation where each bot stores its own keys, such as whether the email sender is already verified.

**Relations.** Both are one row per conversation. Memory optionally points at the last message that was included in the summary.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `rolling_summary` | text | no | | Prose summary so far. This is not the transcript. |
| `extracted_facts` | jsonb | yes, default `[]` | | Structured facts the model already stated. |
| `state` | jsonb | yes, default `{}` | | Bot session keys. Email verification and greeting flags live here. |

**Example memory:** `conversation_id=104821, rolling_summary=Customer asked to move a callback to Friday at 3 PM India time., extracted_facts=[]`.

---

## `cdp.customer_profile` and `cdp.identity_keys`

The customer. Contact Center reads and writes the profile and the identities. Orders remain owned by commerce and are only linked for the customer panel.
`cdp_id` is text. Do not cast it to bigint. Conversations, tasks, and missed contacts store this text in `contact_id`.

**Relations.** Identities reference the profile. There is no foreign key from `ccass` to CDP. The application joins on `contact_id = cdp_id` inside the same organization.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `cdp_id` | text | yes | | Primary identity of the person, stored on conversations as `contact_id`. |
| `organization_id` | bigint | yes | | Tenant. The same email in another organization is a different profile. |
| `first_name`, `last_name` | text | no | | Name shown on the customer panel. |
| `identity_keys.type` | varchar | yes | `email`, `phone`, and the channel visitor types the product writes | How this handle identifies the person. |
| `identity_keys.value` | text | yes | | The email, phone, or visitor id itself. |

**Example profile:** `cdp_id=cdp_1003_suji, organization_id=1003, first_name=Suji, last_name=Kannan`.

**Example identity:** `cdp_id=cdp_1003_suji, type=email, value=suji.kannan@example.com`.

---

## `ccass.conversation_transfers`

One attempt to move a live conversation to another queue or agent. The conversation's `transferred_at` is set when a transfer completes, and that timestamp is what the Transferred KPI counts.
A consult that is cancelled before the other agent accepts does not complete, so it does not increment the KPI.

**Relations.** `conversation_id` references `conversations`. `from_queue_id` and `to_queue_id` reference `queues`. `to_queue_id` is required. `from_agent_id`, `requested_agent_id`, `offered_agent_id`, and `accepted_agent_id` each reference `agents`. `from_user_id` and `accepted_user_id` are setup user ids.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `state` | varchar | yes, default `requested` | `requested`, `queued`, `offered`, `accepted`, `completed`, `rejected`, `expired`, `cancelled` | Where this transfer is. Only `completed` should set the conversation's `transferred_at`. `cancelled` is a consult that never landed. |
| `channel` | varchar | no | Same channel set as conversations | The channel being transferred, so a voice transfer is not mixed with a chat transfer in the same row. |
| `completed_at` | timestamptz | no | | When the receiving agent accepted and the transfer finished. |
| `disposition_code` | varchar | no | | Wrap-up code captured with the transfer, when the sender closed their side. |

**Example row:** `organization_id=1003, conversation_id=104821, from_queue_id=4401, to_queue_id=4402, from_agent_id=8801, accepted_agent_id=8802, state=completed, channel=webchat, requested_at=2026-10-06T09:20:00Z, completed_at=2026-10-06T09:20:40Z`.

## `ccass.transfer_action_operations`

A durable claim that one ACD transfer action was already sent, so a retry does not fire the same telephony action twice.
The row is keyed by the organization and an operation id. It is not the transfer itself. The transfer lives in `conversation_transfers`.

**Relations.** `conversation_id` and `transfer_id` point at the conversation and the transfer this claim belongs to. `requested_by_user_id` is the setup user who asked. There is no foreign key to the media node. `acd_session_id` is the telephony session string.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `state` | varchar | yes, default `pending` | `pending`, `acknowledged`, `failed`, `timed_out` | Whether the media side has confirmed the action. `pending` means Contact Center is still waiting. |
| `action` | smallint | yes | | Numeric ACD action code for this claim. The meaning of each code lives in the voice transfer service, not in a second text column. |
| `error_code` | varchar | no | | Short failure code when `state` is `failed` or `timed_out`. |

**Example row:** `organization_id=1003, operation_id=xfer-104821-1, conversation_id=104821, transfer_id=77, requested_by_user_id=5012, acd_session_id=sess-9188, action=1, state=acknowledged`.

## `ccass.agent_capacity`

How many conversations of one channel an agent is already holding, plus how many offers are reserved.
Routing stops offering when `active_count` plus `reserved_count` reaches `max_concurrency`. The queue membership concurrency is the configured cap. This table is the live counter.

**Relations.** `agent_id` references `agents` and is removed with the agent. Unique key is `(agent_id, channel)`. `organization_id` isolates the tenant.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `channel` | varchar | yes, default `chat` | Channel key used by routing, such as `chat`, `email`, `voice` | Which cap this counter belongs to. One agent has one row per channel. |
| `max_concurrency` | int | yes, default 1 | | The cap copied from the membership when the agent is published. |
| `active_count` | int | yes, default 0 | | Conversations this agent is already handling on this channel. |
| `reserved_count` | int | yes, default 0 | | Offers that are ringing and have not been accepted or released. |

**Example row:** `organization_id=1003, agent_id=8801, channel=chat, max_concurrency=3, active_count=1, reserved_count=0`.

## `ccass.agent_missed_contacts`

A customer who should have been reached and was not. Monitoring lists these as missed, and Analytics uses them for the missed-contact incident.
Acknowledging a miss, or creating a callback for the same conversation, does not delete the queue's agents.

**Relations.** `conversation_id` is required and points at the session that was missed. `agent_id` is set when someone was offered and did not answer. It is null when nobody was eligible. `reason` references `missed_contact_reasons.code`. `assigned_user_id` is the setup user when an offer named one.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `reason` | varchar | yes, default `offer_timeout` | `no_agent_available`, `offer_timeout` | `no_agent_available` means nobody eligible was offered. `offer_timeout` means an agent was offered and did not accept in time. Those are the only codes in `missed_contact_reasons`. |
| `channel` | varchar | yes | Same channel set as conversations | Which channel failed. |
| `missed_at` | timestamptz | yes | | When the miss was recorded. Incidents group by this time. |
| `acknowledged_at` | timestamptz | no | | When a person marked the miss as seen. Null means it is still on the missed list. |

**Example row:** `organization_id=1003, queue_id=4401, conversation_id=104900, agent_id=8801, channel=voice, reason=offer_timeout, customer_name=Suji Kannan, missed_at=2026-10-06T18:05:00Z, acknowledged_at=null`.

## `ccass.missed_contact_reasons`

The lookup behind a missed-contact reason. Labels live here so the inbox does not hard-code the two names.
`agent_missed_contacts.reason` must be one of these codes.

**Relations.** This table has no `organization_id`. The two rows are shared. The miss itself is tenant-scoped.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `code` | varchar | yes, unique | `no_agent_available`, `offer_timeout` | The value stored on the miss. |
| `name` | varchar | yes | `No agents available`, `Not picked up` | The label Monitoring shows. |

**Example row:** `id=2, code=offer_timeout, name=Not picked up, description=An agent was offered and did not accept in time.`

## `ccass.channel_automation_policies`

Per channel config, whether new sessions start on the bot, whether a person can take over, and which queue they enter.
Changing the policy does not rewrite old conversations. Email auto-send is `automation_mode`, not a separate flag on the mailbox alone.

**Relations.** Unique on `(organization_id, channel_config_id)`. `channel_config_id` points at `accounts.setup_channel_configs`. `default_queue_id` points at a setup queue. `allowed_queue_ids` is the set of queues the bot may hand off to.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `bot_enabled` | boolean | yes, default true | `true`, `false` | Whether the bot may answer before a person. |
| `live_agent_enabled` | boolean | yes, default true | `true`, `false` | Whether a person may take the session. False keeps the session on the bot even if the customer asks for someone. |
| `automation_mode` | varchar | yes, default `auto_send` | `auto_send`, `draft_only`, `disabled` | `auto_send` may send the bot reply. `draft_only` keeps it as a draft. `disabled` does not run the bot. |
| `no_agent_behavior` | varchar | yes, default `queue_and_notify` | `queue_and_notify`, `bot_continue`, `close_with_message` | What happens when handoff finds nobody. Queue and notify leaves the customer waiting. Bot continue keeps the bot. Close with message ends the session. |
| `status` | varchar | yes, default `active` | `active`, `inactive` | An inactive policy is ignored for new sessions. |
| `default_queue_id` | bigint | no | | Queue a new session enters when it leaves the bot. |

**Example row:** `organization_id=1003, channel_config_id=15, channel=email, bot_enabled=true, live_agent_enabled=true, automation_mode=auto_send, no_agent_behavior=queue_and_notify, default_queue_id=77, status=active`.

## `ccass.voice_call_outcomes`

The result of a voice-bot session, including a requested callback time, used by the follow-up sweep that may place an auto-bot call.
This is not `agent_tasks`. A callback task for a person is created separately. This row records what the voice session decided.

**Relations.** Unique on `(organization_id, session_id)`. `conversation_id` points at the Contact Center conversation when one was created. `triggered_session_id` is the later session this outcome started, when a follow-up call was placed.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `outcome` | varchar | yes | The voice outcome code the bot stored, such as a callback or a resolved call | What the voice session concluded. The follow-up sweep reads this to decide whether another call is due. |
| `status` | varchar | yes, default `closed` | `closed` is the default. A pending follow-up is whatever status the sweep still selects | Whether this outcome is finished or still waiting to place a call. |
| `callback_at` | timestamptz | no | | When the customer asked to be called, stored in UTC. |
| `mobile` | varchar | yes | | The customer number to dial. This is the customer, not the bot DID. |

**Example row:** `organization_id=1003, session_id=+918838838866, conversation_id=104900, outcome=callback, status=closed, mobile=+919876543210, callback_at=2026-10-09T09:30:00Z`.

## `ccass.queue_members` shift and channel columns that publish copies

Publish copies these membership flags from `setup_ccaas_queue_agents`. They are not a second roster an administrator edits by hand.
A person can have two member rows on one queue when they cover two shifts, because the unique key is `(queue_id, agent_id, shift_type)`.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `handles_social` | boolean | yes, default false | `true`, `false` | Older combined social flag. WhatsApp, Instagram, and Facebook also have their own flags, and routing should prefer the specific one. |
| `handles_inbound` | boolean | yes, default false | `true`, `false` | Whether this membership may take inbound voice, in addition to `call_type`. |
| `handles_outbound` | boolean | yes, default false | `true`, `false` | Whether this membership may place outbound calls. |
| `handles_outbound_campaign` | boolean | yes, default false | `true`, `false` | Whether this membership may take campaign outbound calls. |
| `social_concurrency` | int | yes, default 1 | | Older combined social cap. The per-network caps are `whatsapp_concurrency`, `instagram_concurrency`, and `facebook_concurrency`. |

## `ccass.dashboard_analytics_incidents`

A stored incident the Analytics page shows. The two types the detector writes are a missed-contact spike and a weekly missed-contact spike.
Writing an incident does not add or remove `queue_members`. Queue and channel live inside `scope_json`, not as a foreign key that can delete the queue.

**Relations.** Unique on `(organization_id, fingerprint)`, so the same spike updates one row instead of inserting a duplicate. There is no foreign key to `queues` or `agent_missed_contacts`. The facts are JSON snapshots.

| Column | Type | Required | Values | Meaning |
|--------|------|----------|--------|---------|
| `incident_type` | varchar | yes | `missed_contact_spike`, `weekly_missed_contact_spike` | Which detector produced the row. The weekly type covers a longer window than the ordinary spike. |
| `status` | varchar | yes, default `active` | `active` while the detector still raises it | Whether the incident is current. `resolved_at` is set when it is no longer current. Closing it does not change staffing. |
| `severity` | varchar | yes, default `medium` | `low`, `medium`, `high`, `critical` | How strongly the spike stands out from the baseline. The rank used in code is low 1, medium 2, high 3, critical 4. |
| `source` | varchar | yes, default `rules` | `rules` | The detector that wrote the row. A rules incident is not a person editing the roster. |

**Example row:** `organization_id=1003, incident_type=missed_contact_spike, status=active, severity=high, source=rules, headline=Voice missed contacts rose on Support, first_detected_at=2026-10-06T18:10:00Z, resolved_at=null`.

## Tables this product does not treat as its model

`accounts` also contains leads, quotations, subscriptions, partners, resellers, and invoices. Contact Center does not route, report, or staff from those tables.
Do not add them to a contact-center metric. A conversation count never joins `payments` or `quotations`.
