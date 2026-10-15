# Ontology Slice Service — Build Plan

2026-09-20 · @AI

## 1. What this system guarantees

"The agent gets exactly what its purpose needs" is two separate claims. One is provable at build time; the other is measurable but not provable. Conflating them is how these systems fail silently, so this plan keeps them apart and attacks each differently.

### 1.1 Structural closure — provable, enforced in CI

Every slice the service emits satisfies all of the following. These are assertions in the build pipeline; a slice that violates any of them is never served.

| # | Invariant | Meaning |
| --- | --- | --- |
| C1 | Relation closure | Every relation in the slice has both endpoints present at **at least stub level**. No edge points into the void. |
| C2 | Attribute–taxonomy closure | Every attribute of a full-detail entity that has a taxonomy in the source has that taxonomy in the slice. No enum is silently dropped. |
| C3 | Rule closure | Every rule in the slice has all its tagged entities present at **full** detail. No rule refers to something the agent cannot see. |
| C4 | Synonym completeness | If an entity is present at full detail, all of its synonyms are present. Partial synonym lists cause misrecognition. |
| C5 | Identifier presence | Every entity at any level carries its identifier. The agent must always be able to name the underlying table or key. |
| C6 | Global rule floor | Every slice contains every rule marked `scope: global`, regardless of seeds or budget. |
| C7 | Namespace integrity | Every entity reference is fully qualified (`ticketing.Ticket`, not `Ticket`). No ambiguous bare names survive compilation. |

C1 through C7 mean a slice is never *internally* broken. Whatever the agent was given, it can reason over it without hitting a dangling reference, an unexplained enum, or a rule about an invisible entity.

### 1.2 Purpose recall — measured, gated by an eval harness

Structural closure says nothing about whether the *right* entities were seeded in the first place. That is a retrieval problem, and retrieval is heuristic. No architecture makes it provable. What makes it trustworthy is measurement.

**Definition.** For an agent A with purpose P, let `Needed(A)` be the set of entities required at full detail to correctly answer every task in A's golden set. Recall is `|Needed(A) ∩ SliceFull(A)| / |Needed(A)|`.

**Gate.** No agent goes to production until recall = 1.0 across its golden set. A miss is never patched with a per-agent override — that would reintroduce the mapping table this whole design exists to avoid. A miss is fixed in one of three places:

1. A **missing synonym** in the ontology — the most common cause, because the agent's vocabulary does not match yours.
2. An **untagged or mistagged business rule**.
3. An **under-specified purpose string** on the agent side. This is the one failure mode that needs a conversation with the agent team.

All three fixes are ontology-level and benefit every agent, not just the one that failed. This is the property that keeps the system from degenerating into hand maintenance.

### 1.3 The third guarantee — bounded, visible ignorance

Recall will not stay at 1.0 forever. The ontology grows, agents get repurposed, someone writes a purpose string in a hurry. The system's third guarantee is that when a slice is incomplete, **the agent knows it**.

Every response carries a coverage block naming what the agent holds at full detail, what it holds as stubs, and which products it does not have at all. An agent with a ticketing-only slice that is asked a campaign question can see that campaign is index-only and hand off rather than invent. This converts the dangerous failure mode — a confident wrong answer — into the safe one, an explicit handoff, and it costs nothing at runtime.

### 1.4 Explicitly out of scope

- **No per-agent mapping table.** Nowhere in this system is there a file saying "agent X gets entities Y and Z". Every slice is derived.
- **No mid-session ontology calls** in the default path. The agent hydrates once. Section 5 describes an optional, metered escape hatch that should fire in under 2% of sessions; if it fires more often, the seeds are wrong and that is a bug to fix upstream.
- **No agent-side logic.** The agent's entire integration is one HTTP call or one tool definition. It does not know what a seed, a stub, or a detail level is.

## 2. Source layout and authoring changes

You keep authoring YAML by hand. Nothing in this section asks you to maintain a graph, an index, or anything about agents. It asks you to say a few things about the ontology that are currently implicit.

### 2.1 File layout

```
ontology/
  meta.yaml                 # product registry: name, one-line purpose, owner
  core.yaml                 # entities shared by every product
  products/
    ticketing.yaml
    crm.yaml
    ccaas.yaml
    cdp.yaml
    campaign.yaml
    webtracking.yaml
  bridges.yaml              # cross-product relations only
  rules/
    global.yaml             # rules that ship with every slice
```

One flat file works until two products disagree about what `Customer` means. Splitting by ownership makes that impossible: a concept is defined exactly once, in the file that owns it, and every other file references it.

### 2.2 Namespacing

Every entity compiles to `<namespace>.<EntityName>`. `core.yaml` yields the `core.*` namespace, each product file yields its own. Inside a file you still write bare names — the compiler qualifies them. A bare name that resolves to neither a local entity nor a `core.*` entity is a **compile error**, not a warning. This is what kills the whole class of bugs where `Customer` silently means two different things in two products.

### 2.3 What moves to core

From your ticketing file, these are not ticketing concepts — they are company concepts that ticketing happens to use: `Tenant`, `Customer`, `CustomerIdentity`, `Company`, `Staff`, `Product`. They move to `core.yaml`.

That creates one problem worth solving properly. `Company` today carries `identifier: ticketing.ticketing_accounts.id`. Once `Company` is shared, CRM will have its own table for the same concept. So **identifier becomes a per-product map**:

```yaml
# core.yaml
Company:
  definition: A customer's company whose contacts can raise support tickets or hold deals.
  identifier:
    cdp: cdp.accounts.id
    ticketing: ticketing.ticketing_accounts.id
    crm: crm.accounts.id
  main_attributes: [name, status]
  synonyms: [account, customer_account, client_account, business_account]
```

A slice emits only the identifier rows for products that are in scope for that agent. A ticketing-only agent sees `ticketing.ticketing_accounts.id` and nothing else, so it cannot accidentally reason about a CRM table it has no access to. This one change is what makes shared entities safe across six products.

### 2.4 The one required format change: tag your rules

Today `business_rules` is a list of strings. Nothing can determine which rules belong with which entities, so nothing can distribute them. Rules become objects:

```yaml
business_rules:
  - id: TKT-BR-001
    text: >
      Ticket is the only thing counted as a ticket. Notes, emails,
      events and notifications are not tickets.
    entities: [Ticket, Note, Email, AuditEvent, Notification]
    scope: entity
    severity: hard

  - id: TKT-BR-006
    text: >
      assigned_to is the L1 owner of the ticket. has_resolver is the L2
      specialist. They are different jobs.
    entities: [Ticket, Staff]
    scope: entity
    severity: hard

  - id: GBL-BR-001
    text: All dates and times are given in the tenant timezone.
    entities: []
    scope: global
    severity: hard
```

| Field | Purpose |
| --- | --- |
| `id` | Stable handle. Lets you trace which rules landed in which slice, and lets an eval failure point at a specific rule. |
| `text` | The rule, verbatim as you write it today. |
| `entities` | The entities this rule constrains. Drives distribution. |
| `scope` | `entity` (ships when all tagged entities are present at full detail) or `global` (ships in every slice, always). |
| `severity` | `hard` or `soft`. Purely a rendering hint — hard rules render first in the slice so they sit early in the agent's context. |

This is still ontology authoring, not agent mapping. You are describing what a rule is about. Who receives it is derived.

**Drafting the tags.** Do not do 100+ rules by hand from scratch. Run a two-pass bootstrap: first a mechanical pass matching entity names and synonyms against each rule's text (case-insensitive, singular and plural, snake and camel), then an LLM pass over the rules the mechanical pass left thin, to catch implicit references. Your rule "A target is breached only after its deadline passes unmet" names no entity at all — it means `SLA` and `Ticket`, and only the second pass will see that. Then review. Budget half a day per product.

### 2.5 Synonym discipline

Your synonyms are the highest-precision seeding signal in the system, so they need one rule: **a surface form may map to several entities, but the collision must be visible.**

`account` is already a synonym for `Company` in ticketing. CRM will almost certainly want `account` too, for something else. The compiler builds `surface_form → [qualified entity ids]` and emits a **collision report** at build time. Collisions are not errors. The resolver disambiguates by the requesting agent's product scope, and where it still cannot, it seeds *both* — recall beats precision at the seeding stage, and the closure pass will not be harmed by one extra entity. But the report goes in front of a human every build, because most collisions are modelling mistakes you want to know about.

### 2.6 Optional accelerators

Two optional fields. Neither is required; both improve precision if you have them.

```yaml
Ticket:
  definition: A customer issue or service request tracked from creation to resolution.
  module: ticket_lifecycle        # optional grouping hint
  hub_tier: primary               # optional: primary | secondary | detail
  ...
```

`module` groups entities that always travel together, so seeding on one pulls the group. `hub_tier` marks which entities represent a product well enough to appear in the hub's index (Section 7). If you omit `hub_tier`, the compiler infers it from relation degree — the most-connected entities are the product's primary concepts, which is right often enough to start with.

### 2.7 The rule that protects all of this

Compiled artifacts are never edited by hand and never committed as source of truth. The YAML in `ontology/` is the only thing a human writes. Everything else — the graph, the indexes, the slices — is generated, and anything generated can be thrown away and rebuilt from the YAML in a single command. If that ever stops being true, the system has started drifting toward manual maintenance.

## 3. The compiler and the indexes

The compiler turns `ontology/*.yaml` into one immutable, content-addressed **snapshot**. It runs on every commit to the ontology repo and on nothing else. It is a pure function: same YAML in, byte-identical snapshot out.

### 3.1 Pipeline stages

| Stage | What happens | Fails the build if |
| --- | --- | --- |
| 1. Parse | `ruamel.yaml` round-trip load, preserving key order so emitted slices read like your source | YAML is malformed |
| 2. Qualify | Every bare entity name resolved against local namespace, then `core.*` | A name resolves to nothing, or to two things |
| 3. Merge | core + six product files + bridges folded into one node and edge set | Duplicate qid defined in two files |
| 4. Validate | The full validator suite in Section 12 | Any invariant broken |
| 5. Derive | Relation degree per entity, `hub_tier` inference where absent, product affinity matrix from bridge counts | — |
| 6. Embed | One vector per entity, one per relation predicate | Embedding service unreachable |
| 7. Index | Build the four indexes below | — |
| 8. Freeze | Write snapshot dir, compute manifest hashes, assign `snapshot_id` | — |

Target: a full cold compile of roughly 500 entities across six products finishes in under 30 seconds, dominated by embedding. With a local embedding model it is under 10.

### 3.2 The canonical graph

Three node kinds and one edge kind. Attributes and taxonomies are properties of entities, not separate nodes — making them nodes triples the graph size and buys nothing, because nothing ever traverses to an attribute.

```python
@dataclass(frozen=True)
class EntityNode:
    qid: str                      # "ticketing.Ticket"
    product: str                  # "ticketing" | "core"
    name: str                     # "Ticket"
    definition: str
    identifier: dict[str, str]    # product -> column, or {"_": column}
    attributes: list[Attribute]   # name + optional taxonomy values
    synonyms: list[str]
    module: str | None
    hub_tier: str                 # primary | secondary | detail
    degree: int                   # derived
    embedding: np.ndarray

@dataclass(frozen=True)
class RelationEdge:
    src: str                      # qid
    dst: str                      # qid
    predicate: str                # "has_note"
    cross_product: bool           # derived: src.product != dst.product
    embedding: np.ndarray         # of "<Src> <predicate> <Dst>"

@dataclass(frozen=True)
class RuleNode:
    id: str                       # "TKT-BR-006"
    text: str
    entities: list[str]           # qids
    scope: str                    # entity | global
    severity: str                 # hard | soft
```

