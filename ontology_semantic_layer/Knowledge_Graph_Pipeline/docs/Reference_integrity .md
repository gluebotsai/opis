# Graph Integrity — implementation brief

Hand this file to the CLI as the complete task.

**No database migrations. No new tables. Changes are confined to the CDC
pipeline and Neo4j.**

Six independent defect classes, each of which produces a silently wrong answer:

| # | Class | Symptom |
|---|---|---|
| A | **Node existence** | campaign mints a `Contact` that CDP never created; counts inflate |
| B | **Label correctness** | a converted lead keeps `:Lead` alongside `:Customer`; segment filters double-count |
| C | **Value correctness** | a foreign key points at the wrong id space; edges silently never form |
| D | **Deletion** | a deleted row leaves its children and edges behind |
| E | **Ordering and replay** | an older CDC event overwrites a newer one; replay changes the graph |
| F | **Polymorphic references** | one column pointing at several labels matches almost nothing |

Every class shares one root cause: **a write that succeeds when it should have
refused.** Nothing errors, so nothing gets noticed until a number is disputed.

---

# PART A — NODE EXISTENCE

## A1. The bug

`campaign.campaign_audience` is `mode: relationship_only` with
`from: {label: Contact, key: cdp_id, column: contact_id}`.

The loader emits `MERGE (:Contact {cdp_id: <contact_id>})`. MERGE creates when it
does not match. An audience row for a contact CDP has not loaded yet **mints a
Contact node containing nothing but an id**, and `MATCH (c:Contact)
RETURN count(c)` counts it.

The cause is ordering, not bad data. CDC delivers `campaign` and `cdp` changes on
different partitions, so campaign regularly wins the race.

**20 edges in core.yaml can currently mint a phantom `Contact`.** Six from
campaign, eleven from CRM, one from ticketing, plus two collection owners.

## A2. The rule

> Only the table that OWNS a label may create it. Every other table may only
> match it. On a failed match: write the referencing row, keep the foreign key as
> a property, mark the node, reconcile later.

Keep the fact. Withhold the false edge. Campaign keeps every audience row and
every `contact_id` — it simply cannot invent a person.

## A3. Where the pending set lives — no new storage

**Node-bearing tables.** The source node is written as normal, plus a marker
label and two properties. The pending set is "every node carrying the marker".

```
(:MessageDelivery:PendingContactRef {
    id: 'md_991',
    contact_id: 'cdp_555',              // the fact, preserved
    _pending_contact_key: 'cdp_555',
    _pending_contact_edges: ['OutreachLog:owner']
})
```

**`mode: relationship_only` tables** have no node to mark, so they get a
transient `:PendingLink`. It carries **no domain label**, so no domain count can
see it, and it is deleted the moment the edge forms.

```
(:PendingLink {
    org: 1003, source_table: 'campaign.campaign_audience',
    from_label: 'Contact', from_key: 'cdp_id', from_value: 'cdp_555',
    to_label: 'Campaign',  to_key: 'id',       to_value: '77',
    edge_type: 'TARGETED_BY', first_seen_at: datetime(), attempts: 0 })
```

---

# PART B — LABEL CORRECTNESS

## B1. The two defects

**The base label is wrong.** `cdp.customer_profile` is mapped `label: Customer`.
Everyone in that table is a **Contact**; `contact_type` says which STAGE they are
at. `MATCH (c:Customer) RETURN count(c)` therefore returns every lead and
prospect as well — it over-counts even after every phantom is deleted.

**Conditional labels are added but never removed.** When `contact_type` moves
`lead -> customer` the loader sets the new label and leaves `:Lead` in place.
Nodes end up carrying both. Any query filtering on `:Lead` silently includes
converted customers.

This is not limited to contact lifecycle. **Every `sublabels:` and every mutable
`extra_labels:` entry in core.yaml has the same defect.** A won deal keeps
`:LostOpportunity` if it was ever lost. A resolved ticket keeps `:BreachedCase`.
A paid invoice keeps `:OverdueInvoice`.

## B2. Three rules

- **Exclusive** — a node carries exactly one member of an exclusive group, never
  two. Clear the whole group, then set one.
- **No default** — a null or unknown value gets **no label**. Leads are people
  the business called leads, not people you failed to classify.
- **Monotonic where the business says so** — Lead → Prospect → Customer is
  forward-only. A Customer never returns to Lead.

## B3. Every conditional-label group in core.yaml

Exclusive groups. All must clear-then-set.

| Table | Column | Group | Mutable | Monotonic |
|---|---|---|---|---|
| `cdp.customer_profile` | contact_type | Lead / Prospect / Customer | yes | **yes** |
| `campaign.website_contacts` | visitor_state | AnonymousVisitor / IdentifiedVisitor | yes | **yes** |
| `accounts.setup_channel_configs` | channel_type | Email / Chat / Social / VoiceChannel | rare | no |
| `crm.deals` | stage | WonOpportunity / LostOpportunity | yes | no |
| `crm.contact_activities` | type | Email / Task / MeetingActivity | rare | no |
| `ticketing.tickets` | status | BreachedCase / ResolvedCase | yes | no |
| `ticketing.ticket_notes` | visibility | PublicReply / PrivateNote | rare | no |
| `campaign.campaigns` | status | LiveCampaign / ScheduledCampaign | yes | no |
| `campaign.regulated_channel_templates` | status | PendingApproval / RejectedTemplate | yes | no |
| `ccass.conversations` | bot_active / lifecycle_state | BotHandled / AgentHandled | yes | no |

Independent flags. Each is set when true and **explicitly removed when false** —
they are not a group, so clear-then-set does not apply.

| Table | Flag | Condition |
|---|---|---|
| `cdp.customer_sessions` | AttributedVisit | utm_campaign not null |
| `crm.companies` | ChannelPartner | channel_role in (franchise, owned_store, brand_hq) |
| `crm.invoices` | OverdueInvoice | escalation_severity not null |
| `crm.contracts` | RenewingContract | auto_renew = true |
| `campaign.email_domains` | AuthenticatedDomain | spf_ok and dkim_ok and dmarc_ok |
| `campaign.campaign_contact_engagement` | Unsubscribed | email_unsubscribed = true |
| `campaign.campaign_send_recipients` | OpenedMessage / ClickedMessage | opened_at / clicked_at not null (monotonic — never unset) |
| `campaign.campaign_send_recipients` | FailedDelivery | status in (failed, skipped) |

Immutable labels — `static:` sublabels and event categories on
`cdp.customer_events` — need no removal logic. Events do not change category.

---

# PART C — VALUE CORRECTNESS

## C1. The bug

A foreign key of the wrong type or the wrong id space **matches nothing, forever,
without error**. The load succeeds. The edge is simply never created. This is
harder to spot than a phantom because the graph looks clean — it is just empty
where it should be connected.

