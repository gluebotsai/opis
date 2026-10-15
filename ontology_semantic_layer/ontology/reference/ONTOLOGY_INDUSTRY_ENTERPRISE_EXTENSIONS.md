# Industry and enterprise extensions of the ontology

How to extend the **same** Contact Center spine for healthcare, BFSI, ecommerce, or a specific tenant — without forking `wt:Customer`. Covers format changes, dynamic fetch, and where **synonyms** live.

Related: [`../../docs/ONTOLOGY_AND_SEMANTIC_LAYER.md`](../../docs/ONTOLOGY_AND_SEMANTIC_LAYER.md), [`../catalog.yml`](../catalog.yml), [`../slice.py`](../slice.py).

---

## 1. Rule

```text
Platform ontology     shared, slow change     wt:Customer, wt:Ticket
        │
Industry pack         overlay                 labels + extra types + extra terms
        │
Enterprise / tenant   config                  synonyms, binds, thresholds, PII
```

- **Industry** = default language and extra concepts for a vertical.
- **Enterprise** = one customer’s names, APIs, and KPI cutoffs.
- Never create `wt:healthcare:Customer` as a second root. **Extend** or **label**.

B2B / B2C / B2B2C is a **business profile** (which relations you emphasize), not a separate ontology.

---

## 2. What changes in ontology format

Core module files stay as they are. Extensions are **additive files**, not edits to `wt:Customer`.

### 2.1 Industry pack (`ontology/industry/<pack>.yml`)

```yaml
pack: healthcare
extends_ontology: wt:cc
businessTypes: [b2c, b2b2c]

# How the LLM / UI should say the core type
labels:
  wt:Customer: Patient
  wt:Appointment: Appointment
  wt:Ticket: Case

# Extra types — must EXTENDS a core class
adds:
  - id: wt:healthcare:Provider
    extends: wt:Organization
    definition: Care delivery organization or clinician practice.
  - id: wt:healthcare:MRN
    extends: wt:Identity
    definition: Medical record number. type=mrn.

# Extra properties on existing types (not a new Customer)
extends:
  wt:Customer:
    additional_properties: [mrn, hipaaScope, primaryProvider]
  wt:Consent:
    additional_scopes: [treatment, recording, research]

# Extra taxonomy terms (same axis ids)
taxonomy_adds:
  ticket.category: [appointment, prescription, insurance]
  intent: [appointment_change, phi_request]

# Extra modules this industry may select
modules: [booking]          # Appointment already in booking.yml
```

**Allowed format changes**

| Allowed | Not allowed |
|---------|-------------|
| New file under `ontology/industry/` | Copy-paste of all of `core.yml` |
| `labels` on existing `wt:*` | New root `wt:Patient` replacing Customer |
| `adds` with `extends: wt:…` | Different `HAS` meaning per industry |
| `taxonomy_adds` on existing axes | New `ticket.priority` tree that drops P1 |
| Extra `metric_ids` on an industry module | Industry-specific formula in ontology |

Register the pack in catalog if you want it discoverable:

```yaml
# ontology/catalog.yml
industry_packs:
  generic: { file: industry/generic.yml }
  healthcare: { file: industry/healthcare.yml }
  bfsi: { file: industry/bfsi.yml }
  ecommerce: { file: industry/ecommerce.yml }
  saas_b2b: { file: industry/saas_b2b.yml }
```

### 2.2 Optional industry module

Only when the vertical needs **actions/types** the core spoke does not have:

```yaml
# ontology/modules/industry_healthcare.yml
module: industry_healthcare
depends_on: [core, identity, booking]
classes:
  - id: wt:healthcare:Provider
    extends: wt:Organization
actions:
  - id: wt:action.check_phi
    requires: [consent.treatment]
metric_ids: []
```

Select this module on agents that need it (`cc.booking`, `cc.ai_support` for a hospital tenant). Generic SaaS tenants never load it.

### 2.3 Enterprise does **not** change ontology format

