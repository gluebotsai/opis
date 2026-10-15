# Ontology format, fetch, prompt, and metric resolution

Working contract for Worktual Contact Center ontology and how agents use the enterprise semantic layer.

**Source files**

| Path | Role |
|------|------|
| `ontology/catalog.yml` | Modules, usecases, agent presets, prompt allowlists, product slots |
| `ontology/modules/*.yml` | Classes, relations, actions, metric ids |
| `ontology/taxonomy.yml` | Classification trees (channel, intent, priority, …) |
| `ontology/industry/*.yml` | Labels + taxonomy_adds + optional extra types |
| `ontology/noun_map.yml` | Existing onto/semantic nouns → `wt:*` (reference only) |
| `ontology/slice.py` | `fetch_ontology_slice` → `as_prompt()` |
| `semantic/metric_registry.yml` | Certified agent metric ids → MetricFlow names |
| `semantic/lookup.py` | `get_metric_schema(id)` — reject unknown / uncertified |
| Tenant `tenants/{org}/semantic.yaml` | Labels, synonyms, binds, thresholds |

Instance data (`Sidharth`, `TK-4412`) is **not** ontology.

---

## 1. What the ontology is

Ontology = **meaning**: what exists, how it may connect, which actions are allowed, which metric **ids** hang on which types.

It is **not** warehouse SQL, not MCP argument lists, and not live customer rows.

### Format

- **Git YAML** is the source of truth (stable `wt:*` ids).
- **Modules** are Lego packs. An agent **selects modules** (or a catalog preset).
- Optional Neo4j copy is for browsing the schema later — **do not GraphRAG** to pick modules.

Each module file (`ontology/modules/<name>.yml`) contains:

```yaml
module: ticket
layer: domain
depends_on: [core]
usecase: >
  When the agent creates, tracks, or relates a conversation to an issue.

classes:
  - id: wt:Ticket
    definition: Customer issue tracked to resolution with SLA.
    extends: wt:WorkItem
    properties: [number, subject, category]   # legal schema; not dumped in compact prompt
    classified_by: [ticket.priority, ticket.status]
    relations:
      customer: wt:Customer

relations:
  - { from: wt:Ticket, type: FOR_CUSTOMER, to: wt:Customer }
  - { from: wt:Customer, type: HAS, to: wt:Ticket }

actions:
  - id: wt:action.create_ticket
    operates_on: [wt:Ticket]
    requires: [identityResolved]
    maps_to_tools: [CREATE_TICKET]

metric_ids: [open_p1_count, sla_breach_rate]
```

**Content rules**

| Include | Do not include |
|---------|----------------|
| Entities (`wt:Customer`, `wt:Ticket`) | Customer instances |
| Allowed relations | Per-tenant KPI formulas |
| Action ids + preconditions | MCP JSON schemas (tools own those) |
| Taxonomy **axes** via `classified_by` | Six-level industry forks of Customer |
| Metric **ids** the module may request | SQL / dbt expressions |

Industry naming is a **label**, not a new type: `wt:Customer` stays; healthcare shows “Patient”.

`core` classes may set `prompt: false` (`wt:Location`, `wt:Party`, …) so compact prompts skip boilerplate.

---

## 2. Taxonomy format

Separate from ontology classes. Trees of **terms**, not entities.

```yaml
# ontology/taxonomy.yml
channel:
  terms: [voice, web, email, whatsapp]
ticket.priority:
  terms: [P1, P2, P3]
intent:
  terms: [billing_dispute, status_request, sales]
```

- Ontology: Ticket **may** be classified by `ticket.priority`.
- Semantic: metric `open_p1_count` **uses** dimension `ticket.priority`.
- Instance: `TK-4412` **is** `P1`.

---

## 3. How fetch works (select modules)

```python
from ontology.slice import fetch_ontology_slice

pack = fetch_ontology_slice(preset="cc.ai_support")
# or
pack = fetch_ontology_slice(modules=["identity", "interaction", "ticket"])

context = pack.as_prompt()                 # compact — inject every turn
debug   = pack.as_prompt(mode="verbose")   # legal dump; do not inject
```

**Algorithm**

1. Take `preset.modules` and/or caller `modules`.
2. Always add `core` (unless `include_core=False`).
3. Expand `depends_on` (e.g. `queue` pulls `workforce`).
4. Union classes, relations, actions, `metric_ids` → **legal slice**.
5. Apply `preset.prompt` allowlist → **prompt slice**.
6. Render compact text.

```text
catalog preset
    │
    ├─ modules[]     → legal union (tools / policy may use this)
    └─ prompt:       → what the LLM sees
         classes, actions, taxonomy, metrics, rules, route_table
```

**Two layers**

| Layer | What it is | Size |
|-------|------------|------|
| Legal slice | Full union of selected modules | Can be large |
| Prompt slice | Allowlisted types/actions/metrics | ~400–800 tokens |

Do not GraphRAG the YAML to decide the slice. Scenario may only add **metric ids already on the selected modules**.

---

## 4. What gets constructed as the prompt