Your core.yaml already flags nine of these. Every one is currently unresolved and
every one blocks a table.

## C2. The register

| # | Table | Issue | Effect if wrong | Status |
|---|---|---|---|---|
| V1 | `ccass.conversations` | `contact_id` may be `cdp.contacts.id`, not `customer_profile.cdp_id` | ConversationLog attaches to the wrong person, or to nobody | **blocking** |
| V2 | `cdp.order_items` | `product_id` may point at `cdp.products` (UUID), not `inventory.products` (bigint) | PURCHASED never forms | **blocking** |
| V3 | `campaign.organization_products` | `product_code` is a Prisma enum; `setup_roles.product_id` uses slugs; both MERGE `PlatformModule` | entitlement resolution reads two id spaces | **blocking** |
| V4 | `campaign.regulated_channel_templates` | `channel_config_id` bigint here, uuid in accounts | SENDS_VIA never forms | **blocking** |
| V5 | `ticketing.proactive_*` (4 tables) | `ticket_id` is int, `SupportCase.id` is string | SupportSignalLog never attaches | coerce declared |
| V6 | `cdp.identity_links` | table may not exist in the CDP schema | SAME_PERSON_AS silently absent | **confirm** |
| V7 | `ccass.agent_missed_contacts` | table not in the introspected reference | MissedEngagement absent | **confirm** |
| V8 | `cdp.anomaly_rules` | `organization_id` may not exist; detectors may be global | hub edge invalid, or detectors missing per tenant | **confirm** |
| V9 | `ticketing.agent_queues` | v1 joined `agent_queues.id = setup_teams.id` — different id spaces | wrong or missing PROJECTION_OF | resolve_later |

Plus four columns marked `requires_migration:` — `site_id`, `page_view_id` on
`cdp.customer_events`, `campaign_ref_id`, `contact_ref_id` on
`cdp.customer_sessions`. Until they exist, ON_SITE never forms.

## C3. The rule

> A declared reference must be **type-checked and range-checked before first
> load**, not discovered empty in production.

Two mechanisms:

**Static** — CI compares the source column type against the target key type. A
mismatch without an explicit `coerce_to_int` / `coerce_to_string` fails the
build. This is CI rule R14.

**Runtime** — a match-rate probe. For every reference, sample the first N rows
and report what fraction resolved. A rate below the declared floor stops the
table rather than loading it half-connected.

```yaml
reference_probe:
  sample_size: 1000
  min_match_rate: 0.90        # per reference, overridable
  on_below_floor: halt_table  # halt_table | warn | continue
  report_to: pipeline_metrics
```

A 0% match rate is an id-space bug. A 95% rate is an ordering race, which defer
handles. **The probe is what tells the two apart**, and it is the single cheapest
check in this document.

---

# PART D — DELETION AND ERASURE

## D1. The bug

The brief so far covers rows arriving. Rows also leave, and CDC emits DELETE.
Three things currently go wrong.

**Orphaned children.** Deleting a `SupportCase` leaves its `CaseAuditLog`
collection, its `LogPeriod` buckets and every `AuditRecord` under them. They are
unreachable and uncountable but still resident, and they still match
`MATCH (a:AuditRecord)`.

**Orphaned edges into deleted nodes.** `DETACH DELETE` handles this; a plain
`DELETE` does not and throws. Either is better than the third case.

**Resurrection.** A DELETE followed by a late-arriving UPDATE for the same row
re-MERGEs the node. The row is gone from Postgres and present in the graph.

## D2. The rules

```yaml
deletion:
  mode: cascade_owned          # composition children die with the parent
  cascade_edges: ["HAS_*", CONTAINS]   # composition verbs only
  never_cascade: ["FOR_*", "OF_*", PROJECTION_OF, ROLE_OF, "*_BY"]
  tombstone:
    enabled: true
    property: _deleted_at
    retention_days: 7
    purge: scheduled
  resurrection_guard: "an upsert whose source_ts < _deleted_at is discarded"
```

The naming law already encodes the answer. `HAS_*` and `CONTAINS` are
composition — the child dies with the parent. `FOR_*`, `OF_*`, `PROJECTION_OF`,
`ROLE_OF` and `*_BY` are reference — the target outlives the referrer and must
never cascade.

**A tombstone, not an immediate delete.** A 7-day `_deleted_at` window catches
the DELETE-then-late-UPDATE race. Every read query filters `_deleted_at IS NULL`;
a scheduled purge removes them afterwards.

## D3. Cascade

```cypher
// delete a SupportCase and everything it composes, batched
MATCH (t:SupportCase {id: $id})
SET t._deleted_at = datetime()
WITH t
OPTIONAL MATCH (t)-[:HAS_AUDIT_LOG|HAS_SIGNAL_LOG]->(coll)
OPTIONAL MATCH (coll)-[:HAS_PERIOD*0..1]->(p)
OPTIONAL MATCH (p)-[:CONTAINS]->(member)
WITH t, collect(DISTINCT coll) + collect(DISTINCT p) + collect(DISTINCT member) AS doomed
UNWIND doomed AS d
SET d._deleted_at = datetime()
RETURN count(d) AS tombstoned;
```

Empty period buckets should be swept in the same job, or a tenant accumulates
thousands of empty `LogPeriod` nodes.

## D4. Erasure — the GDPR path

`crm.privacy_requests` already carries the note that execution must delete the
Contact subtree. This is **not** the same as a CDC delete: erasure is immediate,
irreversible, and must not leave a tombstone.

```cypher
MATCH (c:Contact {cdp_id: $cdp_id})
OPTIONAL MATCH (c)-[:HAS_BEHAVIOUR_LOG|HAS_VISIT_LOG|HAS_TOUCHPOINT_LOG|
                    HAS_CONVERSATION_LOG|HAS_JOURNEY_LOG|HAS_METRIC_SERIES|
                    HAS_ENGAGEMENT_TIMELINE|HAS_OUTREACH_LOG|HAS_KNOWLEDGE_STORE|
                    HAS_INSIGHT_SET|HAS_RECOMMENDATION_SET]->(coll)
OPTIONAL MATCH (coll)-[:HAS_PERIOD*0..1]->()-[:CONTAINS]->(member)
WITH c, collect(DISTINCT coll) AS colls, collect(DISTINCT member) AS members
FOREACH (m IN members | DETACH DELETE m)
FOREACH (x IN colls   | DETACH DELETE x)
DETACH DELETE c
RETURN 'erased';
```

Then clear the pending set, or erasure leaves a trail:

```cypher
MATCH (p:PendingLink) WHERE p.from_value = $cdp_id OR p.to_value = $cdp_id DELETE p;
MATCH (n:PendingContactRef) WHERE n._pending_contact_key = $cdp_id
REMOVE n:PendingContactRef, n._pending_contact_key, n._pending_contact_edges;
```