### 3.3 The four indexes

**1. Adjacency index.** The graph in CSR form, held in process memory. At a few thousand entities this is well under a megabyte, and a bounded breadth-first traversal over it costs microseconds. Do not put this in a graph database — a network round trip per hop would cost more than the entire rest of the slice build.

**2. Lexical index.** `surface_form → [qid]`, normalised to lowercase with underscores and hyphens collapsed to spaces, plus singular and plural forms. It indexes more than entity names:

| Source | Example key | Seeds |
| --- | --- | --- |
| Entity name | `ticket` | `ticketing.Ticket` |
| Synonym | `service request` | `ticketing.Ticket` |
| Relation predicate | `assigned to`, `assigned` | both endpoints |
| Attribute name | `first response at` | owning entity |
| Taxonomy value | `overdue`, `at risk` | owning entity |

Indexing predicates and taxonomy values matters more than it looks. Agent purposes are written in verbs and states — "escalates overdue tickets", "reassigns" — and none of those words is an entity name. Without predicate and taxonomy keys, the lexical channel would miss the strongest signals in a typical purpose string.

**3. Vector index.** HNSW over one embedding per entity. The embedded text is a template, not just the definition:

```
ticketing / Ticket
A customer issue or service request tracked from creation to resolution.
also called: case, issue, support request, complaint, service request
attributes: number, subject, status, priority, channel, category, due at,
  first response at, resolved at, csat score
relates to: raised by Customer, routed to Queue, assigned to Staff,
  governed by SLA, has note Note, has email Email
```

Including synonyms and relation predicates in the embedded text roughly doubles semantic recall against real purpose strings, because it puts the agent's likely vocabulary into the vector rather than relying on the definition's formal phrasing. Predicates are separately indexed too, so a purpose mentioning "escalation" can land on an edge and seed both of its endpoints.

**4. Rule index.** Two maps: `qid → [rule_id]` and `rule_id → RuleNode`, plus the flat list of `scope: global` rules. Rule distribution during slice building is then a set intersection, not a scan.

### 3.4 The snapshot artifact

```
snapshots/
  v1847/
    graph.bin          # serialised nodes + edges
    lexical.json       # surface form -> qids
    vectors.hnsw       # HNSW index
    vectors.meta.json  # row -> qid
    rules.json
    affinity.json      # product x product bridge counts
    manifest.json      # per-file sha256, source git sha, build timestamp
```

`snapshot_id` is a monotonic integer paired with the manifest hash. Snapshots are **immutable and never mutated in place**. A rebuild always writes a new directory. This is what lets a running session pin `v1847` and be genuinely unaffected by anything that happens afterwards, and it makes rollback a pointer flip rather than a restore.

The service keeps the current snapshot and the previous one hot in memory, and the previous three on disk. Sessions holding an older snapshot id continue to be served correctly until their TTL expires.

## 4. Request contract — what the agent sends

One endpoint, called once per session, before the agent does any work.

```
POST /v1/ontology/hydrate
Authorization: Bearer <service token>
Content-Type: application/json
```

### 4.1 Full payload

```json
{
  "agent": {
    "id": "ticketing.sla_escalation",
    "version": "3.1.0",
    "purpose": "Monitors SLA breaches across support queues, escalates overdue tickets to L2 resolvers, and reassigns ownership when the assigned agent is unavailable.",
    "home_product": "ticketing",
    "tools": [
      "get_ticket", "list_queue_tickets", "get_sla_policy",
      "escalate_ticket", "reassign_ticket", "notify_staff"
    ],
    "tool_schemas": [
      {"name": "reassign_ticket", "params": ["ticket_id", "to_agent_id", "reason"]}
    ],
    "modules": ["sla_management", "assignment"]
  },
  "request": {
    "scope_class": "auto",
    "budget_tokens": 6000,
    "format": "yaml",
    "known_snapshot_id": "v1846",
    "known_content_hash": "sha256:9f3c..."
  }
}
```

### 4.2 Field reference

| Field | Req | Effect on the slice | If absent |
| --- | --- | --- | --- |
| `agent.id` | **yes** | Cache key component; registry key; identifies the agent in the warming sweep | 400 |
| `agent.version` | no | Forces a fresh slice when the agent's prompt changes | Treated as `"0"`; slice keyed on purpose hash alone |
| `agent.purpose` | **yes** (Tier A) | Primary seeding signal, feeds both lexical and vector channels | 400 unless `agent.id` is already in the registry, in which case the stored purpose is used |
| `agent.home_product` | no | Sets the product floor and biases disambiguation of colliding synonyms | Inferred from the purpose and tools; inference is right roughly 90% of the time, so send it |
| `agent.tools` | no | Highest-precision seeding channel (see 4.4) | Falls back to purpose text only; expect a measurable recall drop |
| `agent.tool_schemas` | no | Parameter names seed identifiers directly — `to_agent_id` lands on `core.Staff` with no ambiguity | Tool names alone are still strong |
| `agent.modules` | no | Pulls whole `module:` groups from the ontology as seeds | Modules inferred from seeds |
| `request.scope_class` | no | `auto` \| `scoped` \| `cross_product` \| `hub`. An override, not a requirement | `auto` — the server classifies (Section 7) |
| `request.budget_tokens` | no | Caps rendered slice size; drives the demotion ladder | Defaults to 8000 |
| `request.format` | no | `yaml` \| `json` \| `markdown` | `yaml`, matching your source shape |
| `request.known_snapshot_id` | no | Enables the unchanged short-circuit | Full slice always returned |
| `request.known_content_hash` | no | Returns `{"unchanged": true}` when the agent already holds the current slice | Full slice always returned |

### 4.3 Three tiers of integration

The agent team can adopt any of these; the service works at all three.

| Tier | Payload | Typical recall on a golden set | When to use |
| --- | --- | --- | --- |
| **A — minimum** | `id` + `purpose` | 0.85–0.93 | Agent team can only pass a string. Viable, but expect to iterate on synonyms. |
| **B — recommended** | + `home_product` + `tools` | 0.97–1.00 | The default target. Both fields already exist in every agent definition. |
| **C — maximum** | + `tool_schemas` + `modules` + `budget_tokens` | 1.00 | Hub agents and anything cross-product, where precision matters most. |

Tier A is the honest floor. Do not design for it if you can get Tier B — the difference between a prose purpose and a prose purpose plus six tool names is the difference between guessing and knowing.

### 4.4 Why tool names beat prose

A purpose string is written once, in a hurry, in prose, by someone describing intent. A tool list is a closed, curated vocabulary written by the same engineers who named the database columns your ontology points at. Concretely:

- **Verb-plus-noun shape.** `escalate_ticket` splits cleanly into a predicate candidate and an entity candidate. The lexical index resolves `ticket` → `ticketing.Ticket` at precision 1.0.
- **Exhaustive, not illustrative.** A purpose mentions the interesting parts of the job. A tool list enumerates *everything* the agent can do. `notify_staff` reveals that this agent touches `Notification`, which the purpose string above never mentions — and without it the agent would have no idea that `notification.type` includes an `sla` value.
- **No hedging.** Prose contains words like "manage", "handle", "support" that seed nothing useful and add vector noise.
- **Parameter names are identifiers.** `to_agent_id` maps to `ticketing.agents.id`, which is `core.Staff`'s identifier under the ticketing product. That is an exact match against a compiled field, not a similarity score.

In the SLA example above, tools alone yield `Ticket, Queue, SLA, Staff, Notification` — the complete correct seed set. The purpose string alone misses `Notification`.

### 4.5 Registration is a side effect, not a step

The first call carrying an unrecognised `agent.id` registers that agent. The server stores the descriptor — purpose, tools, home product, first-seen timestamp — and from then on that agent appears in two places that matter: the warming sweep (Section 10), so its slice is precomputed on every snapshot and it never pays the cold path again, and the new-node sweep (Section 11), so it can be given entities that did not exist when it first registered.

There is no separate onboarding call, no registration UI, and no file you edit. An agent exists in the system because it showed up.

### 4.6 What the agent must not be trusted with

`home_product` and `scope_class` are hints and are safe to accept from the payload. **Product access is not.** The set of products an agent is allowed to see comes from claims on its auth token and nowhere else. The final slice is intersected with that set:

```python
allowed = token.claims["allowed_products"]      # authoritative
requested = payload.get("home_product")          # hint only
scope = resolve_scope(...) & allowed
```

Without this, any agent could request `scope_class: "hub"` and receive the schema of every product in the company. The intersection is applied **before** slice building, not after rendering, so an out-of-scope entity never enters the working set and cannot leak through a relation stub.

### 4.7 MCP tool wrapper

For agent frameworks that prefer a tool over an HTTP call, the same endpoint is exposed as a single MCP tool. The agent's integration is then one tool definition:

```json
{
  "name": "load_ontology",
  "description": "Load the ontology slice for this agent. Call once at session start, before any other work.",
  "input_schema": {
    "type": "object",
    "properties": {
      "purpose": {"type": "string", "description": "What this agent does, in one or two sentences."}
    },
    "required": ["purpose"]
  }
}
```

`agent.id`, `version`, `tools` and `home_product` are filled server-side from the MCP session identity and the connected tool manifest, so the agent author writes nothing beyond the purpose string.

## 5. Response contract — what we return

### 5.1 Envelope

```json
{
  "slice_id": "sl_7f21c9",
  "snapshot_id": "v1847",
  "content_hash": "sha256:4a19be...",
  "format": "yaml",
  "ontology": "<the rendered slice, see 5.3>",
  "coverage": {
    "scope_class": "scoped",
    "products": {
      "core": "full", "ticketing": "full",
      "crm": "index", "ccaas": "index", "cdp": "index",
      "campaign": "none", "webtracking": "none"
    },
    "entities_full": [
      "ticketing.Ticket", "ticketing.SLA", "ticketing.Queue",
      "core.Staff", "ticketing.Notification"
    ],
    "entities_stub": [
      "core.Customer", "core.Company", "core.Product",
      "ticketing.Note", "ticketing.Email", "ticketing.AuditEvent",
      "ticketing.AutomationRule", "ticketing.Macro"
    ],
    "rules_included": ["GBL-BR-001", "TKT-BR-005", "TKT-BR-006", "TKT-BR-007", "TKT-BR-008"],
    "demoted": [],
    "handoff": {
      "crm": "deal, pipeline, opportunity questions",
      "ccaas": "call, IVR, agent-availability questions",
      "campaign": "not available in this slice"
    }
  },
  "cache": { "ttl_seconds": 3600, "etag": "W/\"sl_7f21c9-v1847\"" },
  "stats": {
    "entities_full": 5, "entities_stub": 8, "relations": 19,
    "rules": 5, "est_tokens": 2180, "build_ms": 11, "cache": "hit"
  }
}
```

### 5.2 The coverage block appears twice, deliberately

Structured `coverage` is for your infrastructure — telemetry, dashboards, the eval harness. **The model never reads JSON metadata that sits outside its prompt.** So the same information is also rendered as prose at the end of the slice itself:

```yaml
  scope_note: >
    This slice covers the ticketing product and shared company concepts in
    full. Customer, Company, Note, Email, AuditEvent, Macro and
    AutomationRule are included by name and definition only — you can
    reference them but you do not have their attributes or their rules.
    You have no coverage of campaign or web tracking. For questions about
    deals or pipelines, hand off to the CRM agent. For questions about
    calls or agent availability, hand off to the CCaaS agent.
```

This single paragraph is what turns a recall miss from a confident wrong answer into a handoff. It is the cheapest correctness mechanism in the whole system and it should never be omitted to save tokens.

### 5.3 The rendered slice

Same shape as your source file, so no prompt template changes and the agent's existing reading habits carry over. Abridged for the SLA escalation agent:

```yaml
ontology:
  name: slice.ticketing.sla_escalation
  snapshot: v1847
  purpose: >
    Monitors SLA breaches across support queues, escalates overdue tickets
    to L2 resolvers, and reassigns ownership when the assigned agent is
    unavailable.

  entities:
    Ticket:                                   # full
      definition: A customer issue or service request tracked from creation to resolution.
      identifier: ticketing.tickets.id
      main_attributes: [number, subject, description, status, priority,
                        channel, category, skill, due_at, first_response_at,
                        resolved_at, csat_score, created_at]
      synonyms: [case, issue, support_request, complaint, service_request]

    SLA:                                      # full
      definition: The expected first-response and resolution time for a ticket priority.
      identifier: ticketing.sla_policies.id
      main_attributes: [priority, first_response_hours, resolution_hours, active]
      synonyms: [service_level_agreement, service_level_policy]

    Queue:                                    # full
      definition: A support team or routing group based on skills and responsible for a set of tickets.
      identifier: ticketing.agent_queues.id
      main_attributes: [name, description, type, open_tickets, assigned_tickets, sla_status]
      synonyms: [support_queue, support_team, team]

    Staff:                                    # full
      definition: A person who works in the ticketing system as an admin, agent, resolver, or viewer.
      identifier: ticketing.agents.id
      main_attributes: [name, role, status, skills, email, phone, timezone]
      synonyms: [staff_member, support_staff, employee]

    Notification:                             # full
      definition: An in-app message that informs staff about ticketing activity.
      identifier: ticketing.notifications.id
      main_attributes: [type, title, message, read, created_at]

    Customer:                                 # stub
      definition: A person who raises or receives support for a ticket.
      identifier: cdp.customer_profile.cdp_id

    Note:                                     # stub
      definition: A public reply or internal comment added to a ticket by staff.
      identifier: ticketing.ticket_notes.id

    # ... Company, Product, Email, AuditEvent, Macro, AutomationRule as stubs

  relations:
    - Ticket - raised_by -> Customer
    - Ticket - routed_to -> Queue
    - Ticket - assigned_to -> Staff
    - Ticket - has_resolver -> Staff
    - Ticket - governed_by -> SLA
    - Ticket - has_note -> Note
    - Ticket - has_event -> AuditEvent
    - Queue - has_member -> Staff
    - Notification - sent_to -> Staff
    - Notification - about -> Ticket

  taxonomy:
    ticket.status: [open, pending, reopened, resolved, overdue, custom]
    ticket.priority: [urgent, high, medium, low]
    ticket.channel: [email, chat, phone, web]
    ticket.category: [billing, troubleshooting, accounts, general, database, testing, custom]
    queue.type: [private, shared]
    queue.sla_status: [on_track, at_risk]
    staff.role: [admin, agent, resolver, viewer]
    staff.status: [active, inactive]
    notification.type: [assignment, update, sla, security, product]

  business_rules:
    - All dates and times are given in the tenant timezone.
    - Status says where a ticket stands. Priority says how urgent it is. Neither decides the other.
    - First response and resolution are measured separately. A target is breached only after its deadline passes unmet.
    - Queue is where a ticket currently sits. Being in a queue does not mean a person owns its tickets.
    - assigned_to is the L1 owner of the ticket. has_resolver is the L2 specialist. They are different jobs.

  scope_note: >
    ...
```

Note what is **absent** and why it is correct: `note.visibility` taxonomy is gone because `Note` is a stub; the internal-notes rule is gone because it is tagged `[Note, Staff, Customer]` and two of those are stubs; `Macro`, `KnowledgeArticle` and the assistant-session entities are gone because nothing in the purpose or tool list reaches them. This agent cannot write a note, so it is not carrying the rules for writing notes.

### 5.4 The unchanged short-circuit

When the request carries `known_content_hash` and it matches:

```json
{ "unchanged": true, "slice_id": "sl_7f21c9", "snapshot_id": "v1847",
  "content_hash": "sha256:4a19be...", "cache": {"ttl_seconds": 3600} }
```

The agent keeps what it already had. This matters at scale: most sessions in a busy MAS start with a slice that has not changed since the last one, and this turns a several-kilobyte response into a few hundred bytes.

### 5.5 The escape hatch — optional, off by default, metered

```
POST /v1/ontology/extend
{ "slice_id": "sl_7f21c9", "missing_terms": ["attachment", "file upload"] }
```

Returns a **delta only** — the additional entities promoted to full detail, plus any rules that now qualify — pinned to the same snapshot so the agent's world stays consistent. It is disabled per-agent by default and enabled only for agents whose task distribution is genuinely open-ended.

This exists because "never come back" is the right default and the wrong absolute. The discipline is in the metric, not the prohibition: **if an agent's extend rate exceeds 2% of sessions, that is a seeding bug**, and the fix is a synonym, a rule tag, or a better purpose string — not a permanently wider slice. Alert on it.

### 5.6 Errors and degraded modes

| Status | Condition | Behaviour |
| --- | --- | --- |
| 400 | Missing `agent.id`, or missing `purpose` for an unregistered agent | Reject. Never guess a slice. |
| 403 | Requested scope exceeds the token's `allowed_products` | Return the intersected slice with a `restricted` flag in coverage, not an error — an agent should degrade, not fail |
| 404 | `known_snapshot_id` refers to a purged snapshot | Serve the current snapshot as a full response, not a short-circuit |
| 409 | Compile in progress and no warm slice for this key | Serve from the **previous** snapshot with `"stale": true`. Never block a session start on a build. |
| 503 | Slice builder unavailable | Serve the last known good slice for this agent id, regardless of age, with `"stale": true` |

The design principle across all of these: **a hydrate call must never fail closed.** An agent that cannot get a slice is an agent that cannot start, and in a large MAS that cascades. Serving a slightly stale slice is always better than serving none.

## 6. Slice formation algorithm

### 6.1 Detail levels

Three levels for entities. Rules are not a level — they are selected separately, in 6.5.

| Level | Contains | Cost | Purpose |
| --- | --- | --- | --- |
| **L0** name | Qualified name only, listed under its product | \~4 tokens | "This exists, somewhere in the system" |
| **L1** stub | name, definition, identifier | \~25 tokens | "This exists, here is what it is and where it lives" — enough to reference it and to hand off |
| **L2** full | + attributes, taxonomy, synonyms | \~90 tokens | "You work with this" — enough to reason and act |

The level gap is the whole efficiency story. Your ticketing product at L2 across all 22 entities is roughly 2,000 tokens before rules. The same product as five L2 entities and seventeen L1 stubs is about 900. Across six products the ratio is what makes a hub slice possible at all.

### 6.2 Seeding — five channels, fused by max

```python
TAU_VECTOR = 0.42      # cosine floor for the vector channel
TAU_SEED   = 0.55      # score floor to become a seed

def seed(req, snap, scope) -> set[str]:
    s: dict[str, float] = {}
    def bump(qid, score):
        if snap[qid].product in scope:
            s[qid] = max(s.get(qid, 0.0), score)

    # 1. tool names — verb/noun split, exact lexical resolution
    for tool in req.tools:
        for qid in lex.resolve_tool(tool):          # escalate_ticket -> ticketing.Ticket
            bump(qid, 1.0)

    # 2. tool parameter names — identifier match
    for param in req.tool_params:
        for qid in lex.resolve_identifier(param):   # to_agent_id -> core.Staff
            bump(qid, 1.0)

    # 3. declared modules
    for m in req.modules:
        for qid in snap.module_members(m):
            bump(qid, 1.0)

    # 4. purpose text, lexical: names, synonyms, predicates, taxonomy values
    for term in ngrams(normalise(req.purpose), n=(1, 2, 3)):
        for qid in lex.get(term):
            bump(qid, 0.9)

    # 5. purpose + tools, vector
    v = embed(req.purpose + " " + " ".join(req.tools))
    for qid, sim in hnsw.query(v, k=25):
        if sim >= TAU_VECTOR:
            bump(qid, float(sim))

    # 6. product floor — the agent always knows its own product's spine
    for qid in snap.primary_entities(req.home_product):
        bump(qid, 0.6)

    return {q for q, sc in s.items() if sc >= TAU_SEED}
```

Three things deserve comment.

**Fusion is `max`, not `sum`.** Summing rewards entities that happen to appear in several channels for the same reason, which systematically over-seeds hub entities like `Ticket` and under-seeds specific ones like `SLA`. Max keeps each channel's precision intact.

**The product floor exists for thin purpose strings.** An agent described only as "handles escalations" would otherwise seed on almost nothing. The floor guarantees it always receives its own product's primary entities, so the worst case is a generic-but-correct slice rather than an empty one. Set `hub_tier: primary` on roughly five to eight entities per product; the compiler infers it from relation degree where you do not.

**Both thresholds are tuned on the golden set, not guessed.** The numbers above are reasonable starting points. Section 12 describes the sweep.

### 6.3 Level assignment — one bounded hop

```python
def assign_levels(seeds, snap, scope, home) -> dict[str, int]:
    level = {q: L2 for q in seeds}
    reached_by = Counter()

    for q in seeds:
        for edge in snap.edges_of(q):
            n = edge.other(q)
            if snap[n].product not in scope:
                continue                      # cross-scope edge: dropped, noted in coverage
            reached_by[n] += 1
            if n not in level:
                level[n] = L1

    # promotion: a neighbour that several seeds all point at is central to this job
    for n, count in reached_by.items():
        if level[n] == L1 and (count >= 3 or
                (snap[n].hub_tier == "primary" and snap[n].product == home)):
            level[n] = L2

    for q in snap.entities_in(scope):
        level.setdefault(q, L0)

    return level
```

One hop, not two. Two hops from a hub entity like `Ticket` reaches essentially the entire product, and the second ring adds stubs the agent will never use. The `reached_by >= 3` promotion recovers the genuinely important second-order entities without the blast radius: if three of an agent's core entities all point at the same neighbour, that neighbour is part of its job.

**Edge gating for hub entities.** `Ticket` has fourteen outgoing relations, so seeding on it produces fourteen stubs. That is acceptable at \~25 tokens each. If profiling shows it is not, gate traversal by scoring the edge's own embedding against the purpose vector and only crossing edges above a floor. Do this only if the budget forces it — unconditional one-hop is more predictable and easier to reason about when a recall failure needs debugging.

### 6.4 Closure