A tenant does **not** get its own `wt:AcmeCustomer`. Enterprise files are **semantic config**:

```yaml
# tenants/hospital_x/semantic.yaml
tenantId: hospital_x
industryPack: healthcare
businessType: b2c

labels:                    # override industry defaults
  wt:Customer: Member      # they say Member, pack said Patient

synonyms:                  # see §5
  Patient: wt:Customer
  Member: wt:Customer
  Case: wt:Ticket

binds:
  wt:Customer:
    live: GET /cdp/v1/profiles/{cdpId}
    keys: [cdpId, mrn, email]

extensions:
  wt:Customer:
    mrn: { source: ehr.patient.mrn }

metrics:
  open_p1_count:
    threshold: { warn: 1, critical: 2 }
```

---

## 3. How it is fetched dynamically

Fetch is still **deterministic**: tenant config picks a pack + modules; resolver unions them; compact prompt applies **labels**.

```python
from ontology.slice import fetch_ontology_slice

# Tenant record (from DB / semantic.yaml), not from the user message
tenant = load_tenant("hospital_x")
# industryPack: healthcare
# extra_modules: ["industry_healthcare"]   # optional

pack = fetch_ontology_slice(
    preset="cc.ai_support",
    industry_pack=tenant.industryPack,          # already supported in slice.py
    modules=tenant.extra_modules or None,       # union with preset
)
context = pack.as_prompt()
# labels line: wt:Customer shown as Member  (tenant wins over industry)
```

**Resolution order for the name the LLM sees**

```text
1. ontology class id          wt:Customer
2. industry pack labels       Patient
3. tenant semantic labels     Member     ← wins
4. as_prompt() header         "wt:Customer shown as Member"
```

**Resolution order for types/actions in the slice**

```text
1. preset.modules + depends_on + core
2. + industry extra modules (if tenant.industryPack requires them)
3. + tenant.extra_modules (rare; prefer industry module)
4. preset.prompt allowlist (still filters what is shown)
```

If healthcare adds `wt:healthcare:Provider` but `cc.ai_support` prompt allowlist does not include it, the **legal** slice has it; the **compact prompt** does not until you add it to that tenant’s agent allowlist (or a healthcare-specific preset).

**Suggested tenant-aware fetch**

```text
load tenant
  → industryPack, businessType, extra_modules, labels, synonyms
fetch_ontology_slice(preset, industry_pack, modules=extra)
  → apply tenant.labels on top of pack.labels
inject as_prompt()
keep synonyms for the semantic/resolver (not the full synonym list in the LLM)
```

`industry_pack` today loads `ontology/industry/<pack>.yml` labels in [`ontology/slice.py`](ontology/slice.py) (`_labels`). Tenant label override and extra-module union are the next hook (tenant file not loaded by `slice.py` yet).

Do **not** pick the industry pack with GraphRAG from the user sentence. The **org record** already knows the industry.

---

## 4. How to handle it in practice

| Situation | What you do |
|-----------|-------------|
| New vertical (e.g. BFSI) | Add `industry/bfsi.yml` (labels + taxonomy_adds + optional module) |
| New hospital customer | `tenants/{id}/semantic.yaml` with `industryPack: healthcare` + their synonyms |
| They say “Member” not “Patient” | Tenant `labels` override |
| They need MRN | `extends.wt:Customer` + bind `keys: [mrn]` |
| They need a new KPI | Semantic registry + add metric id to agent `prompt.metrics` |
| They need a new *kind of thing* | Industry `adds` with `extends`, or new module — RFC if it is cross-industry (put in core) |

**Agent builder**

1. Pick preset (`cc.ai_support`).
2. Tenant supplies `industryPack` automatically.
3. Compact prompt shows their labels.
4. L3 specialists unchanged except extra allowlisted types if required.

**Business type**

```yaml
businessType: b2b
# emphasize Organization, Contact, Contract in prompt allowlist
# B2C: emphasize Person → Customer → Order-like tickets
```

Same ids; optional second preset (`cc.ai_support.b2b`) only if the **prompt allowlist** differs, not the ontology.