And the referencing rows keep their foreign key property. **Erasure must also
null the retained key**, or `contact_id` on a MessageDelivery outlives the
person it identified.

---

# PART E — ORDERING, IDEMPOTENCY AND REPLAY

## E1. The bug

CDC is at-least-once and per-partition ordered, not globally ordered. Three
consequences.

**Out-of-order updates.** Two updates to one row on different offsets can apply
in reverse, so the graph holds the older value. Nothing errors.

**Non-idempotent counters.** Any hub or collection rollup written as
`SET n.count = n.count + 1` inflates on redelivery.

**Replay divergence.** Reprocessing a batch must produce an identical graph.
Anything that appends rather than sets breaks this.

## E2. The rules

```yaml
write_semantics:
  version_column: [updated_at, version, source_ts]   # first present wins
  guard: "skip the write when incoming version <= stored _source_version"
  counters: recompute_never_increment
  replay: "reprocessing any batch must yield a byte-identical graph"
```

```cypher
MERGE (c:Contact {cdp_id: $cdp_id})
ON CREATE SET c._source_version = $version
WITH c WHERE $version >= coalesce(c._source_version, 0)
SET c += $props, c._source_version = $version
RETURN c;
```

`ccass.conversations` already carries `version` and `lifecycle_version`, and
`ccass.agent_capacity` and `agent_presence` carry `version`. Use them. For tables
without one, `updated_at` is the fallback — and where neither exists, that is a
gap worth recording rather than assuming safe.

The monotonic lifecycle guard in B is a special case of this: it protects
business meaning, the version guard protects write order. **Both are needed** —
a stale event carrying `customer` must not be applied, and a fresh event carrying
`lead` must not downgrade.

---

# PART F — POLYMORPHIC REFERENCES

## F1. The bug

One column pointing at several possible labels. If the loader tries all of them,
it either matches the wrong node or creates phantoms in every candidate label.

Three in core.yaml today:

| Table | Column | Candidates |
|---|---|---|
| `ccass.conversation_participants` | `identity_ref` | email / visitor id / page-scoped id — resolves through `ContactIdentity`, not directly |
| `crm.agent_memories` | `scope_type` + `scope_id` | org / user / contact / deal |
| `campaign.app_notifications` | `subject_kind` + `subject_id` | campaign / template / whatsapp |

## F2. The rule

> A polymorphic reference is only emitted when a **discriminator column** names
> the target label. Without one, no edge is emitted and the columns stay
> properties.

`campaign.app_notifications` is already correct — `subject_kind` guards each
typed edge with `when:`. Copy that pattern.

`crm.agent_memories` has `scope_type` and can be fixed the same way:

```yaml
relationships:
  - {type: SCOPED_TO, to: Employee,    to_key: id,     from_column: scope_id, when: {scope_type: [user]}}
  - {type: SCOPED_TO, to: Contact,     to_key: cdp_id, from_column: scope_id, when: {scope_type: [contact]}}
  - {type: SCOPED_TO, to: Opportunity, to_key: id,     from_column: scope_id, when: {scope_type: [deal]}}
  # scope_type = org needs no edge; organization_id already scopes the database
```

`ccass.conversation_participants` has **no** discriminator and must stay a
property island until `identity_type` exists on the table. Guessing here is what
produced the v1 defect where the same column was pointed at both `Agent.id` and
`Contact.cdp_id`.

**The derived-column dependency.** `subject_kind` and `subject_id` are computed
in `derived:`. If a derivation is missing or wrong, the `when:` guard never
matches and the edges vanish silently — the Part C failure mode arriving through
a different door. CI rule R06 already requires every derived column to exist;
extend it to require that every `when:` column is either a real column or a
declared derivation.

---

# PART G — CONFIGURATION

Paste into core.yaml after `derived:`, before `merged_labels:`.