```python
def close(level, snap, scope):
    # C1: emit only relations whose endpoints are both >= L1.
    #     Guaranteed by construction: every 1-hop neighbour of a seed is >= L1,
    #     so no seed-incident edge can dangle. Cross-scope edges are dropped
    #     and recorded in coverage.handoff.
    relations = [e for e in snap.edges
                 if level.get(e.src, L0) >= L1 and level.get(e.dst, L0) >= L1]

    # C2 + C4 + C5: every L2 entity carries taxonomy, synonyms, identifier;
    #               every L1 carries definition + identifier.
    for qid, lv in level.items():
        if lv >= L1:
            assert snap[qid].identifier is not None
        if lv >= L2:
            assert all(a.taxonomy is not None or a.name not in snap.taxonomy_keys(qid)
                       for a in snap[qid].attributes)
    return relations
```

Closure is an assertion pass, not a fixpoint loop. Because levels are assigned from seeds outward in a single bounded hop, the invariants hold by construction and closure only verifies them. If an assertion ever fires, it means the graph or the level assignment is wrong, and the correct response is to fail the build rather than patch the slice.

### 6.5 Rule selection

```python
def select_rules(level, snap):
    full = {q for q, lv in level.items() if lv >= L2}
    out = []
    for r in snap.rules:
        if r.scope == "global":
            out.append(r)
        elif r.entities and set(r.entities) <= full:
            out.append(r)
    # global-hard, entity-hard, then soft — earliest position in context
    # goes to the rules most costly to violate
    return sorted(out, key=lambda r: (r.scope != "global", r.severity != "hard", r.id))
```

The condition is **subset, not intersection**. A rule ships only when *every* entity it constrains is present at L2. Intersection would ship the internal-notes rule to an agent that has `Staff` but only a `Note` stub — a rule about an object the agent cannot see, which is worse than no rule at all because it invites the model to reason about attributes it does not have.

### 6.6 Rendering and determinism

The renderer walks the source key order from `meta.yaml` so a slice reads like a subset of your file rather than a machine dump. Everything is sorted: entities by product then name, relations by source then predicate, rules by the sort above, taxonomy by key. Sets are never iterated directly.

This matters beyond tidiness. **The slice must be byte-deterministic** — same snapshot plus same request produces the same bytes — because the content hash is the cache key, the ETag, and the prompt-cache prefix boundary. A non-deterministic renderer silently destroys the cache hit rate and with it the entire latency argument.

### 6.7 Worked trace: the SLA escalation agent

| Stage | Result |
| --- | --- |
| Tools → lexical | `get_ticket`→Ticket · `list_queue_tickets`→Queue, Ticket · `get_sla_policy`→SLA · `escalate_ticket`→Ticket · `reassign_ticket`→Ticket · `notify_staff`→Notification, Staff |
| Params → identifiers | `ticket_id`→Ticket · `to_agent_id`→Staff (via `ticketing.agents.id`) |
| Purpose → lexical | "SLA"→SLA · "support queues"→Queue (synonym) · "overdue"→Ticket (taxonomy value of `ticket.status`) · "resolvers"→Staff (taxonomy value of `staff.role`) · "assigned"→Ticket, Staff (predicate `assigned_to`) |
| Purpose → vector | Ticket 0.81 · SLA 0.77 · Queue 0.71 · Notification 0.58 · AuditEvent 0.44 · Macro 0.31 (below floor) |
| Product floor | Ticket, Customer, Staff, Queue, Note at 0.6 |
| **Seeds (≥0.55)** | **Ticket, SLA, Queue, Staff, Notification, Customer, Note** |
| 1-hop stubs | Company, Product, Email, AuditEvent, Macro, AutomationRule, KnowledgeArticle |
| Promotions | none reach 3 distinct seeds |
| Rules qualifying | GBL-BR-001 (global) · TKT-BR-005 status/priority · TKT-BR-006 assigned\_to vs has\_resolver · TKT-BR-007 first response vs resolution · TKT-BR-008 queue ownership · TKT-BR-002 customer vs company (Customer is L2 via floor) |
| Rules excluded | internal-notes rule — `Note` is L2 here but `Customer` is too, so it *does* qualify; macro-is-a-template rule — `Macro` is only a stub |
| Size | 7 × L2 + 7 × L1 + 19 relations + 6 rules ≈ 1,150 tokens |

Note the product floor pulling `Customer` and `Note` to L2, which in turn qualifies two extra rules. That is the floor doing its job: it costs about 180 tokens and it prevents the class of error where an escalation agent confuses a customer with their company.

## 7. Scope classes: scoped, cross-product, hub

### 7.1 Automatic classification

Classification runs on the seed set **before** scope restriction, so the classifier can see that a CCaaS agent's seeds reach into ticketing even though CCaaS is its home.

```python
DELEGATION_MARKERS = {"route", "routes", "orchestrate", "delegate", "triage",
                      "dispatch", "which agent", "hand off", "supervisor"}
DELEGATION_TOOLS   = {"delegate_to", "route_to_agent", "handoff", "call_agent",
                      "list_agents", "spawn_subagent"}

def classify(req, raw_seeds, snap) -> str:
    if req.scope_class in ("scoped", "cross_product", "hub"):
        return req.scope_class                       # explicit override

    products = {snap[q].product for q in raw_seeds} - {"core"}
    delegating = (any(m in req.purpose.lower() for m in DELEGATION_MARKERS)
                  or bool(set(req.tools) & DELEGATION_TOOLS))

    if delegating and len(products) >= 4:
        return "hub"
    if len(products) >= 2:
        return "cross_product"
    return "scoped"
```

The `delegating` signal is what separates a hub from an agent that merely touches many products. A reporting agent reading five products is cross-product, not a hub: it needs depth in all five. A supervisor that routes to five products is a hub: it needs breadth in all five and depth in none.

### 7.2 The three compositions

|  | **Scoped** | **Cross-product** | **Hub** |
| --- | --- | --- | --- |
| Scope | `core` + home | `core` + primary + 1–3 secondaries | `core` + all allowed |
| Seeds | L2 | L2 in every in-scope product | — |
| 1-hop | L1 | L1 within each in-scope product | — |
| Primary-tier entities | — | — | L1 in every product |
| Everything else in scope | L0 | L0 | L0 |
| Out of scope | absent, named in handoff | absent, named in handoff | nothing is out of scope |
| Bridges | only those touching L2 entities | **all bridges between in-scope products, both endpoints forced to L2** | **all bridges, at L2 — this is the hub's working set** |
| Rules | entity rules over its L2 set + global | same | global only, plus the few whose entities are all at L2 |
| Agent directory | no | no | **yes** |
| Typical size | 1,000–2,500 tok | 2,500–5,000 tok | 2,500–3,500 tok |

### 7.3 Scoped

The default and the majority. Scope is `{core, home_product}`. Other products do not appear at all, not even as L0 names — only as a line in the handoff note. A ticketing SLA agent has no business holding a list of CRM entity names.

### 7.4 Cross-product — your CCaaS and CRM cases

The primary product is the one carrying the most seed mass. Secondaries are products that either (a) contain a seed above threshold, or (b) are reached from a seed across a bridge in `bridges.yaml`. Route (b) is what makes this work without configuration.

**CCaaS needing ticketing.** A CCaaS agent seeds on `ccaas.Call`, `ccaas.IVRFlow`, `core.Customer`. `bridges.yaml` contains `ccaas.Call - creates -> ticketing.Ticket`. The bridge is traversed from a seed, so `ticketing` becomes a secondary and `ticketing.Ticket` arrives at L2 — not as a stub, because of the bridge promotion rule below. You never told the system that CCaaS needs ticketing. You told it that a call creates a ticket, which is a fact about your business.

**CRM needing CCaaS, campaign and web tracking.** Same mechanism, three times. The CRM agent seeds on `crm.Deal`, `crm.Pipeline`, `core.Company`. Bridges carry it to `ccaas.Call` (calls logged against a deal), `campaign.Campaign` (attributed source), `webtracking.Session` (engagement signal). Three secondaries, each contributing its seeded entity at L2 and that entity's one-hop neighbourhood at L1. The rest of each secondary product sits at L0.

**The bridge promotion rule.** A cross-product relation is only useful if the agent can actually join across it, which requires attributes on both sides. So:

```python
for e in snap.bridges:
    if e.src in scope and e.dst in scope:
        if level.get(e.src) == L2 or level.get(e.dst) == L2:
            level[e.src] = level[e.dst] = L2      # both ends, always
```

Without this, a CCaaS agent would get `ticketing.Ticket` as a 25-token stub and be unable to reason about ticket status or priority — technically closed, practically useless. This rule is the single most important line in the cross-product path.

**Capping the blast radius.** Secondaries are ranked by bridge count from the primary (the affinity matrix from Section 3) and capped at three by default. A fourth product that is genuinely needed will show up as a recall failure in the eval harness, and the fix is to raise the cap for that agent class or, better, to ask whether it should be a hub.

### 7.5 The hub — breadth, not depth

The instinct is to give the hub the complete ontology. That is the wrong call, and not only for size reasons.

Run the numbers on six products at roughly 25 entities each. Everything at L2, plus every rule: about **16,500 tokens**. The hub composition described below: about **2,900 tokens**. But the size difference is secondary. The real argument is that a hub's job is to *route*, and routing needs to know what exists and what connects to what — not what `ticket.csat_score` means. Handing the hub 150 entities at full detail buries the six facts it actually needs under 15,000 tokens of detail belonging to other agents, and every one of those tokens is an opportunity to answer a question itself instead of delegating.

**Hub composition:**

1. **Product register** from `meta.yaml` — six entries, name and one-line purpose.
2. **Primary-tier entities at L1** — the five to eight `hub_tier: primary` entities per product, name, definition and identifier. About 40 entities, \~1,000 tokens. This is the hub's map of the territory.
3. **Everything else at L0** — bare qualified names grouped by product. \~110 names, \~450 tokens. Enough for the hub to recognise a term and know which product owns it.
4. **All of `bridges.yaml` at L2 on both endpoints.** This is the hub's specialty and the part no other agent gets in full. The hub is the only component that needs to know that a call creates a ticket, that a campaign attributes to a deal, that a web session resolves to a customer identity. Cross-product structure *is* the routing problem.
5. **Global rules only**, plus any entity rules whose full entity set happens to be at L2 via bridges.
6. **The agent directory** — see below.

### 7.6 The agent directory: routing without a routing table

The hub needs to know who to delegate to. The registry already knows, because every agent registered itself on first call (Section 4.5). So the hub's slice carries a generated directory:

```yaml
  agents:
    - id: ticketing.sla_escalation
      product: ticketing
      purpose: Monitors SLA breaches, escalates overdue tickets, reassigns ownership.
      handles: [Ticket, SLA, Queue, Staff, Notification]
    - id: crm.deal_desk
      product: crm
      purpose: Reviews deal structure, pricing approvals and discount exceptions.
      handles: [Deal, Pipeline, Quote, Company]
    - id: ccaas.call_triage
      product: ccaas
      purpose: Classifies inbound calls and creates tickets for unresolved issues.
      handles: [Call, IVRFlow, Customer, Ticket]
```

Each entry is derived: `purpose` from what the agent sent, `handles` from that agent's own L2 entity set as computed by this same pipeline. Nothing here is authored. When a new agent appears, it is in the hub's directory on the hub's next session. When an agent's purpose changes, its directory entry changes with it.

This is the piece that closes the loop on "I should not maintain what agent gets what" — it also means you do not maintain *who routes to whom*. The hub reads a directory that the agents wrote by existing.

### 7.7 Hub sizing