Default `as_prompt()` (compact):

- Header: version, resolved modules, agent name, industry **labels**
- **Types** — id + short definition (no property lists)
- **Relations** — only if **both** ends are in the prompt types
- **Actions** — id + `requires` only (no tool essays)
- **Metrics** — ids this agent may call
- **Taxonomy** — only allowlisted axes + their terms
- **Route** — Super / L2 only
- **Rules** — 3–6 bullets from the preset

Example constructor for AI Support (`cc.ai_support`):

```yaml
modules: [core, identity, interaction, knowledge, ticket]
prompt:
  classes: [wt:Customer, wt:Contact, wt:Consent, wt:Conversation, wt:Intent, wt:KnowledgeArticle, wt:Ticket]
  actions: [identify, contact_enrich, get_organization_knowledge, create_ticket, get_ticket_status, handoff]
  taxonomy: [channel, intent, knowledge.module]
  metrics: [open_p1_count]
```

Inject under Role / Goal / Instructions:

```text
[Role / Goal / Instructions]
[pack.as_prompt()]                    ← ontology compact block
[Runtime: channel, conversationId]    ← not ontology
[Optional facets: open_p1_count=1]    ← after semantic fetch
```

Do **not** inject `pack.to_dict()`, raw module YAML, or verbose mode into the LLM. Field-level create/update shape lives on MCP tools.

Super (`cc.super`) gets a **map** (type ids + relations + route table), not Contact field lists. L3 executors get the chapter they execute.

---

## 5. Semantic layer — what it holds for metrics

The semantic layer is the **governed implementation** of ontology ids.

| Semantic content | Example |
|------------------|---------|
| Entity binds | `wt:Customer` → CDP API + `dbt.dim_customer` |
| Joins | Customer `HAS` Ticket on `cdpId` |
| Metric formula | `abandonment_rate = abandoned / offered` (once) |
| Dimensions | `abandonment_rate` → `[channel, queue]` |
| Time grain | hour / day / customer |
| Thresholds | tenant: abandonment warn at 8% |
| Synonyms | “drop-off” → `abandonment_rate` |
| PII / who may see | campaign bot cannot see `phone` |
| Lineage | `open_p1_count` ← ticketing fact table |

**Split**

- **dbt / MetricFlow** — certified warehouse metrics (one formula).
- **Tenant `semantic.yaml`** — live API binds, labels, policy, threshold overrides.
- **Ontology** — metric **id** + which **type** it is about + which **taxonomy axes** exist.

Do not store SQL in Neo4j or in the agent prompt.

Example registry row (semantic, not ontology):

```yaml
abandonment_rate:
  on: wt:Queue                 # ontology type
  dimensions: [channel, queue] # taxonomy / class ids
  grain: hour
  source: dbt.metric.abandonment_rate
```

---

## 6. How a metric is resolved (agent path)

Ontology **selects**. Semantic **computes**. Data **supplies the rows**.

```text
User: "What's WhatsApp abandonment?"
        │
        ▼
1. Ontology prompt
   - abandonment_rate is in this agent's metric list
   - whatsapp is a legal channel term
   - action = ask_semantic (not invent SQL)
        │
        ▼
2. Agent tool call
   ask_semantic_layer({
     metric: "abandonment_rate",
     dimensions: { channel: "whatsapp" }
   })
        │
        ▼
3. Semantic layer
   - id certified?
   - channel allowed on this metric?
   - whatsapp in taxonomy.channel?
   - run one formula + join
        │
        ▼
4. Result
   { metric, value: 18.2, unit: percent, dimensions: { channel: whatsapp } }
        │
        ▼
5. Agent reply (grounded in the tool result)
```

If the user asks for a dimension that is **not** on the metric (or not in taxonomy), semantic **rejects**. The agent must not invent a breakdown.

**Narrow agent (support bot)**  
Prompt only has `open_p1_count`. Ontology says Customer `HAS` Ticket, so the metric is meaningful. Semantic counts open P1 tickets for this `cdpId`. No `group_by` needed.

**Super**  
May **name** metric ids and route to `cc.reporting`. It should not calculate KPIs itself.

### Role of ontology in metric resolution

| Step | Ontology helps by |
|------|-------------------|
| Choosing the id | Prompt lists only legal `metric_ids` for this agent |
| Knowing the subject | `on: wt:Customer` / `wt:Queue` matches types in the slice |
| Knowing a filter is valid | `whatsapp` ∈ taxonomy `channel` |
| Knowing a metric applies | Relation Customer `HAS` Ticket → `open_p1_count` on this customer is coherent |
| Stopping hallucination | Agent cannot call `revenue_usd` if it is not in the slice |
| Same language everywhere | Hub, CC, dashboards all use `abandonment_rate` |

Ontology does **not** store the formula or the 18.2%, replace `get_metric_schema` / `ask_semantic_layer`, or guess dimensions.

Optional compact line if you want zero extra schema call:

```text
Metrics
- open_p1_count (wt:Customer) dims: ticket.category, channel
- abandonment_rate (wt:Queue) dims: channel, queue
```