```yaml
graph_integrity:
  enabled: true
  default_on_missing: defer          # defer | skip | fail | create

  # ---------------------------------------------------------------------------
  # A. NODE OWNERSHIP — exactly one table may CREATE each label.
  # ---------------------------------------------------------------------------
  node_ownership:
    Contact:        {owner: cdp.customer_profile,  key: cdp_id, lifecycle: contact_lifecycle}
    Employee:       {owner: accounts.setup_users,  key: id}
    Team:           {owner: accounts.setup_teams,  key: id}
    Account:        {owner: crm.companies,         key: id}
    AccountSite:    {owner: crm.company_locations, key: id}
    Opportunity:    {owner: crm.deals,             key: id}
    Contract:       {owner: crm.contracts,         key: id}
    Offering:       {owner: inventory.products,    key: id}
    Quote:          {owner: crm.quotes,            key: id}
    Proposal:       {owner: crm.proposals,         key: id}
    SalesOrder:     {owner: crm.sales_orders,      key: id}
    Invoice:        {owner: crm.invoices,          key: id}
    Purchase:       {owner: cdp.orders,            key: order_id}
    Conversation:   {owner: ccass.conversations,   key: id}
    ServiceQueue:   {owner: ccass.queues,          key: id}
    QueueDefinition: {owner: accounts.setup_ccaas_queues, key: id}
    SupportCase:    {owner: ticketing.tickets,     key: id}
    SupportQueue:   {owner: ticketing.agent_queues, key: id}
    SupportProfile: {owner: ticketing.contact_profile, key: id}
    SupportAccount: {owner: ticketing.ticketing_accounts, key: id}
    SalesProfile:   {owner: crm.contact_profiles,  key: id}
    Campaign:       {owner: campaign.campaigns,    key: id}
    CampaignDraft:  {owner: campaign.campaign_agent_sessions, key: id}
    SendBatch:      {owner: campaign.campaign_send_batches, key: id}
    BusinessUnit:   {owner: campaign.branches,     key: id}
    MessageTemplate: {owner: campaign.campaign_channel_templates, key: id}
    ApprovedTemplate: {owner: campaign.regulated_channel_templates, key: id}
    WebVisitor:     {owner: campaign.website_contacts, key: id, lifecycle: visitor_lifecycle}
    Persona:        {owner: cdp.persona_definitions, key: persona_id}
    AudienceSegment: {owner: cdp.segments,         key: segment_id}
    Visit:          {owner: cdp.customer_sessions, key: session_id}
    Skill:          {owner: ccass.skills,          key: id}
    AnomalyDetector: {owner: cdp.anomaly_rules,    key: rule_id}
    EngagementActivity: {owner: crm.contact_activities, key: id}
    LiveMeetingSession: {owner: crm.meeting_assist_sessions, key: id}
    BotSkillVersion: {owner: ccass.nlp_skill_versions, key: id}
    ChannelAccount: {owner: accounts.setup_channel_configs, key: id}
    HolidaySchedule: {owner: accounts.setup_holiday_calendars, key: id}
    OperatingSchedule: {owner: accounts.setup_business_hours, key: id}
    SendingLimit:   {owner: campaign.email_sending_caps, key: organization_id}
    SendingDomain:  {owner: campaign.email_domains, key: id}
    SenderComplianceProfile: {owner: campaign.email_org_profiles, key: organization_id}
    StaffRole:          {owner: [ccass.agents, ticketing.agents], key: uid, merged: true}
    ServiceLevelPolicy: {owner: [ccass.sla_policies, ticketing.sla_policies], key: uid, merged: true}

  # The ONLY labels create_target is permitted on: bounded dimension stubs with
  # no owning table.
  create_target_allowed:
    Channel:        {from_columns: [channel_type, channel]}
    PlatformModule: {from_columns: [product_id, product_code]}
    TrackedSite:    {from_columns: [site_id]}
    LogPeriod:      {minted_by: collection_builder}

  # Every edge that MERGEs a label it does not own.
  edge_policy:
    campaign.campaign_audience:           {target: Contact, edge: TARGETED_BY, mode: relationship_only, on_missing: defer}
    campaign.campaign_audience_refs:      {target: Contact, edge: CONTAINS, mode: relationship_only, on_missing: defer}
    campaign.push_endpoints:              {target: Contact, edge: HAS_PUSH_SUBSCRIPTION, on_missing: defer}
    campaign.website_contacts:            {target: Contact, edge: RESOLVED_TO, on_missing: defer}
    campaign.campaign_contact_engagement: {target: Contact, edge: HAS_OUTREACH_ENGAGEMENT, on_missing: defer}
    campaign.campaign_send_recipients:    {target: Contact, collection_owner: true, on_missing: defer}
    crm.contact_profiles:      {target: Contact, edge: SALES_VIEW_OF, on_missing: defer}
    crm.deals:                 {target: Contact, edge: PRIMARY_CONTACT, on_missing: defer}
    crm.sales_orders:          {target: Contact, edge: PLACED_BY, on_missing: defer}
    crm.privacy_requests:      {target: Contact, edge: ABOUT_CUSTOMER, on_missing: defer}
    crm.lead_scoring_jobs:     {target: Contact, edge: ABOUT_CUSTOMER, on_missing: defer}
    crm.lead_nurture_jobs:     {target: Contact, edge: ABOUT_CUSTOMER, on_missing: defer}
    crm.lead_lifecycle_jobs:   {target: Contact, edge: ABOUT_CUSTOMER, on_missing: defer}
    crm.lead_enrichment_jobs:  {target: Contact, edge: ABOUT_CUSTOMER, on_missing: defer}
    crm.contact_activities:        {target: Contact, collection_owner: true, on_missing: defer}
    crm.lead_enrichment_snapshots: {target: Contact, collection_owner: true, on_missing: defer}
    crm.lead_summaries:            {target: Contact, collection_owner: true, on_missing: defer}
    ticketing.contact_profile: {target: Contact, edge: SUPPORT_VIEW_OF, on_missing: defer}
    cdp.interactions:          {target: Contact, collection_owner: true, on_missing: defer}
    ccass.conversations:       {target: Contact, collection_owner: true, on_missing: skip, blocked_by: V1}
    cdp.order_items:           {target: Offering, edge: PURCHASED, mode: relationship_only, on_missing: skip, blocked_by: V2}
    ccass.agent_tasks:           {target: Employee, collection_owner: true, on_missing: defer}
    ccass.agent_missed_contacts: {target: Employee, collection_owner: true, on_missing: defer, blocked_by: V7}
    crm.notifications:           {target: Employee, collection_owner: true, on_missing: defer}
    ticketing.audit_events:              {target: SupportCase, collection_owner: true, on_missing: defer}
    ticketing.outbound_email_log:        {target: SupportCase, collection_owner: true, on_missing: defer}
    ticketing.proactive_outbox:          {target: SupportCase, collection_owner: true, on_missing: defer, coerce_owner_to_int: true}
    ticketing.proactive_recommendations: {target: SupportCase, collection_owner: true, on_missing: defer, coerce_owner_to_int: true}
    ticketing.proactive_approvals:       {target: SupportCase, collection_owner: true, on_missing: defer, coerce_owner_to_int: true}
    ticketing.proactive_audit:           {target: SupportCase, collection_owner: true, on_missing: defer, coerce_owner_to_int: true}

  defer:
    node_bearing:
      marker_label:  "Pending{Target}Ref"
      key_property:  "_pending_{target_lower}_key"
      edge_property: "_pending_{target_lower}_edges"
    relationship_only:
      quarantine_label: PendingLink
    max_age_days: 30
    on_expiry: alert

  reconcile:
    trigger: on_owner_upsert
    also_run: {schedule: "*/5 * * * *", batch_size: 5000}
    idempotent: true

  # ---------------------------------------------------------------------------
  # B. LIFECYCLES — ordered, exclusive, forward-only label groups.
  # ---------------------------------------------------------------------------
  lifecycles:
    contact_lifecycle:
      base_label: Contact
      column: contact_type
      exclusive: true
      monotonic: true
      stages:
        - {value: lead,     label: Lead,     rank: 1}
        - {value: prospect, label: Prospect, rank: 2}
        - {value: customer, label: Customer, rank: 3}
      unclassified: {when: [null, "", unknown], label: null}
      properties:
        stage: _lifecycle_stage
        rank:  _lifecycle_rank
        reached_at: _lifecycle_reached_at
      on_downgrade: hold_and_flag
      downgrade_flag: _lifecycle_downgrade_attempted_at

    visitor_lifecycle:
      base_label: WebVisitor
      column: visitor_state
      exclusive: true
      monotonic: true
      stages:
        - {value: anonymous,  label: AnonymousVisitor,  rank: 1}
        - {value: identified, label: IdentifiedVisitor, rank: 2}
      unclassified: {when: [null], label: null}
      on_downgrade: hold_and_flag

  # Exclusive but NOT ordered: clear-then-set, no rank, downgrade meaningless.
  exclusive_label_groups:
    accounts.setup_channel_configs: {column: channel_type, group: [EmailChannel, ChatChannel, SocialChannel, VoiceChannel]}
    crm.deals:                      {column: stage, group: [WonOpportunity, LostOpportunity]}
    crm.contact_activities:         {column: type, group: [EmailActivity, TaskActivity, MeetingActivity]}
    ticketing.tickets:              {column: status, group: [BreachedCase, ResolvedCase]}
    ticketing.ticket_notes:         {column: visibility, group: [PublicReply, PrivateNote]}
    campaign.campaigns:             {column: status, group: [LiveCampaign, ScheduledCampaign]}
    campaign.regulated_channel_templates: {column: status, group: [PendingApproval, RejectedTemplate]}
    ccass.conversations:            {columns: [bot_active, lifecycle_state], group: [BotHandled, AgentHandled]}

  # Independent flags: SET when true, REMOVE when false. Not a group.
  removable_flags:
    cdp.customer_sessions:                {AttributedVisit: "utm_campaign IS NOT NULL"}
    crm.companies:                        {ChannelPartner: "channel_role IN ('franchise','owned_store','brand_hq')"}
    crm.invoices:                         {OverdueInvoice: "escalation_severity IS NOT NULL"}
    crm.contracts:                        {RenewingContract: "auto_renew = true"}
    campaign.email_domains:               {AuthenticatedDomain: "spf_ok AND dkim_ok AND dmarc_ok"}
    campaign.campaign_contact_engagement: {Unsubscribed: "email_unsubscribed = true"}
    campaign.campaign_send_recipients:
      OpenedMessage:  {expr: "opened_at IS NOT NULL",  monotonic: true}
      ClickedMessage: {expr: "clicked_at IS NOT NULL", monotonic: true}
      FailedDelivery: {expr: "status IN ('failed','skipped')"}

  # ---------------------------------------------------------------------------
  # C. REFERENCE PROBE — catch id-space bugs before they load empty.
  # ---------------------------------------------------------------------------
  reference_probe:
    sample_size: 1000
    min_match_rate: 0.90
    on_below_floor: halt_table
    report_to: pipeline_metrics
    blocking_verifications:
      V1: {table: ccass.conversations, column: contact_id, question: "cdp.contacts.id or customer_profile.cdp_id?"}
      V2: {table: cdp.order_items, column: product_id, question: "cdp.products UUID or inventory.products bigint?"}
      V3: {table: campaign.organization_products, column: product_code, question: "enum vs setup_roles.product_id slug"}
      V4: {table: campaign.regulated_channel_templates, column: channel_config_id, question: "bigint here vs uuid in accounts"}
      V6: {table: cdp.identity_links, question: "does the table exist?"}
      V7: {table: ccass.agent_missed_contacts, question: "does the table exist?"}
      V8: {table: cdp.anomaly_rules, question: "organization_id present, or detectors global?"}
      V9: {table: ticketing.agent_queues, question: "does external_id carry the team reference?"}

  # ---------------------------------------------------------------------------
  # D. DELETION
  # ---------------------------------------------------------------------------
  deletion:
    mode: cascade_owned
    cascade_edges: [HAS_*, CONTAINS]
    never_cascade: [FOR_*, OF_*, PROJECTION_OF, ROLE_OF, "*_BY"]
    tombstone: {enabled: true, property: _deleted_at, retention_days: 7, purge: scheduled}
    resurrection_guard: "an upsert whose source version < _deleted_at is discarded"
    sweep_empty_buckets: true
  erasure:
    trigger: crm.privacy_requests.executed_at
    tombstone: false
    clear_pending: true
    null_retained_keys: true

  # ---------------------------------------------------------------------------
  # E. WRITE SEMANTICS
  # ---------------------------------------------------------------------------
  write_semantics:
    version_column: [version, lifecycle_version, updated_at, source_ts]
    version_property: _source_version
    guard: skip_when_stale
    counters: recompute_never_increment
    replay: byte_identical

  # ---------------------------------------------------------------------------
  # F. POLYMORPHIC REFERENCES
  # ---------------------------------------------------------------------------
  polymorphic:
    require_discriminator: true
    campaign.app_notifications: {discriminator: subject_kind, id: subject_id, status: resolved}
    crm.agent_memories:         {discriminator: scope_type,   id: scope_id,   status: implement}
    ccass.conversation_participants: {discriminator: null, id: identity_ref, status: blocked,
                                      reason: "no identity_type column; resolve through ContactIdentity once available"}

  # ---------------------------------------------------------------------------
  # COUNT INTEGRITY
  # ---------------------------------------------------------------------------
  count_integrity:
    provenance_property: {name: _owner, value: "<owning table>"}
    canonical_counts:
      contacts:  "MATCH (c:Contact)          WHERE c._owner = 'cdp.customer_profile' AND c._deleted_at IS NULL RETURN count(c)"
      leads:     "MATCH (c:Contact:Lead)     WHERE c._owner = 'cdp.customer_profile' AND c._deleted_at IS NULL RETURN count(c)"
      prospects: "MATCH (c:Contact:Prospect) WHERE c._owner = 'cdp.customer_profile' AND c._deleted_at IS NULL RETURN count(c)"
      customers: "MATCH (c:Contact:Customer) WHERE c._owner = 'cdp.customer_profile' AND c._deleted_at IS NULL RETURN count(c)"
    invariant: "contacts = leads + prospects + customers + unclassified"
```