| Component | Count | Tokens |
| --- | --- | --- |
| Product register | 6 | 120 |
| Primary entities at L1 | 40 | 1,000 |
| Remaining entities at L0 | 110 | 440 |
| Bridges at L2 | \~25 relations | 300 |
| Global rules | \~15 | 450 |
| Agent directory | \~30 agents | 750 |
| Scope note | — | 80 |
| **Total** |  | **\~3,140** |

Comfortably inside any context budget, and it grows linearly in products and agents rather than in total ontology size. A seventh product adds roughly 350 tokens to the hub, not 2,500.

## 8. Cross-product resolution via bridges

Section 7 described what happens to a cross-product slice. This section describes the one file that makes it possible, and how to know when it is wrong.

### 8.1 `bridges.yaml`

A bridge is a relation whose endpoints live in different namespaces. The compiler can detect these automatically wherever you write them, so a separate file is not technically required — it exists for **review discipline**. Bridges are the highest-leverage and highest-risk statements in the ontology: a wrong bridge silently gives an agent access to a product it should not join to, and a missing bridge silently starves a cross-product agent. They deserve their own file and their own reviewer.

Bridges carry more metadata than local relations:

```yaml
bridges:
  - src: ccaas.Call
    predicate: creates
    dst: ticketing.Ticket
    join: ccaas.calls.ticket_id = ticketing.tickets.id
    cardinality: one_to_one
    always: false

  - src: webtracking.Session
    predicate: resolves_to
    dst: core.CustomerIdentity
    join: webtracking.sessions.anonymous_id = cdp.identity_keys.key_value
    cardinality: many_to_one
    always: true
```

| Field | Why it matters |
| --- | --- |
| `join` | **The most valuable field in the file.** Without it the agent knows a call relates to a ticket but not through which column. With it the agent can actually construct the query. A bridge without a join is a hint; a bridge with one is usable. |
| `cardinality` | Stops an agent reasoning as though a one-to-many edge were one-to-one — the source of a large fraction of cross-product errors. |
| `always` | Marks the identity spine (8.3). Ships whenever both products are in scope, regardless of seeding. |

### 8.2 A worked `bridges.yaml` for your six products

```yaml
bridges:
  # --- identity spine (always: true) ---
  - { src: core.Customer,        predicate: identified_by, dst: core.CustomerIdentity, always: true }
  - { src: cdp.Profile,          predicate: unifies,       dst: core.CustomerIdentity, always: true }
  - { src: webtracking.Session,  predicate: resolves_to,   dst: core.CustomerIdentity, always: true }
  - { src: ccaas.Call,           predicate: placed_by,     dst: core.Customer,         always: true }
  - { src: campaign.Recipient,   predicate: is,            dst: core.Customer,         always: true }

  # --- ccaas <-> ticketing ---
  - { src: ccaas.Call,           predicate: creates,       dst: ticketing.Ticket }
  - { src: ticketing.Ticket,     predicate: escalated_from, dst: ccaas.Call }

  # --- crm <-> ccaas ---
  - { src: ccaas.Call,           predicate: logged_on,     dst: crm.Deal }

  # --- crm <-> campaign ---
  - { src: campaign.Campaign,    predicate: attributed_to, dst: crm.Deal }
  - { src: campaign.Campaign,    predicate: targets,       dst: cdp.Segment }

  # --- crm <-> webtracking ---
  - { src: webtracking.Session,  predicate: engaged_with,  dst: crm.Deal }
  - { src: webtracking.PageView, predicate: triggered,     dst: campaign.Campaign }

  # --- cdp as segmentation source ---
  - { src: cdp.Segment,          predicate: contains,      dst: core.Customer }

  # --- ticketing <-> crm ---
  - { src: ticketing.Ticket,     predicate: affects,       dst: crm.Deal }
```

Every cross-product dependency you described is in this file, and none of it mentions an agent. "CCaaS needs ticketing" is not a configuration line — it is the consequence of `ccaas.Call creates ticketing.Ticket` being true about your business.

### 8.3 The identity spine

Most cross-product joins in a customer-data stack route through one place: customer identity. `core.CustomerIdentity` is the structural centre of your graph even though no single product owns it, and CDP is its keeper.

This creates a failure mode worth designing against. A CRM agent seeded on `crm.Deal` reaching `webtracking.Session` across a bridge gets both endpoints at L2 — but if `core.CustomerIdentity` never seeded, the agent holds two entities it cannot actually connect, because the real join runs `Deal → Company → Customer → CustomerIdentity → Session`. Structurally closed; practically broken.

The `always: true` flag fixes it. Spine bridges and their endpoints are forced to L2 whenever both products are in scope, seeded or not. It costs perhaps 200 tokens on a cross-product slice and it is the difference between an agent that can join across products and one that merely knows it should be able to.

### 8.4 The affinity matrix

The compiler counts bridges per product pair and writes `affinity.json`:

```
            core  tick  crm  ccaas  cdp  camp  webtr
  crm         2     1    —     1     1    1      1
  ccaas       2     2    1     —     —    —      —
  ticketing   2     —    1     2     —    —      —
```

This drives two things. First, **secondary ranking** — when a cross-product agent's seeds reach four products but the cap is three, the products with the strongest structural affinity to the primary win. Second, **an authoring signal**: a product pair with zero bridges but agents that regularly need both is a modelling gap, and the matrix makes it visible.

### 8.5 Finding the bridges you are missing

A missing bridge is silent — the slice is structurally valid, it just cannot answer the question. Three detectors, in order of how early they catch it:

**At compile time — shared identifier columns.** If two entities in different products have identifiers pointing at the same table or at a column pair that appears elsewhere in a declared `join`, they are almost certainly related and no bridge says so. The compiler emits these as warnings. Cheap and catches a surprising number.

**At eval time — clustered recall failures.** When golden-set failures for cross-product tasks all involve the same product pair, that pair is missing a bridge. This is the reliable detector and the reason Section 12's golden sets must include cross-product tasks, not just single-product ones.

**At runtime — extend requests.** An agent homed in product Q repeatedly extending for entities in product P means there is a real relationship that `bridges.yaml` does not describe. Aggregate extend requests by `(home_product, requested_product)` and review the top pairs monthly. This is the detector that finds the bridges you did not know existed, because it is driven by what agents actually need rather than what you thought to model.

### 8.6 Where bridges must not be used

A bridge grants structural reachability, and reachability is not authorisation. The scope intersection from Section 4.6 is applied **before** bridge traversal, so a bridge into a product the token does not permit is simply not there. Do not implement it the other way around: traversing first and filtering the rendered output later leaves the entity name visible in a relation line, which leaks your schema one edge at a time.

## 9. Budget and graceful degradation

### 9.1 Estimating size without rendering

Rendering to measure and re-rendering to fix is too slow to do in a loop. Use a calibrated cost model during the ladder and render exactly once at the end:

```python
EST = {L0: 4, L1: 26, L2: 92}          # tokens per entity, fitted
REL, RULE, FIXED = 11, 31, 90          # per relation, per rule, envelope

def estimate(level, relations, rules):
    return (sum(EST[lv] for lv in level.values())
            + REL * len(relations) + RULE * len(rules) + FIXED)
```

Fit the coefficients once by ordinary least squares against real `tiktoken` counts over a few hundred built slices, and re-fit whenever the renderer changes. After the final render, compare actual against estimate; if the error exceeds 10%, log it and schedule a re-fit. In practice the model lands within 3–5% because slice structure is highly regular.

Reserve headroom. `budget_tokens` is what the agent allocated to ontology, but the agent's own system prompt, tool schemas and first user turn also compete. Build to **85% of the stated budget** unless the agent explicitly opts out.

### 9.2 The demotion ladder

Applied in order, stopping as soon as the estimate fits. Never applied out of order — the ordering is what makes degradation predictable.

| Step | Action | Rationale |
| --- | --- | --- |
| 1 | Drop L0 names in **secondary** products entirely (keep the product named in the scope note) | Bare names in a product the agent barely touches are the cheapest thing to lose |
| 2 | Demote L1 stubs reached by exactly one seed → L0, ascending by that seed's score | The weakest edges of the working set |
| 3 | Demote count-promoted L2 entities (the `reached_by >= 3` ones) → L1 | They were promoted by a heuristic, not by a direct signal |
| 4 | Demote product-floor L2 entities (score 0.6) → L1 | The floor is insurance, not a requirement |
| 5 | Drop `severity: soft` rules | Explicitly marked as losable when you tagged them |
| — | **STOP** |  |

**Re-run rule selection after every demotion step.** A rule whose entity just dropped from L2 to L1 no longer satisfies C3 and must go with it. Forgetting this is the single easiest way to break the closure guarantee under budget pressure, and it will not be caught by anything except an explicit assertion — so assert it.

### 9.3 Hard floors — never crossed, at any budget

- **Tool-derived and module-derived seeds stay at L2.** Score 1.0 means the agent has a tool that operates on this entity. Demoting it produces an agent that can call a tool it does not understand.
- **Every `scope: global` rule ships.** Tenant timezone is not optional at 4,000 tokens and mandatory at 8,000.
- **Every `severity: hard` rule whose entities are still L2 ships.**
- **The scope note ships.** It is 80 tokens and it is the mechanism that prevents confident wrong answers.
- **Closure holds.** Demoting L1 → L0 removes the relations touching that entity, which keeps C1 satisfied. Demotion never leaves a dangling edge.

### 9.4 When the floor is still too big

If the ladder completes and the minimum viable slice — tool seeds at L2, global rules, scope note — still exceeds budget, **do not keep cutting**. Return that minimum slice with:

```json
"coverage": { "budget_exceeded": true, "required_tokens": 7400, "budget": 4000 }
```

and raise an alert. A budget that cannot hold the entities the agent's own tools operate on means one of two things: the budget is set wrong, or the agent has been given too many jobs. Both are decisions for a person. Silently degrading into a slice that omits half the agent's working set produces an agent that fails in ways nobody can debug, which is strictly worse than an agent that starts with a loud warning.

### 9.5 Everything is recorded

```json
"coverage": {
  "demoted": [
    {"qid": "ticketing.AuditEvent", "from": "L1", "to": "L0", "step": 2},
    {"qid": "core.Note",           "from": "L2", "to": "L1", "step": 4}
  ],
  "rules_dropped": ["TKT-BR-009"],
  "budget": 6000, "est_tokens": 5810, "headroom_pct": 85
}
```

And the prose scope note reflects it, because the model reads prose and not JSON: *"Note is included by name and definition only. You do not have its visibility setting or the rules governing internal notes."*

Demotions are also a metric. A slice that demotes on every build is telling you its budget is too tight or its agent is too broad, and that signal is worth a dashboard.

### 9.6 Interaction with prompt caching

If the inference layer uses prefix caching, the slice is an ideal cache prefix — stable across every turn of a session and across sessions until the ontology changes. Two practical notes.

First, providers impose a **minimum cacheable prefix length**. A 400-token scoped slice may fall below it and never cache. That is usually fine, because a 400-token prefix is cheap anyway; if it matters, place the slice after a larger stable block rather than padding it artificially.

Second, **the slice must come first and must not move**. Anything that varies per turn — timestamps, session ids, the user's message — placed before or inside the slice destroys the prefix match entirely. This is the most common way teams accidentally lose the caching benefit, and it is worth an explicit check in the agent framework's prompt assembly.

## 10. Registry, cache keys, and warming