---

## 5. Where synonyms are handled

**Synonyms are not ontology classes.** They live in the **enterprise semantic layer** (and optionally Meilisearch as a phone book).

| Store | Job |
|-------|-----|
| `ontology/industry/*.yml` `labels` | Default display name for a vertical |
| `tenants/{org}/semantic.yaml` `labels` | What this enterprise wants in the prompt |
| `tenants/{org}/semantic.yaml` `synonyms` | Incoming words → `wt:*` or metric id |
| Meilisearch | Search “case / drop-off” → **id**; never pick the metric by RAG alone |
| Compact prompt | Only the **winning label**, not the whole synonym list |

```yaml
# tenants/hospital_x/semantic.yaml
synonyms:
  # entity
  Patient: wt:Customer
  Member: wt:Customer
  Client: wt:Customer
  Case: wt:Ticket
  Encounter: wt:Interaction
  # metric
  drop-off: abandonment_rate
  abandon%: abandonment_rate
  urgent cases: open_p1_count
```

**Resolver (before or beside the LLM)**

```text
User: "How many urgent cases does this member have?"
  synonym: member → wt:Customer
  synonym: urgent cases → open_p1_count
  ontology: Customer HAS Ticket; open_p1_count allowed on cc.ai_support
  semantic: compute open_p1_count for cdpId
```

The ontology prompt still says `wt:Customer` / `wt:Ticket` as **ids** and `shown as Member` / `Case`. Tools always use ids.

Do **not** put 50 synonyms in the Super prompt. Put them in the synonym map + optional Meili index.

---

## 6. Dynamic fetch end-to-end

```text
Request (org=hospital_x, agent=cc.ai_support)
        │
        ▼
Tenant semantic
  industryPack=healthcare
  labels.wt:Customer=Member
  synonyms.Case=wt:Ticket
        │
        ▼
fetch_ontology_slice(
    preset="cc.ai_support",
    industry_pack="healthcare",
  )
        │
        ├─ modules: core + identity + interaction + knowledge + ticket
        ├─ industry labels: Patient → then tenant override Member
        └─ as_prompt() compact
        │
        ▼
Agent context
  labels: wt:Customer shown as Member, wt:Ticket shown as Case
  types/actions/metrics from preset.prompt
        │
        ▼
User says "case" → synonym → wt:Ticket → same slice
```

Industry pack without a tenant file: use pack labels only (`industry_pack="healthcare"`).  
Generic SaaS: `industry_pack="generic"` or `saas_b2b`.

---

## 7. Checklist

- New industry = new `ontology/industry/<pack>.yml`, not a fork of `core.yml`
- Extra concepts = `extends` / extra module, still `wt:*` lineage
- New enterprise = tenant semantic only (labels, synonyms, binds, thresholds)
- Fetch = `preset` + `industry_pack` + tenant extras; never GraphRAG the pack
- Synonyms = tenant semantic (+ Meili as index); prompt gets one label
- Tools and metrics always use ontology / metric **ids**

---

## 8. Adding another product (CRM / Campaign) later

CC + Ticketing share `wt:Customer` and `wt:Ticket`. CRM and Campaign are **catalog extension slots** — empty on purpose.

When CRM lands:

1. Add `ontology/modules/crm_*.yml` with classes that **extend** core (`wt:Deal extends wt:WorkItem`), never `wt:crm:Customer`.
2. Register modules + `crm.*` presets in `ontology/catalog.yml`. Set `products.crm.status` from `extension_slot` to `active`.
3. Point certified metrics at `semantic/dbt/crm/default/dbt/models/semantic_layer/semantic_layer.yml` via `semantic/metric_registry.yml`. Do not copy MetricFlow formulas into ontology YAML.
4. Tenants opt in with `extra_modules` and `enabledSpokes`. Worktual dogfood currently enables CC, Ticketing, Hub only.

Same path for Campaign. Do **not** invent usage-meter KPIs not backed by MetricFlow models.