---

# PART H — PIPELINE IMPLEMENTATION

## H1. `cypher_builder.py` — target resolution

```python
def resolve_target(label, table, cfg):
    """create | match | defer | skip"""
    owner = cfg.node_ownership.get(label, {}).get("owner")
    owners = owner if isinstance(owner, list) else [owner]
    if table in owners:
        return "create"                      # the owning table
    if label in cfg.create_target_allowed:
        return "create"                      # bounded dimension stub
    return cfg.edge_policy.get(table, {}).get("on_missing", cfg.default_on_missing)
```

- **create** — `MERGE (n:Label {key:$v}) SET n._owner = '<table>'`
- **match** — `MATCH`; a miss falls through to defer
- **defer** — H3 / H4
- **skip** — write the source row, emit no edge, increment a counter

`_owner` is set **only** by the owning table's writer.

## H2. Node write — the full statement

Every node write combines four guards: version, provenance, exclusive labels,
removable flags.

```cypher
MERGE (n:SupportCase {id: $id})
ON CREATE SET n._owner = 'ticketing.tickets', n._source_version = $version

// E. staleness guard — an older event must not overwrite a newer one
WITH n WHERE $version >= coalesce(n._source_version, 0)
SET n += $props, n._source_version = $version, n._deleted_at = null

// B. exclusive group — clear the whole group, then set at most one
REMOVE n:BreachedCase, n:ResolvedCase
FOREACH (_ IN CASE WHEN $status = 'Overdue'  THEN [1] ELSE [] END | SET n:BreachedCase)
FOREACH (_ IN CASE WHEN $status = 'Resolved' THEN [1] ELSE [] END | SET n:ResolvedCase)

RETURN n.id;
```

For independent flags, set and remove explicitly — they are not a group:

```cypher
FOREACH (_ IN CASE WHEN $auto_renew      THEN [1] ELSE [] END | SET    n:RenewingContract)
FOREACH (_ IN CASE WHEN NOT $auto_renew  THEN [1] ELSE [] END | REMOVE n:RenewingContract)
```

Monotonic flags (`OpenedMessage`, `ClickedMessage`) are set-only — an open is
never un-opened.

## H3. Lifecycle write