This section is the answer to the latency requirement. The design goal is that **the cold path never runs in production** — every hydrate is a lookup, and slice building happens on the build machine, not on the request path.

### 10.1 The registry

```sql
CREATE TABLE agent_registry (
  agent_id              text PRIMARY KEY,
  version               text,
  purpose               text,
  tools                 jsonb,
  tool_params           jsonb,
  modules               jsonb,
  home_product          text,
  scope_class_resolved  text,
  allowed_products      jsonb,
  budget_bucket         int,
  format                text,
  descriptor_hash       text NOT NULL,   -- everything above that affects the slice
  first_seen            timestamptz,
  last_seen             timestamptz,
  session_count         bigint DEFAULT 0,
  extend_count          bigint DEFAULT 0
);
CREATE INDEX ON agent_registry (descriptor_hash);
CREATE INDEX ON agent_registry (last_seen);
```

Populated entirely by agents calling `/hydrate`. Nothing writes to it by hand. It exists to answer two questions: *which slices should be precomputed* (10.4) and *which agents might want a newly added node* (Section 11).

### 10.2 Cache key derivation

```python
def slice_key(req, snapshot_id, allowed_products, scope_class) -> str:
    return sha256_hex(canonical_json({
        "snapshot":  snapshot_id,
        "purpose":   normalise_hash(req.purpose),
        "tools":     sorted(req.tools),
        "params":    sorted(req.tool_params),
        "modules":   sorted(req.modules),
        "home":      req.home_product,
        "scope":     scope_class,
        "allowed":   sorted(allowed_products),
        "budget":    round_to(req.budget_tokens, 1000),
        "format":    req.format,
        "renderer":  RENDERER_VERSION,
    }))
```

Four decisions worth calling out:

**`agent_id` is deliberately not in the key.** Thirty ticketing agents with the same purpose, tools and scope share one slice. This is correct — they need the same thing — and it collapses the number of distinct slices to build during warming. The agent id lives in the registry, not the key.

**`allowed_products` is in the key, and it must be.** Two agents with identical purposes but different token scopes must never share a slice. Omitting this turns the cache into an access-control bypass.

**`budget_tokens` is bucketed to the nearest 1,000.** Agents that send 6,000 and 6,100 should not fragment the cache into two entries for what will be an identical slice.

**`RENDERER_VERSION` is in the key.** Any change to the renderer, the cost model, or the level definitions must invalidate every slice. Bumping a constant is a far safer mechanism than remembering to flush.

### 10.3 Storage tiers

| Tier | Medium | Contents | Latency |
| --- | --- | --- | --- |
| L1 | In-process LRU, \~1,000 entries (\~10 MB) | Rendered slice strings for the hottest descriptors | < 1 ms |
| L2 | Redis, keyed by `slice_key` | Every warmed slice for the current and previous snapshot | 2–5 ms |
| L3 | Object storage, per snapshot directory | Every warmed slice, durable | \~20 ms |
| — | Build | Sections 6–9 | 100–500 ms |

### 10.4 The warming sweep

Runs after a snapshot is frozen and **before** the pointer flips to it:

```python
def warm(new_snapshot, prev_snapshot):
    descriptors = registry.distinct_descriptors(active_within=timedelta(days=30))
    with ThreadPool(8) as pool:
        for d, slice_ in pool.imap_unordered(lambda d: (d, build(d, new_snapshot)),
                                             descriptors):
            l2.put(slice_key(d, new_snapshot.id), slice_)
            l3.put(new_snapshot.id, slice_key(d, new_snapshot.id), slice_)
            prev = l3.get(prev_snapshot.id, slice_key(d, prev_snapshot.id))
            if prev and prev.content_hash == slice_.content_hash:
                unchanged.add(d)                 # enables the 5.4 short-circuit
    pointer.flip(new_snapshot.id)                # atomic
```

For 200 distinct descriptors at roughly 150 ms each across eight workers, the sweep takes about four seconds. Compared against a build that already takes 30 seconds, warming is free.

The pointer flip is the only moment anything changes for live traffic, and it is atomic. Before the flip, every request is served from the old snapshot; after it, every request hits an already-warm cache on the new one. **There is no window in which an agent pays the cold path because of a deploy.**

### 10.5 Steady state

| Path | Share of requests | p99 |
| --- | --- | --- |
| L1 hit | \~70% | < 2 ms |
| L2 hit | \~29% | < 8 ms |
| Short-circuit (`unchanged`) | included above | < 5 ms |
| Cold build | < 1% | < 500 ms |

The cold path fires only for a genuinely new descriptor — a new agent, or an existing agent whose purpose, tools or version just changed. In a stable MAS that is a deploy-time event, not a runtime one.

### 10.6 Thundering herd and negative caching

When a new agent rolls out to fifty replicas simultaneously, fifty identical cold requests arrive at once. Guard with single-flight: a per-key lock so the first request builds and the other forty-nine wait on the result rather than each building their own.

```python
async def get_or_build(key, descriptor, snapshot):
    if (hit := l1.get(key) or await l2.get(key)):
        return hit
    async with keylock(key):                      # single-flight
        if (hit := await l2.get(key)):            # someone else won the race
            return hit
        slice_ = await build(descriptor, snapshot)
        await l2.put(key, slice_); l1.put(key, slice_)
        return slice_
```

Cache build *failures* too, for 30 seconds. A descriptor that fails to build will fail again immediately, and fifty replicas retrying a failing build in a tight loop is how a hydrate service takes down the MAS it was meant to serve.

### 10.7 Retention

Slices expire by snapshot, not by clock. Keep the current and previous snapshot's slices in L2, and the last three in L3. The `ttl_seconds` in the response is advice to the agent about how long to hold its copy; set it to your expected inter-snapshot interval, typically one hour.

Registry rows are never deleted. An agent not seen for 90 days drops out of the warming sweep, so it stops costing build time — and if it reappears, its first call is a single cold build that re-activates it. Deleting registry rows would lose the extend-rate and session-count history that Section 13 depends on.

## 11. Incremental rebuild and versioned rollout

### 11.1 Trigger and debounce

A commit to `ontology/` triggers a build. Batch commits into a window — five minutes is a sensible default — so a morning of edits produces one snapshot rather than fifteen. A manual trigger bypasses the debounce for urgent fixes.

Nothing about a build touches live traffic until the pointer flip in 11.6.

### 11.2 The diff

Compare snapshot N against N+1 structurally, not textually:

```python
@dataclass
class Diff:
    entities_added:    set[str]
    entities_removed:  set[str]
    entities_changed:  set[str]   # definition, attributes, taxonomy, synonyms, identifier
    relations_added:   set[tuple] # (src, predicate, dst)
    relations_removed: set[tuple]
    rules_added:       set[str]
    rules_removed:     set[str]
    rules_retagged:    set[str]   # entities list changed
```

A reformatted comment or a reordered key produces an empty diff and therefore no rebuild. This matters more than it sounds: without structural diffing, every whitespace change rebuilds every slice.

### 11.3 The reverse index

Built during warming. Every slice records which qids it contains and at which level, and which rules it carries:

```
entity_to_descriptors:  qid      -> {descriptor_hash: level}
rule_to_descriptors:    rule_id  -> {descriptor_hash}
```

For 200 descriptors over 150 entities this is a few thousand entries — a hash map, not a scan.

### 11.4 Branch A — slices that already hold the changed thing

```python
affected = set()
for q in diff.entities_changed | diff.entities_removed:
    affected |= entity_to_descriptors[q].keys()
for r in diff.rules_added | diff.rules_removed | diff.rules_retagged:
    affected |= rule_to_descriptors[r]
for (src, _, dst) in diff.relations_added | diff.relations_removed:
    # a new edge from Ticket means every slice holding Ticket at L2
    # gains or loses a stub
    affected |= {d for d, lv in entity_to_descriptors[src].items() if lv >= L2}
    affected |= {d for d, lv in entity_to_descriptors[dst].items() if lv >= L2}
```

The relations clause is the one people forget. Adding `Ticket - has_attachment -> Attachment` changes nothing about `Ticket` itself, but every slice with `Ticket` at L2 must now show the new relation and carry an `Attachment` stub.

### 11.5 Branch B — descriptors that should now match

Branch A can only find slices that already contain something. A brand-new entity is in no slice, so no reverse-index lookup will ever surface the agents that need it. Branch B is what lets slices **grow**.

```python
for q in diff.entities_added:
    e = snap_new[q]
    for d in registry.active_descriptors():
        if lexical_would_seed(e, d) or cosine(e.embedding, d.embedding) >= TAU_VECTOR:
            affected.add(d.hash)
```

Descriptor embeddings are stored at registration, so this is a 200 × k matrix multiply plus a few hash lookups — well under a millisecond for a typical diff. `lexical_would_seed` checks whether the new entity's name or any synonym appears in the descriptor's purpose or tool list, which catches the cases embeddings miss.

Concretely: you add `Attachment`. Branch A gives every slice holding `Ticket` a new stub. Branch B notices that an agent described as *"handles file upload problems on tickets"* would now seed on `Attachment` directly, and promotes it to L2 in that agent's slice. Neither required you to say anything about either agent.

### 11.6 Rebuild, dedupe, flip

```python
unaffected = registry.active_descriptors() - affected

for d in unaffected:
    # byte-identical content, new snapshot id: re-key, do not rebuild
    l2.alias(slice_key(d, new.id), content_hash_of(d, prev.id))

for d in affected:
    s = build(d, new)
    l2.put(slice_key(d, new.id), s)
    if s.content_hash == content_hash_of(d, prev.id):
        unchanged.add(d)        # rebuilt, but identical — agents short-circuit

pointer.flip(new.id)
```

Store slices in L3 **by content hash**, with `slice_key → content_hash` as a separate mapping. Most snapshots change a handful of entities, so most descriptors produce byte-identical slices and the storage cost of a new snapshot is the delta, not a full copy.

The `unchanged` set feeds the short-circuit in 5.4: an agent that reconnects holding the previous content hash gets a 200-byte response instead of a full slice, even though the snapshot id moved.

### 11.7 A churn refinement to Section 7.2

One trade-off surfaces only when you think about rebuild frequency. If scoped slices include an L0 list of every other entity in their home product, then **adding any entity to ticketing changes the content hash of every ticketing agent's slice** — forty rebuilds and forty lost short-circuits for a node most of them will never use.

So: **L0 lists are emitted for hub and cross-product slices only.** A scoped slice carries its L2 seeds, its L1 stubs, its rules and its scope note, and nothing else. The scoped agent loses a list of names it was not going to use; in exchange, ontology growth inside its own product stops churning its slice. Make it a per-product config flag if you want it back somewhere.

### 11.8 Rollout and rollback

```
build N+1 into staging  →  validators (§12.1)  →  eval harness (§12.2)
   →  warm all descriptors  →  flip pointer  →  keep N hot for one TTL
```

The eval harness is a **gate**, not a report. A snapshot whose golden-set recall regresses below 1.0 for any agent does not flip, and the build fails loudly with the specific agent and the specific missing entity.

Rollback is `pointer.flip(N)` and takes effect on the next request. Because N's slices are still in L2 and L3, there is nothing to rebuild and nothing to restore. Keep three snapshots on disk; that is about a week of rollback depth at a daily cadence.

### 11.9 What running sessions experience

Nothing. A session hydrated at `v1846` holds its slice in context and never calls again. The pointer flipping to `v1847` is invisible to it.

