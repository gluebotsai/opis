# Enterprise context layer for agents

A deterministic way to give every agent only the meaning, labels, and metric names it is allowed to use — without stuffing the warehouse, the full graph, or live customer rows into the prompt.

| | |
|---|---|
| **Meaning** | Ontology — types, relations, actions |
| **Class** | Taxonomy — term trees, not entities |
| **Compute** | Semantic — fetch, name, calculate, govern |

**The split.** Ontology answers “what exists and what may I do.” Taxonomy answers “which bucket is this.” Semantic answers “how do I get the number / the row for this tenant.” Instance facts (this person, this ticket id) never live in the ontology.

---

## Three layers of meaning

### Ontology

Shared product language. Slow to change. Stable ids.

- **Holds:** classes, allowed relations, actions + preconditions, metric ids
- **Not:** SQL, MCP argument lists, customer rows, KPI formulas

### Taxonomy

Classification trees attached to classes.

- **Holds:** channel, intent, priority, status — term ids
- **Not:** a new class per term (no class named P1)

### Semantic

Tenant-aware fetch and governance.

- **Holds:** certified metric map, binds, synonyms, thresholds, labels
- **Not:** a second Customer type; GraphRAG as the KPI picker

---

## One spine, overlays — never fork the root

Healthcare says Patient, a bank says Client, a SaaS tenant says Prospect. The type stays `Customer`. Industry packs add labels and extra terms. The enterprise file adds synonyms, API binds, and cutoffs.

| Layer | Who owns it | What changes | What must not change |
|-------|-------------|--------------|----------------------|
| Platform ontology | Product / platform | New shared types and actions | Per-tenant class names |
| Industry pack | Vertical | Labels, extra terms, extra properties | A second root Customer |
| Enterprise semantic | Tenant | Synonyms, binds, thresholds, PII | Ontology ids |

---

## Agents do not load the whole graph

Modules are Lego packs (identity, ticket, queue, …). An agent is a **preset**: which modules, plus a compact allowlist of types, actions, and metric ids. Fetch expands dependencies, unions the legal slice, then filters to the prompt.

| Legal slice | Prompt slice |
|-------------|--------------|
| Union of selected modules + `depends_on` + core. Tools and policy may validate against this. The model does not see all of it. | Preset allowlist, rendered compact, injected every turn. Super / Hub: a map, not a dump. Specialist: a thin chapter. Verbose is debug only. |

---

## What the model sees vs what the system does

| In the prompt | Resolved elsewhere |
|---------------|-------------------|
| Type ids + one display label | Live profile / ticket from CDP or API |
| Allowed actions + requires | MCP tool schemas and field order |
| Metric ids only | Formulas, dimensions, warehouse SQL |
| Taxonomy term ids on this slice | Synonym index (Case → Ticket) |

---

## Runtime path

```text
utterance  →  synonym → id  →  in this slice?  →  tool or metric
```

Example: “urgent cases for this prospect” → Ticket + `open_p1_count`, labels Prospect/Case, compute from the certified metric, not from the model guessing SQL.

---

## When something is new

| Change | Where it goes |
|--------|----------------|
| New agent, same types and actions | Preset in the catalog. Fetch existing modules. No new ontology file. |
| New kind of thing or action | Module YAML (edit the domain pack, or add a pack). Stable id. |
| New KPI | Semantic registry + metric id on the owning module + id on the preset allowlist. |
| New customer wording | Tenant synonyms and labels. Do not mint a new class. |
| New product spoke later | New modules that extend the spine. Same Customer. Same Ticket if it is the same issue. |

---

## Hard rules

- Git YAML is source of truth. Optional graph copy is for browsing, not for picking modules or KPIs.
- Do not GraphRAG the ontology to decide what an agent may know.
- Do not put formulas, thresholds, or SQL in the agent prompt.
- Do not invent instance facts; load them through binds and tools.
- One Customer. One Ticket across products that share the same issue. Never fork the root for an industry or a tenant.

This is a general pattern. The current checkout applies it to contact centre + ticketing with industry and tenant overlays.