```cypher
MERGE (c:Contact {cdp_id: $cdp_id})
ON CREATE SET c._owner = 'cdp.customer_profile', c._source_version = $version
WITH c WHERE $version >= coalesce(c._source_version, 0)
SET c += $props, c._source_version = $version

REMOVE c:Lead, c:Prospect, c:Customer

WITH c,
     CASE $contact_type WHEN 'lead' THEN 1 WHEN 'prospect' THEN 2
                        WHEN 'customer' THEN 3 ELSE 0 END AS incoming,
     coalesce(c._lifecycle_rank, 0) AS current
WITH c, incoming, current,
     CASE WHEN incoming >= current THEN incoming ELSE current END AS effective

FOREACH (_ IN CASE WHEN incoming > 0 AND incoming < current THEN [1] ELSE [] END |
  SET c._lifecycle_downgrade_attempted_at = datetime(),
      c._lifecycle_downgrade_to = $contact_type)

FOREACH (_ IN CASE WHEN effective = 1 THEN [1] ELSE [] END | SET c:Lead)
FOREACH (_ IN CASE WHEN effective = 2 THEN [1] ELSE [] END | SET c:Prospect)
FOREACH (_ IN CASE WHEN effective = 3 THEN [1] ELSE [] END | SET c:Customer)

SET c._lifecycle_rank  = CASE WHEN effective = 0 THEN null ELSE effective END,
    c._lifecycle_stage = CASE effective WHEN 1 THEN 'lead' WHEN 2 THEN 'prospect'
                                        WHEN 3 THEN 'customer' ELSE null END,
    c._lifecycle_reached_at =
      CASE WHEN effective > current THEN datetime() ELSE c._lifecycle_reached_at END
RETURN c.cdp_id;
```

Three things this gets right that the current loader does not: **REMOVE before
SET**, so two stages can never coexist; **no default**, so an unknown
`contact_type` produces no label; **hold-and-flag on downgrade**, so the business
rule holds and the data conflict stays visible.

## H4. Defer — node-bearing

```cypher
MERGE (s:MessageDelivery {id: $id})
SET s += $props
WITH s
OPTIONAL MATCH (c:Contact {cdp_id: $contact_id})
WHERE c._owner = 'cdp.customer_profile' AND c._deleted_at IS NULL
FOREACH (_ IN CASE WHEN c IS NULL THEN [1] ELSE [] END |
  SET s:PendingContactRef,
      s._pending_contact_key = $contact_id,
      s._pending_contact_edges =
        CASE WHEN $edge IN coalesce(s._pending_contact_edges, [])
             THEN s._pending_contact_edges
             ELSE coalesce(s._pending_contact_edges, []) + $edge END)
FOREACH (_ IN CASE WHEN c IS NOT NULL THEN [1] ELSE [] END |
  MERGE (c)-[:HAS_OUTREACH_LOG]->(:OutreachLog {cdp_id: $contact_id}))
```

## H5. Defer — relationship_only

```cypher
OPTIONAL MATCH (f:Contact {cdp_id: $from_value})
  WHERE f._owner = 'cdp.customer_profile' AND f._deleted_at IS NULL
OPTIONAL MATCH (t:Campaign {id: $to_value}) WHERE t._deleted_at IS NULL
FOREACH (_ IN CASE WHEN f IS NOT NULL AND t IS NOT NULL THEN [1] ELSE [] END |
  MERGE (f)-[:TARGETED_BY]->(t))
FOREACH (_ IN CASE WHEN f IS NULL OR t IS NULL THEN [1] ELSE [] END |
  MERGE (p:PendingLink {org: $org, source_table: $src,
                        from_value: $from_value, to_value: $to_value,
                        edge_type: $edge})
  SET p.from_label = $from_label, p.from_key = $from_key,
      p.to_label = $to_label, p.to_key = $to_key,
      p.first_seen_at = coalesce(p.first_seen_at, datetime()),
      p.attempts = coalesce(p.attempts, 0))
```

## H6. Reconciler

Runs on every owner upsert and on a 5-minute schedule.

```cypher
// A — node-bearing, one statement per (target, edge)
MATCH (s:PendingContactRef) WHERE $edge IN s._pending_contact_edges
MATCH (c:Contact {cdp_id: s._pending_contact_key})
WHERE c._owner = 'cdp.customer_profile' AND c._deleted_at IS NULL
WITH s, c LIMIT $batch
MERGE (c)-[:SALES_VIEW_OF]->(s)
SET s._pending_contact_edges = [e IN s._pending_contact_edges WHERE e <> $edge]
WITH s WHERE size(s._pending_contact_edges) = 0
REMOVE s:PendingContactRef, s._pending_contact_key, s._pending_contact_edges
RETURN count(*) AS reconnected;

// B — relationship_only
MATCH (p:PendingLink {edge_type: $edge, from_label: 'Contact'})
MATCH (f:Contact {cdp_id: p.from_value}) WHERE f._owner = 'cdp.customer_profile'
MATCH (t:Campaign {id: p.to_value})
WITH p, f, t LIMIT $batch
MERGE (f)-[:TARGETED_BY]->(t)
DELETE p
RETURN count(*) AS reconnected;
```

Generate one variant per `(target_label, edge_type)` pair from `edge_policy` —
11 for `Contact`, 3 for `Employee`, 6 for `SupportCase`. No APOC required.

## H7. Health signals

```cypher
// stuck pending set — the id-space alarm
MATCH (p:PendingLink)
WHERE p.first_seen_at < datetime() - duration({days: 30})
RETURN p.source_table, p.edge_type, count(*) AS stuck ORDER BY stuck DESC;

// downgrade attempts — business rule vs source conflict
MATCH (c:Contact) WHERE c._lifecycle_downgrade_attempted_at IS NOT NULL
RETURN c._lifecycle_stage, c._lifecycle_downgrade_to, count(*) ORDER BY 3 DESC;

// stale-write rejections, per table, from pipeline counters
// reference probe match rates, per reference, from pipeline counters
```

**A queue that drains in minutes is an ordering race and is expected. A queue
that only grows is an id-space bug — investigate, do not retry.** That single
distinction is what V1 and V2 are waiting on.

---

# PART I — REPAIR RUNBOOKS

Run per tenant database. **Order matters** — while `:Customer` means both "base
label" and "lifecycle stage", no count is trustworthy.

## I1. Phantoms