The only interaction is the escape hatch: an `extend` call quotes `slice_id`, which resolves to `v1846`, and is served from that pinned snapshot so the agent's world stays internally consistent mid-task. Once `v1846` ages out of retention — three snapshots — `extend` returns `409 snapshot_expired` and the agent re-hydrates. At a one-hour TTL and a daily build cadence this is effectively unreachable, but it needs a defined behaviour rather than an exception.

## 12. Correctness: validators and the eval harness

### 12.1 Compile-time validators

Run on every build. **Error** fails the build; **warn** prints and requires acknowledgement in the PR.

| # | Check | Level |
| --- | --- | --- |
| V1 | All YAML parses | error |
| V2 | Every bare entity name resolves to exactly one qid | error |
| V3 | No qid defined twice | error |
| V4 | Every relation endpoint exists | error |
| V5 | Every taxonomy key `entity.attribute` names a real entity and a real attribute of it | error |
| V6 | Every entity has a definition and an identifier | error |
| V7 | Every `core.*` identifier map covers every product that references that entity | error |
| V8 | Every rule has either a non-empty `entities` list or `scope: global` | error |
| V9 | Every rule's tagged entities resolve | error |
| V10 | Bridge endpoints are in different namespaces; `join` clauses parse | error |
| V11 | Synonym collisions across namespaces | warn |
| V12 | Entities with relation degree 0 | warn |
| V13 | Products with no path to `core.CustomerIdentity` | warn |
| V14 | `hub_tier: primary` count per product outside 3–10 | warn |
| V15 | Entities in different products sharing an identifier table with no bridge declared | warn |

V15 is the highest-value warning in the list. It is how the compiler finds bridges you forgot to write, by noticing that two products point at the same table and nothing says they are related.

### 12.2 Slice-level assertions

Run during warming, across every registered descriptor:

| # | Check |
| --- | --- |
| S1 | C1–C7 from Section 1.1 hold for every slice |
| S2 | No slice exceeds budget unless `budget_exceeded` is set |
| S3 | Every slice contains every `scope: global` rule |
| S4 | Building the same descriptor twice produces byte-identical output |

S4 is worth the cost. A non-deterministic renderer looks fine in testing and quietly destroys the cache hit rate in production, which will present as a latency problem with no obvious cause.

### 12.3 Golden sets

One per agent, 20–40 tasks. The format carries what the *slice* must contain, not what the answer should be:

```yaml
- id: sla-001
  agent: ticketing.sla_escalation
  task: >
    Ticket 4821 is priority urgent, created 5 hours ago, no reply yet.
    Is the first-response target breached?
  requires_entities: [ticketing.Ticket, ticketing.SLA]
  requires_taxonomy: [ticket.priority, ticket.status]
  requires_rules:    [TKT-BR-007, GBL-BR-001]

- id: sla-004
  agent: ticketing.sla_escalation
  task: >
    The assigned agent on ticket 4821 is on leave. Who should it go to,
    and does moving it change the SLA clock?
  requires_entities: [ticketing.Ticket, ticketing.SLA, ticketing.Queue, core.Staff]
  requires_rules:    [TKT-BR-006, TKT-BR-008, TKT-BR-007]

- id: ccaas-cross-002
  agent: ccaas.call_triage
  task: >
    This call could not be resolved. Create a ticket and link it back.
  requires_entities: [ccaas.Call, ticketing.Ticket, core.Customer]
  requires_bridges:  ["ccaas.Call creates ticketing.Ticket"]
```

**Include cross-product tasks deliberately.** Single-product golden sets pass on a system with no bridges at all, so they cannot detect the failure mode most likely to bite you.

### 12.4 Two levels of evaluation

**Level 1 — structural recall. Runs on every build, no model required.**

```python
def level1(task, slice_):
    full = slice_.entities_at(L2)
    return all([
        set(task.requires_entities) <= full,
        set(task.requires_rules)    <= slice_.rule_ids,
        set(task.requires_taxonomy) <= slice_.taxonomy_keys,
        set(task.requires_bridges)  <= slice_.bridge_keys,
    ])
```

This is the part that makes the whole approach testable. Because slices are structured data rather than retrieved text, you can measure whether the agent got what it needs **without running the agent**. A full sweep across 30 agents and 900 tasks finishes in a couple of seconds, which is what lets it be a gate on every commit rather than a nightly report.

**Level 2 — behavioural. Nightly and pre-release.** Actually run each agent with its slice against the task and score the response. Catches the residual cases where everything needed is present but the slice is confusing — usually too many stubs, or a demoted entity the agent tried to reason about anyway. Slower and noisier, so it informs rather than gates.

### 12.5 Bootstrapping the golden sets

Budget roughly two hours per agent. Do not write the tasks from imagination:

1. **Sample 50 real tasks** from that agent's production traffic.
2. **Run each against the full ontology** (every entity at L2) and have the model report which entities, rules and taxonomies it actually used.
3. **A domain person verifies and corrects** the reported list. Reviewing a draft is perhaps three times faster than authoring one.
4. Keep 20–40 after deduplication.

Step 2 is the time-saver, and it is also a useful sanity check in its own right: if the model given the *entire* ontology cannot do the task, no slice will fix that, and the problem is elsewhere.

### 12.6 Threshold tuning

The constants in Section 6 are fitted, not chosen:

```python
grid = product(
    TAU_VECTOR   = [0.35, 0.40, 0.42, 0.45, 0.50],
    TAU_SEED     = [0.45, 0.50, 0.55, 0.60, 0.65],
    PROMOTE_AT   = [2, 3, 4],
    PRODUCT_FLOOR= [0.0, 0.5, 0.6, 0.7],
)
# objective: minimise mean slice tokens
# constraint: level-1 recall == 1.0 for EVERY agent, not on average
```

The constraint is per-agent and absolute. An average recall of 0.98 means one agent is broken, and averages hide exactly the thing you need to see. Report the Pareto frontier and pick the smallest configuration that clears the constraint with margin — take a setting slightly more generous than the boundary, because the boundary will move as the ontology grows.

Re-run the sweep quarterly, and any time the ontology grows by more than about 20%.

### 12.7 Regression tracking

Persist per-agent, per-snapshot: level-1 recall, slice token count, L2 entity count, rule count, demotion count. Alert on:

- **Any** recall drop below 1.0 — blocks the flip.
- Slice size up more than 20% snapshot over snapshot — usually a hub entity gained relations, or a synonym became over-broad.
- Demotion count rising from zero — the agent is outgrowing its budget.
- **Precision** (fraction of L2 entities no golden task needed) rising above \~40%. Over-inclusion is safe but not free; it is the metric that tells you the thresholds have drifted loose.

## 13. Latency budget and observability

### 13.1 Where this sits relative to your MAS routing problem

The latency you are fighting is **per-message routing**: a decision cost paid on every hop, multiplied across the mesh, compounding over a session. Hydration is a different animal. It fires once, at session bootstrap, before the agent does any work, and it can run concurrently with whatever else your session setup is doing.

**Steady-state contribution to inter-agent message latency: zero.** Nothing in this system sits on the message path. If hydration took a full second it would add a second to session start and nothing to routing. It does not take a second.

### 13.2 Cold-path breakdown

With the graph and indexes resident in process and a local embedding model:

| Stage | Cost |
| --- | --- |
| Auth, parse, validate payload | 1 ms |
| Embed purpose + tools (bge-small, CPU, batch 1) | 8 ms |
| HNSW query, k=25 | 0.3 ms |
| Lexical n-gram lookups | 0.2 ms |
| Classify scope | < 0.1 ms |
| Level assignment, one-hop BFS | 0.5 ms |
| Closure assertions | 0.2 ms |
| Rule selection | 0.2 ms |
| Budget ladder (estimate-based, no rendering) | 1 ms |
| Render YAML | 8 ms |
| Hash, store to L1 + L2 | 3 ms |
| **Total** | **\~23 ms** |

The headline p99 of 500 ms in Section 10.3 is the pessimistic number covering a cold process, an L3 fetch and contention. The typical cold build is well under 50 ms.

### 13.3 The three optimisations that matter

**Use a local embedding model.** A hosted embedding API turns a 23 ms build into a 130 ms one, and the network call is the least reliable component in the path. `bge-small-en-v1.5` at 33M parameters runs batch-1 inference in single-digit milliseconds on CPU and is more than adequate for matching purpose strings to entity definitions. This is the single largest lever in the system.

**Keep the graph in process memory.** A few thousand entities in CSR form is under a megabyte. A graph database would add a network round trip per traversal and cost more than every other stage combined. Resist the pull toward Neo4j here — you are not doing deep traversals, you are doing one bounded hop over a tiny graph.

**Render once.** The budget ladder operates on the cost model, never on rendered output. Rendering inside the demotion loop is the easiest way to turn a 23 ms build into a 200 ms one.

### 13.4 Metrics

```
# request path
hydrate_latency_seconds          histogram  {path=l1|l2|l3|cold, scope_class}
hydrate_requests_total           counter    {scope_class, status}
hydrate_cache_hit_ratio          gauge      {tier}
hydrate_cold_build_seconds       histogram  {stage}

# slice shape
slice_tokens                     histogram  {agent_id}
slice_l2_entities                gauge      {agent_id}
slice_demotions_total            counter    {agent_id, step}
slice_budget_exceeded_total      counter    {agent_id}

# correctness
eval_recall                      gauge      {agent_id}
eval_precision                   gauge      {agent_id}
extend_requests_total            counter    {agent_id, home_product, requested_product}
extend_rate                      gauge      {agent_id}

# build
build_duration_seconds           histogram  {stage}
warm_duration_seconds            histogram
warm_descriptors_rebuilt         gauge
validator_warnings_total         counter    {check}
registry_new_descriptors_total   counter
```

`extend_requests_total{home_product, requested_product}` deserves special attention — it is not only an alert, it is the bridge-discovery signal from Section 8.5. Aggregate it monthly and read it as a list of relationships your ontology does not yet describe.

### 13.5 Alerts

| Priority | Condition | Meaning |
| --- | --- | --- |
| P0 | Eval recall < 1.0 at flip time | Blocks the flip. An agent is about to lose something it needs. |
| P0 | Hydrate error rate > 1% | Agents are failing to start. |
| P1 | Cold-path share > 5% of requests | Warming is broken or the registry is stale. |
| P1 | `extend_rate` > 2% for any agent | Seeding bug. Fix the synonym, tag or purpose — not the slice. |
| P1 | p99 hydrate latency > 100 ms | Something left the happy path; usually an embedding API crept in. |
| P2 | Slice size +20% snapshot over snapshot | A hub entity gained relations, or a synonym went over-broad. |
| P2 | `budget_exceeded` fired | A person needs to decide: raise the budget or split the agent. |
| P2 | Unacknowledged validator warnings | Usually a missing bridge (V15) or a synonym collision (V11). |

### 13.6 Reproducibility — the thing you will wish you had built

Emit `slice_id`, `content_hash` and `snapshot_id` into the agent's trace context at hydration, and propagate them through every downstream span.

When an agent gives a wrong answer three weeks later, the first question is always *what did it actually know?* Without this, that question is unanswerable and the investigation degenerates into guesswork. With it, you fetch the exact bytes the agent held — slices are stored by content hash and deduplicated, so keeping every distinct slice indefinitely costs almost nothing — and you can replay the task against it.