Those dim names must still match the semantic registry and taxonomy ids.

---

## 7. Synonyms and alternate names

**Do not create a second class.** One id, many names.

| Layer | What to store |
|-------|----------------|
| Ontology | `wt:Ticket`, `wt:Customer` only |
| Industry pack | Default label: Patient / Client / Buyer |
| Tenant semantic | Synonyms + UI/LLM labels |
| Prompt | `labels: wt:Customer shown as Member` |

```yaml
# tenants/hospital_x/semantic.yaml
labels:
  wt:Customer: Member
  wt:Ticket: Case

synonyms:
  Patient: wt:Customer
  Client: wt:Customer
  Buyer: wt:Customer
  Prospect: wt:Customer
  Case: wt:Ticket
  Opp: wt:Deal
  drop-off: abandonment_rate
  abandon%: abandonment_rate
```

**Runtime**

1. User says “open cases”.
2. Synonym map → `wt:Ticket` (and `open_p1_count` if they asked a count).
3. Prompt already uses **Member/Case** so the model talks the tenant language.
4. Tools still send `wt:Ticket` / `open_p1_count`.

Meilisearch can index synonym strings **pointing at the id**. Execution always uses the id. Custom fields (e.g. `productInterest`) go on `wt:Customer` in **tenant extensions**, not a new ontology type.

---

## 8. Industry and business adaptability

Keep **one spine** and overlay. Do not fork `wt:Customer` per vertical.

```text
Same ontology ids
    │
    ├─ Industry pack     default labels + extra types (Appointment, KYC, Cart)
    └─ Tenant semantic   this hospital / this bank / Worktual dogfood
                         binds, synonyms, thresholds, enabled spokes
```

| Change | Where | Fork ontology? |
|--------|--------|----------------|
| Patient vs Buyer vs Account | Industry label + tenant synonym | No |
| Extra type (Appointment, Claim) | Industry module `EXTENDS` core | No |
| Extra ticket categories | Taxonomy branch under `industry` | No |
| MQL ≥ 40 vs ≥ 70 | Tenant metric threshold | No |
| Different CRM APIs | Tenant `binds` | No |
| HIPAA / consent scopes | Industry conditions + tenant policy | No |
| Totally new “Customer” model per vertical | — | **Don’t** |

**B2B / B2C / B2B2C** = policy + which relations you emphasize (Account, Contract vs Order), not three ontologies.

```yaml
# ontology/industry/healthcare.yml
labels:
  wt:Customer: Patient
  wt:Appointment: Appointment
```

```yaml
# tenants/acme_shop/semantic.yaml
industryPack: ecommerce
labels:
  wt:Customer: Buyer
metrics:
  mql: { threshold: { gte: 40 } }
```

Worktual-as-tenant is just another `semantic.yaml` (`saas_b2b`, Account/Prospect).

---

## 9. Semantic layer — registry (CC + Ticketing)

Certified **agent-facing** metric ids live in `semantic/metric_registry.yml`. Formulas stay in the existing MetricFlow YAML (do not copy them into ontology prompts).

| File | Role |
|------|------|
| `semantic/metric_registry.yml` | id, `on`, grain, source file, `source_metric` |
| `semantic/lookup.py` | `get_metric_schema(id)` / `is_certified(id)` |
| `semantic/dbt/ccaas/default/dbt/models/semantic_layer/semantic_layer.yml` | CC conversations, SLA, AHT, occupancy |
| `semantic/dbt/ticketing/default/dbt/models/semantic_layer/semantic_layer.yml` | Tickets, CSAT, resolution time |
| `tenants/org1000/semantic.yaml` | Tenant labels, synonyms, binds, thresholds (`org` + `organization_id`) |

**Certified ids in prompts today:** `abandonment_rate` (proxy: `missed_contact_rate`), `queue_depth` (`open_conversations`), `sla_breach_rate` (CC or TK source by grain), `containment_rate`, `aht`, `occupancy`, `callback_backlog`, `open_ticket_count`, `open_p1_count`, `average_csat_score`, `average_resolution_time_hours`, `reopen_rate`, `sla_at_risk_count`, `unanswered_ticket_count`.

Uncertified (`avg_sentiment`, `not_ready_rate`, `mql`) stay off `prompt.metrics`. CRM/Campaign MetricFlow files are **extension slots**.

```python
from semantic.lookup import get_metric_schema, is_certified

schema = get_metric_schema("open_p1_count")
# {id, certified, on, source, source_metric, ...}
```

Meilisearch indexes synonym strings pointing at the id. Execution always uses the id.  

---

## 10. Checklist

- New concept = new `wt:*` in a **module**, not a per-tenant class
- New agent = catalog **preset** + `prompt:` allowlist
- Inject `as_prompt()` compact only
- New KPI = semantic registry + `metric_ids` on the owning module + id on the agent `prompt.metrics`
- Dimensions = taxonomy / class ids, declared once in semantic
- Industry names = labels, not a second Customer type
- Synonyms = tenant semantic, execution always uses ids