```cypher
// 1 — how bad is it (read-only)
MATCH (c:Customer)
RETURN count(c) AS reported_today,
       count(CASE WHEN c.created_at IS NOT NULL THEN 1 END) AS real_contacts,
       count(CASE WHEN c.created_at IS NULL     THEN 1 END) AS phantoms;

// 2 — which product created them (read-only)
MATCH (c:Customer) WHERE c.created_at IS NULL
MATCH (c)-[r]-(n)
RETURN type(r) AS edge, head(labels(n)) AS neighbour, count(DISTINCT c) AS phantoms
ORDER BY phantoms DESC;

// 3 — backfill provenance on the REAL ones. Only cdp.customer_profile sets
//     created_at, so it is a safe marker.
MATCH (c:Customer) WHERE c.created_at IS NOT NULL AND c._owner IS NULL
SET c._owner = 'cdp.customer_profile' RETURN count(*) AS marked;

// 4 — convert phantoms into deferred refs. DO NOT DELETE FIRST: the edges
//     pointing at them are the only record of what must reconnect.
MATCH (c:Customer) WHERE c._owner IS NULL
MATCH (c)-[r]-(src)
SET src:PendingContactRef,
    src._pending_contact_key = c.cdp_id,
    src._pending_contact_edges = coalesce(src._pending_contact_edges, []) + type(r)
RETURN count(DISTINCT src) AS sources_marked;

// 5 — delete the phantoms, batched
MATCH (c:Customer) WHERE c._owner IS NULL
WITH c LIMIT 10000 DETACH DELETE c RETURN count(*);   // repeat until 0
```

## I2. Rename `Customer` → `Contact`

```cypher
MATCH (c:Customer) WHERE c._owner = 'cdp.customer_profile'
WITH c LIMIT 10000
SET c:Contact REMOVE c:Customer
RETURN count(*);    // repeat until 0
```

Run **after** I1 and **before** I3, so `:Customer` is free for reuse as a stage.

core.yaml edits, all mechanical:

| Location | Change |
|---|---|
| `cdp.customer_profile` | `label: Customer` → `Contact`; sublabels `{lead: Lead, prospect: Prospect, customer: Customer}`; `Buyer` dropped |
| `upper_ontology.Party` | `Customer` → `Contact` |
| `collections` | 11 entries `owner: {label: Customer}` → `Contact` |
| relationship targets | 20 edges `{label: Customer}` → `Contact` |

## I3. Lifecycle

```cypher
// 1 — how many carry more than one stage
MATCH (c:Contact)
WITH c, size([l IN labels(c) WHERE l IN ['Lead','Prospect','Customer']]) AS stages
RETURN stages, count(c) ORDER BY stages DESC;

// 2 — collapse to the highest stage reached, batched
MATCH (c:Contact)
WHERE size([l IN labels(c) WHERE l IN ['Lead','Prospect','Customer']]) > 1
WITH c LIMIT 10000
WITH c, CASE WHEN c:Customer THEN 3 WHEN c:Prospect THEN 2 ELSE 1 END AS keep
REMOVE c:Lead, c:Prospect, c:Customer
FOREACH (_ IN CASE WHEN keep = 1 THEN [1] ELSE [] END | SET c:Lead)
FOREACH (_ IN CASE WHEN keep = 2 THEN [1] ELSE [] END | SET c:Prospect)
FOREACH (_ IN CASE WHEN keep = 3 THEN [1] ELSE [] END | SET c:Customer)
SET c._lifecycle_rank = keep,
    c._lifecycle_stage = CASE keep WHEN 1 THEN 'lead' WHEN 2 THEN 'prospect' ELSE 'customer' END
RETURN count(*);    // repeat until 0

// 3 — backfill rank on the already-correct ones
MATCH (c:Contact) WHERE c._lifecycle_rank IS NULL AND (c:Lead OR c:Prospect OR c:Customer)
SET c._lifecycle_rank  = CASE WHEN c:Customer THEN 3 WHEN c:Prospect THEN 2 ELSE 1 END,
    c._lifecycle_stage = CASE WHEN c:Customer THEN 'customer' WHEN c:Prospect THEN 'prospect' ELSE 'lead' END
RETURN count(*);

// 4 — the correct numbers
MATCH (c:Contact) WHERE c._owner = 'cdp.customer_profile'
RETURN count(c) AS contacts,
       count(CASE WHEN c:Lead     THEN 1 END) AS leads,
       count(CASE WHEN c:Prospect THEN 1 END) AS prospects,
       count(CASE WHEN c:Customer THEN 1 END) AS customers,
       count(CASE WHEN c._lifecycle_rank IS NULL THEN 1 END) AS unclassified;
```

`contacts` must equal `leads + prospects + customers + unclassified`. If not,
step 2 has not finished.

## I4. Other stale label groups

Same collapse for every group in `exclusive_label_groups`:

```cypher
MATCH (n:SupportCase) WHERE n:BreachedCase AND n:ResolvedCase
WITH n LIMIT 10000
REMOVE n:BreachedCase, n:ResolvedCase
FOREACH (_ IN CASE WHEN n.status = 'Overdue'  THEN [1] ELSE [] END | SET n:BreachedCase)
FOREACH (_ IN CASE WHEN n.status = 'Resolved' THEN [1] ELSE [] END | SET n:ResolvedCase)
RETURN count(*);
```

Audit every group first:

```cypher
UNWIND [['SupportCase',['BreachedCase','ResolvedCase']],
        ['Opportunity',['WonOpportunity','LostOpportunity']],
        ['Campaign',['LiveCampaign','ScheduledCampaign']],
        ['EngagementActivity',['EmailActivity','TaskActivity','MeetingActivity']],
        ['CaseNote',['PublicReply','PrivateNote']],
        ['ApprovedTemplate',['PendingApproval','RejectedTemplate']],
        ['ChannelAccount',['EmailChannel','ChatChannel','SocialChannel','VoiceChannel']],
        ['WebVisitor',['AnonymousVisitor','IdentifiedVisitor']]] AS spec
CALL { WITH spec
  MATCH (n) WHERE spec[0] IN labels(n)
  WITH n, size([l IN labels(n) WHERE l IN spec[1]]) AS held
  WHERE held > 1 RETURN count(n) AS bad }
RETURN spec[0] AS label, bad ORDER BY bad DESC;
```

## I5. Orphans left by past deletes

```cypher
// collections whose owner is gone
MATCH (coll) WHERE any(l IN labels(coll) WHERE l IN
  ['BehaviourLog','VisitLog','TouchpointLog','ConversationLog','JourneyLog',
   'MetricSeries','EngagementTimeline','OutreachLog','KnowledgeStore','InsightSet',
   'RecommendationSet','RoutingHistory','WorkloadInbox','CaseAuditLog',
   'SupportSignalLog','DraftAudienceSet','ContentBatch'])
  AND NOT ()-[:HAS_BEHAVIOUR_LOG|HAS_VISIT_LOG|HAS_TOUCHPOINT_LOG|HAS_CONVERSATION_LOG|
              HAS_JOURNEY_LOG|HAS_METRIC_SERIES|HAS_ENGAGEMENT_TIMELINE|HAS_OUTREACH_LOG|
              HAS_KNOWLEDGE_STORE|HAS_INSIGHT_SET|HAS_RECOMMENDATION_SET|
              HAS_ROUTING_HISTORY|HAS_WORKLOAD|HAS_AUDIT_LOG|HAS_SIGNAL_LOG|
              HAS_DRAFT_AUDIENCE|HAS_CONTENT_BATCH]->(coll)
RETURN head(labels(coll)) AS orphan_collection, count(*) ORDER BY 2 DESC;

// empty period buckets
MATCH (p:LogPeriod) WHERE NOT (p)-[:CONTAINS]->()
WITH p LIMIT 10000 DETACH DELETE p RETURN count(*);
```