This also turns production incidents into golden-set entries. A wrong answer plus the slice that produced it is exactly the input Section 12.3 wants: you can see immediately whether the entity was missing (a seeding bug, fix the ontology) or present and misused (a prompt or model issue, not a slice issue). Distinguishing those two cases without the stored slice is close to impossible, and conflating them is how teams end up widening every slice until the whole design collapses back into "give everyone everything".

## 14. Build phases

Ten weeks to full production with cross-product and hub support. Phases 0 and 1 run in parallel — the ontology restructure is domain work, the compiler scaffolding is engineering, and neither blocks the other until Phase 2.

| Phase | Weeks | Owner | Deliverable |
| --- | --- | --- | --- |
| 0 | 1–2 | Domain + data modelling | Restructured, tagged ontology source |
| 1 | 1–3 | Backend | Compiler and validators |
| 2 | 3–4 | Backend | The four indexes, snapshot artifact |
| 3 | 4–5 | Backend | Slice builder, scoped class only |
| 4 | 5–6 | Backend + platform | Hydrate service, cache, warming |
| 5 | 6–7 | Domain + backend | Golden sets, eval harness, threshold sweep |
| 6 | 7–9 | Backend + domain | Bridges, cross-product, hub, agent directory |
| 7 | 9–10 | Platform | Incremental rebuild, rollout, observability |

### Phase 0 — Restructure the source

Split the monolith into `core.yaml`, six product files and `bridges.yaml`. Move shared entities to core and convert their identifiers to per-product maps. Convert `business_rules` from strings to tagged objects using the two-pass bootstrap in 2.4. Write the first `bridges.yaml` — even a partial one.

**Exit criteria.** Every entity has a namespace. Every rule has an `entities` list or `scope: global`. `bridges.yaml` contains at least the identity spine. A domain person has reviewed the rule tags for one complete product.

**Risk.** Rule tagging is the tedious part and the part people skip. It is also the part everything downstream depends on. Do not proceed to Phase 5 without it done properly for at least two products.

### Phase 1 — Compiler and validators

Parse, qualify, merge, validate. Implement V1–V15. Emit the canonical graph as a serialisable structure. No indexes yet.

**Exit criteria.** `compile ontology/` runs clean on the Phase 0 output. Deliberately breaking a relation endpoint fails the build with a useful message. Compile of the full ontology finishes in under 10 seconds without embeddings.

### Phase 2 — Indexes and snapshots

Build the adjacency, lexical, vector and rule indexes. Wire in the local embedding model. Write the snapshot directory with a manifest.

**Exit criteria.** Full compile including embeddings under 30 seconds. Two compiles of identical source produce identical manifest hashes. Lexical lookup of `support queue` returns `ticketing.Queue`; of `overdue` returns `ticketing.Ticket`.

### Phase 3 — Slice builder, scoped only

Seeding, level assignment, closure, rule selection, budget ladder, renderer. Scoped class only — no bridges, no hub. CLI first, no service.

**Exit criteria.** `build-slice --purpose "..." --tools ...` produces a valid YAML slice. C1–C7 assert clean. The SLA escalation trace in 6.7 reproduces. Build time under 50 ms warm. Two builds of the same input are byte-identical.

This is the phase where you find out whether the idea works. Run it against five real agent purposes and read the output by hand before going further.

### Phase 4 — Service, cache, warming

FastAPI service, `POST /hydrate`, registry, three cache tiers, warming sweep, pointer flip, single-flight, auth with `allowed_products` claims.

**Exit criteria.** p99 under 10 ms on a warm cache under load. Cold-path share under 1% after warming. Registration works — an unknown agent id creates a registry row and is warmed on the next build. A deliberate build during load causes no cold-path spike.

### Phase 5 — Golden sets and tuning

Golden sets for at least five agents by the bootstrap in 12.5. Level-1 harness. Threshold sweep. Wire the harness into CI as a gate.

**Exit criteria.** Level-1 recall 1.0 for every agent with a golden set. Full sweep across all agents runs in under 10 seconds. A deliberately removed synonym causes a specific, named recall failure rather than a vague one.

This is the phase that converts "it seems to work" into "we can prove it still works after the next change." Do not skip it under schedule pressure — everything after this point changes the ontology, and without the gate you will not know what you broke.

### Phase 6 — Cross-product and hub

Complete `bridges.yaml` with joins and cardinalities. Bridge promotion rule. Scope classification. Cross-product composition with the affinity-ranked secondary cap. Hub composition. Agent directory generation.

**Exit criteria.** A CCaaS agent seeded only on `ccaas.Call` receives `ticketing.Ticket` at L2 without anything being configured. A CRM agent picks up three secondaries in affinity order. The hub slice is under 4,000 tokens and contains every bridge and a directory of every registered agent. Cross-product golden tasks pass at recall 1.0.

### Phase 7 — Incremental rebuild and rollout

Structural diff, reverse index, both propagation branches, content-hash dedupe, blue-green flip and rollback, full metrics and alerting, trace propagation of `slice_id`.

**Exit criteria.** Adding one entity rebuilds only the affected descriptors, verified by count. A new entity semantically matching an existing agent's purpose appears in that agent's next slice with no configuration. Rollback is a pointer flip with no rebuild. A wrong answer in production can be traced to the exact slice bytes the agent held.

### If you only have two weeks

Phases 0, 1 and 3 for a single product, scoped agents only, CLI only, no service and no cache. Hand the generated slices to two real agents and compare their behaviour against the full ontology. That is enough to know whether the approach earns the remaining eight weeks — and the Phase 0 work is not wasted regardless, because a namespaced, rule-tagged ontology is better than a monolith whatever you build on top of it.

## 15. Tech stack, repo layout, interfaces

### 15.1 Repo layout

```
ontology-slice-service/
  ontology/                  # the YAML source — consider a separate repo with its own reviewers
    meta.yaml  core.yaml  bridges.yaml
    products/  rules/

  src/oss/
    compile/
      parse.py     qualify.py   merge.py
      validate.py  derive.py    embed.py
      index.py     snapshot.py
    slice/
      classify.py  seed.py      levels.py
      closure.py   rules.py     budget.py    render.py
    service/
      api.py       registry.py  cache.py     auth.py     warm.py
    diff/
      structural.py  impact.py
    eval/
      golden.py    level1.py    sweep.py

  goldens/
    ticketing.sla_escalation.yaml
    ccaas.call_triage.yaml
    ...
  tests/
  snapshots/                 # generated, gitignored
```

Put `ontology/` in its own repository if domain people are going to edit it. They should not need to clone a Python service to add an entity, and the service should not need a deploy when a synonym changes.

### 15.2 Libraries

| Concern | Choice | Why not the obvious alternative |
| --- | --- | --- |
| YAML | `ruamel.yaml` | PyYAML loses key order and comments; slices should read like your source |
| Models | `pydantic` v2 | Validation at the parse boundary, and it is fast enough to not matter |
| Graph | plain adjacency dicts | A few thousand nodes does not need `networkx`, let alone Neo4j. Reach for `rustworkx` only if the graph passes \~50k nodes |
| Embeddings | `bge-small-en-v1.5` via ONNX Runtime | A hosted API adds 100 ms and a failure mode to the hot path (13.3) |
| Vector index | `hnswlib` | FAISS is heavier and its GPU story is irrelevant at this scale |
| Tokens | `tiktoken` | Calibration and final verification only — never inside the budget ladder |
| Service | FastAPI + uvicorn | — |
| Cache | `redis-py` async | — |
| Registry | PostgreSQL | SQLite is fine below \~50 agents, but you will want concurrent writes from multiple replicas |
| Tracing | OpenTelemetry | — |
| Tests | `pytest` + `hypothesis` | Property-based tests are unusually well suited here: generate random descriptors, assert C1–C7 always hold |

### 15.3 The interfaces that matter

Three seams are worth defining formally, because each one is a place where a future change would otherwise ripple everywhere.

```python
class Snapshot(Protocol):
    id: str
    def entity(self, qid: str) -> EntityNode: ...
    def edges_of(self, qid: str) -> Iterable[RelationEdge]: ...
    def rules_for(self, qids: set[str]) -> list[RuleNode]: ...
    def entities_in(self, products: set[str]) -> Iterable[str]: ...

class SliceBuilder(Protocol):
    def build(self, descriptor: Descriptor, snap: Snapshot) -> Slice: ...

class Renderer(Protocol):
    version: str                       # feeds RENDERER_VERSION in the cache key
    def render(self, sl: Slice, fmt: str) -> str: ...
```

`Renderer.version` is the important one. It is what makes cache invalidation on a rendering change automatic rather than something a person has to remember during a deploy.

One hard rule on `SliceBuilder.build`: **no I/O.** No network, no database, no file reads. Everything it needs is in the `Snapshot` and the `Descriptor`. Enforce it in tests by running builds with network access blocked. This single constraint is what keeps the latency profile in 13.2 true as the codebase grows and people add "just one lookup."

### 15.4 Deployment shape

**Build job.** A CI runner or cron container. Compiles, validates, runs the eval gate, warms, writes the snapshot to object storage, flips the pointer. Needs no persistent state.

**Service.** Three or more stateless replicas. Each loads the current snapshot into memory at startup, then watches the pointer key in Redis (poll every 5 s) and loads a new snapshot in the background, swapping the reference atomically when ready. A replica never serves from a half-loaded snapshot.

Per-replica memory: graph \~1 MB, HNSW \~5 MB, L1 slice cache \~10 MB, embedding model \~130 MB. Call it 200 MB with headroom. This runs comfortably on small instances.

**Pointer.** A single Redis key holding the current snapshot id. Flipping it is the entire rollout mechanism, and flipping it back is the entire rollback mechanism.

### 15.5 Six things that will go wrong

In rough order of likelihood, with the guard for each.

1. **Rule tagging gets half-finished.** Two products tagged properly, four with empty `entities` lists, and rules silently stop distributing. *Guard:* V8 as a build error from day one, plus a dashboard of tagged-rule coverage per product.
2. **Someone puts a network call in the hot path.** An embedding API, a database lookup, "just checking one thing." p99 goes from 10 ms to 200 ms and nobody notices for a month. *Guard:* the no-I/O rule in 15.3, tested with network blocked.
3. **Non-deterministic rendering.** An unsorted set iteration somewhere. Slices stay correct, cache hit rate quietly collapses, and the symptom looks like a capacity problem. *Guard:* assertion S4, on every build.
4. **Golden sets rot.** An agent's purpose changes, its golden set does not, and the gate starts passing vacuously. *Guard:* store the descriptor hash the golden set was written against, and warn when an agent's descriptor changes but its golden set has not been touched.
5. **The hub accretes detail.** Someone says "the hub should really know about deal stages," and six months later the hub carries 12,000 tokens and answers questions it should be delegating. *Guard:* a hard CI assertion on hub slice size, around 4,000 tokens, that fails the build rather than warns.
6. **A synonym goes over-broad.** Someone adds `data` or `record` as a synonym and it starts seeding every slice in the system. *Guard:* the precision metric in 12.7, plus a rule that any synonym shorter than five characters or appearing in more than three entities needs review.

### 15.6 The one-sentence summary

You author a namespaced, rule-tagged ontology; a compiler turns it into an immutable indexed snapshot; agents send a purpose string and a tool list to one endpoint; a slice is derived, closed, budgeted and cached before they ask for it; and nothing anywhere in the system records which agent gets what.