---

# PART J — ACCEPTANCE CRITERIA

**A — node existence**
1. No table MERGEs a label it does not own, except the four in `create_target_allowed`.
2. A campaign audience row for an unknown `contact_id` creates no `Contact`, and the row still loads with `contact_id` preserved.
3. The deferred edge forms within one reconcile cycle of the CDP row arriving, and the marker label is removed.
4. `count(:Contact)` equals the row count of `cdp.customer_profile` for that tenant.
5. `:PendingLink` and `:Pending*Ref` never appear in a business query result.
6. Zero `Contact` nodes with `_owner IS NULL`.

**B — label correctness**
7. No node carries two members of any exclusive group.
8. A null or unknown discriminator produces no label.
9. `lead -> customer` removes `:Lead` in the same write.
10. `customer -> lead` keeps `:Customer` and sets `_lifecycle_downgrade_attempted_at`.
11. `auto_renew` flipping to false removes `:RenewingContract`.
12. `contacts = leads + prospects + customers + unclassified`.

**C — value correctness**
13. Every reference has a measured match rate; none below its floor.
14. V1–V4 resolved before their tables move off `skip`.
15. No `coerce_*` is implicit — every type mismatch is declared.

**D — deletion**
16. Deleting a parent tombstones every composed child; nothing referenced is touched.
17. A DELETE followed by a stale UPDATE does not resurrect the node.
18. Erasure removes the subtree, clears the pending set and nulls retained keys.
19. Zero orphaned collections; zero empty `LogPeriod` nodes.

**E — ordering**
20. A stale event does not overwrite a newer value.
21. Replaying any batch yields a byte-identical graph.
22. No counter is incremented; all are recomputed.

**F — polymorphic**
23. No edge is emitted from a polymorphic column without a discriminator.
24. Every `when:` column is a real column or a declared derivation.

---

# PART K — CI RULES

```yaml
- {id: R17, rule: "no table MERGEs a label absent from its node_ownership entry, unless in create_target_allowed"}
- {id: R18, rule: "exactly one owner per label; merged labels declare merged: true"}
- {id: R19, rule: "every edge targeting a non-owned label has an edge_policy entry"}
- {id: R20, rule: "no unresolved verify: on any table whose on_missing is defer"}
- {id: R21, rule: "every sublabels: and mutable extra_labels: entry appears in exclusive_label_groups or removable_flags"}
- {id: R22, rule: "a lifecycle sublabel is never also a base label on another table"}
- {id: R23, rule: "lifecycle and exclusive-group writes REMOVE the whole group before SET"}
- {id: R24, rule: "no lifecycle or group declares a default label for null or unknown"}
- {id: R25, rule: "every removable flag declares both its SET and its REMOVE condition"}
- {id: R26, rule: "cascade_edges contains only composition verbs (HAS_*, CONTAINS)"}
- {id: R27, rule: "every table with a version column declares it in write_semantics.version_column"}
- {id: R28, rule: "no generated Cypher contains an increment on a count property"}
- {id: R29, rule: "every polymorphic column has a discriminator or emits no edge"}
- {id: R30, rule: "every when: column is a real column or a declared derivation"}
- {id: R31, rule: "every reference declares an expected match-rate floor"}
```

---

# PART L — ORDER OF WORK

| # | Step | Effect |
|---|---|---|
| 1 | Constraints and indexes (M1) | safe, immediate |
| 2 | Repair I1 steps 1–2 on one tenant, read-only | measure before changing |
| 3 | `resolve_target()` with `default_on_missing: skip` | **stops new phantoms today** |
| 4 | Exclusive-group clear-then-set (H2) | **stops new double labels today** |
| 5 | Version guard (H2) | stops stale overwrites |
| 6 | Reference probe (C3) on all references | tells races apart from id-space bugs |
| 7 | Resolve V1–V4 | unblocks four tables |
| 8 | Defer + reconcile (H4–H6), switch to `defer` | preserves campaign detail |
| 9 | Repair I1 → I2 → I3 → I4 → I5, in that order | recovery |
| 10 | Deletion cascade and tombstones (D) | stops new orphans |
| 11 | Polymorphic discriminators (F) | recovers missing edges |
| 12 | CI rules (K) | stops regression |

Steps 3, 4 and 5 are small and stop three bleeding wounds. Everything after is
recovery and hardening, and can proceed at its own pace.

---

# PART M — NEO4J SETUP

```cypher
CREATE CONSTRAINT contact_key IF NOT EXISTS
FOR (c:Contact) REQUIRE c.cdp_id IS UNIQUE;

CREATE INDEX contact_owner        IF NOT EXISTS FOR (c:Contact) ON (c._owner);
CREATE INDEX contact_lifecycle    IF NOT EXISTS FOR (c:Contact) ON (c._lifecycle_rank);
CREATE INDEX pending_contact_key  IF NOT EXISTS FOR (n:PendingContactRef) ON (n._pending_contact_key);
CREATE INDEX pending_employee_key IF NOT EXISTS FOR (n:PendingEmployeeRef) ON (n._pending_employee_key);
CREATE INDEX pending_case_key     IF NOT EXISTS FOR (n:PendingSupportCaseRef) ON (n._pending_supportcase_key);
CREATE INDEX pending_link_lookup  IF NOT EXISTS FOR (p:PendingLink) ON (p.edge_type, p.from_value);
CREATE INDEX pending_link_age     IF NOT EXISTS FOR (p:PendingLink) ON (p.first_seen_at);
CREATE INDEX tombstone_sweep      IF NOT EXISTS FOR (n:SupportCase) ON (n._deleted_at);

// already required by core.yaml indexes_required:
CREATE INDEX sla_lookup           IF NOT EXISTS FOR (s:ServiceLevelPolicy) ON (s.organization_id, s.priority);
CREATE INDEX suppression_lookup   IF NOT EXISTS FOR (s:SuppressedAddress) ON (s.uid);

// Enterprise only. With this in place a foreign-key MERGE that would mint a
// phantom FAILS LOUDLY at write time instead of succeeding quietly.
CREATE CONSTRAINT contact_owned IF NOT EXISTS
FOR (c:Contact) REQUIRE c._owner IS NOT NULL;
```