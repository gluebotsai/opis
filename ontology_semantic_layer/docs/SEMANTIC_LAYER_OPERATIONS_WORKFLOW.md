# Semantic Layer Operations Workflow

Operational playbook: add organizations, change metrics/dimensions, and configure agent allowlists.

**Architecture (why folders exist):** [SEMANTIC_LAYER.md](SEMANTIC_LAYER.md). **Ontology motive:** [ONTOLOGY.md](ONTOLOGY.md). Commands: [WORKFLOW.md](WORKFLOW.md).

---

## Architecture map

```
┌─────────────────────────────────────────────────────────────────┐
│  WAREHOUSE (Postgres mesh) — semantic/dbt/postgres/default/dbt/ │
│  campaign|crm|ccaas|ticketing staging + marts; shared spine     │
│  Rows filtered by organization_id at query time                 │
└────────────────────────────┬────────────────────────────────────┘
                             │ dbt run (dbt_run_all.py) + dbt parse
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  semantic/dbt/{product}/default/dbt/  (semantic-only package)   │
│    models/semantic_layer/semantic_layer.yml  ← SOURCE OF TRUTH  │
│      for metric formulas + MetricFlow dimensions                │
│    packages.yml → local postgres warehouse mesh                 │
└────────────────────────────┬────────────────────────────────────┘
                             │ scripts/generate_metric_registry.py
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  semantic/metric_registry.yml     (auto — certified metric ids) │
│  ontology/modules/metrics_*.yml   (auto — full metric id lists) │
│  semantic/metric_thresholds.yml   (auto — platform defaults)    │
│  semantic/catalog/{product}.yaml  (auto — SQL agent catalog)    │
└────────────────────────────┬────────────────────────────────────┘
                             │ manual edits
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  ontology/metric_policies.yml  ← dims, scope, when/not (GLOBAL) │
│  ontology/catalog.yml          ← agent allowlists (per preset)  │
│  ontology/agents.yml           ← agent → preset + extra modules │
│  tenants/org{id}/semantic.yaml ← labels, synonyms, binds        │
│  tenants/org{id}/org{id}_metrics.yaml ← thresholds only         │
└────────────────────────────┬────────────────────────────────────┘
                             │ API
                             ▼
   POST /v1/ontology/slice   → compact prompt (what agent may ask)
   POST /v1/semantic/query    → numbers + interpretation
```

---



## Context control plane (entitlements + packed metrics)

Per-request packing — **not** per-tenant dbt forks. Slice is UX; query is enforcement.


| What                                       | Where                                                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purchased SKUs, configured channels, features | **Accounts DB** via `[semantic/entitlements.py](../semantic/entitlements.py)` (`active_products`, `setup_channel_configs`) |
| User role / row scope | **Accounts DB** via `[semantic/scope.py](../semantic/scope.py)` (`setup_user_product_access`, `setup_roles`) |
| Labels, synonyms, thresholds               | `tenants/org{id}/semantic.yaml` and `org{id}_metrics.yaml` only                                                                                    |
| Metric gates (SKU, channel, feature, role) | `[ontology/metric_capabilities.yml](../ontology/metric_capabilities.yml)` + inference in `[semantic/capabilities.py](../semantic/capabilities.py)` |
| Single resolver                            | `[semantic/context.py](../semantic/context.py)` — used by slice (with `userId`) and query                                                          |


**Visible metrics** = certified ∩ agent preset ∩ tenant SKUs ∩ entitled channels/features ∩ `min_role`.

**Slice:** `POST /v1/ontology/slice` with `userId` + `product` → `metrics[]`, `entitlements`, clipped `taxonomy.channel`. Without `userId`, entitlements are returned but metrics are not packed.

**Query:** `POST /v1/semantic/query` always requires `userId`; rejects non-visible metrics; injects `channel IN (...)` for `channel_scoped` metrics when the caller omits channel filters.

**Hub:** `products[]` on `POST /v1/ontology/hub` is **intersected** with DB/YAML entitlements — the body cannot grant ticketing if not purchased.

**New tenant path:** insert org + subscriptions + channels in accounts; optional `tenants/org{id}/` for words/thresholds; no dbt clone. Local dev without DB: `ENTITLEMENTS_DEV_FALLBACK=1` or YAML `enabledSpokes` + `channels` on the tenant file.

**Postgres warehouse Mesh** (staging/marts merge): planned — see `[semantic/dbt/postgres/README.md](../semantic/dbt/postgres/README.md)`.

---



## The “one place” rule 


| What you want to change                | Primary file(s)                                           | Propagates via                                                     |
| -------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| **New metric formula**                 | `semantic_layer.yml` (+ mart SQL if needed)               | `generate_metric_registry.py` → registry + `metrics_*.yml` modules |
| **Platform thresholds**                | auto from registry                                        | `generate_metric_thresholds.py`                                    |
| **Allowed dimensions for a metric**    | `ontology/metric_policies.yml` → `dims:`                  | API validation in `semantic/query.py` + prompt lines               |
| **Which metrics an agent may use**     | `ontology/catalog.yml` → `presets.{agent}.prompt.metrics` | Slice allowlist → query rejection if not listed                    |
| **Org labels / synonyms / thresholds** | `tenants/org{id}/…`                                       | Read per request — no reload                                       |
| **Browse catalog (SQL agent)**         | auto                                                      | `generate_semantic_catalog.py`                                     |


**Agent allowlist = intersection of:**

1. Metrics from modules the agent loads (e.g. `metrics_ccass` — auto-generated, all certified CCaaS metrics), **and**
2. `prompt.metrics` in `catalog.yml` for that preset.

For an **existing** certified metric, you usually only edit `catalog.yml` for that agent. For a **brand-new** metric, start in `semantic_layer.yml`, run generators, then add to `metric_policies.yml` and `catalog.yml`.

Dimensions are **not per-agent** — they are **per-metric** in `metric_policies.yml` (with optional `products.ccaas:` overlay).

---



## 1. Add a new organization

You do **not** fork dbt or MetricFlow for a normal tenant. All orgs share `semantic/dbt/{product}/default/dbt`; rows are scoped by `organization_id`.

### Step 1 — Warehouse data

Ensure source tables and marts contain rows for the new `organization_id`. Then:

```bash
cd /home/vectone/Uday/ontology_semantic_layer
PYTHONPATH=. python3 scripts/dbt_run_all.py    # or product-specific run
PYTHONPATH=. python3 scripts/dbt_parse_all.py
```

(Optional) Per-tenant dbt override only if you create  
`semantic/dbt/{product}/tenant_{orgId}/dbt/` — most orgs use **default**.

### Step 2 — Tenant folder (required for slice + thresholds)

Naming rule: `tenants/org` **+** `organization_id`

Example for org `2005`:

```
tenants/org2005/
  semantic.yaml
  org2005_metrics.yaml   # optional but recommended
```

Copy from `tenants/org1000/semantic.yaml` or `tenants/org1008/semantic.yaml`:

```yaml
tenantId: org2005
organizationId: 2005
industryPack: saas_b2b          # or healthcare, ecommerce, etc.
enabledSpokes: [contact_centre, crm, hub, cdp]   # documentation
labels: { ... }                 # Prospect vs Patient, Case vs Ticket, etc.
synonyms: { ... }               # natural language → wt:* or metric ids
binds: { ... }                  # warehouse / live API bindings
```

Thresholds only (formulas stay in MetricFlow):

```yaml
# tenants/org2005/org2005_metrics.yaml
organizationId: 2005
metrics:
  missed_contact_rate:
    threshold: { warn_percent: 8, critical_percent: 15 }
  sla_breach_rate:
    threshold: { warn_percent: 5, critical_percent: 10 }
```



### Step 3 — Verify (no API reload needed for tenant files)

```bash
PYTHONPATH=. python ontology/slice.py -a cc.reporting --tenant org2005
PYTHONPATH=. python3 scripts/test_semantic_products.py   # if API live
```



### Step 4 — Query with new org

```json
{
  "organizationId": 2005,
  "userId": "<user in that org>",
  "product": "ccaas",
  "agent": "cc.reporting",
  "metrics": ["total_conversations"]
}
```

**You do not change** `catalog.yml`, `metric_policies.yml`, or registry for a new org unless you want different **agent** behavior (that is global, not per-tenant).

---



## 2. Add or remove a metric (platform-wide)



### A) Metric already exists in MetricFlow (e.g. add `sla_breach_rate` to reporting)

**Edit one place for agent access:**

```yaml
# ontology/catalog.yml → presets.cc.reporting.prompt.metrics
metrics:
  - total_conversations
  - sla_breach_rate   # add here
  # ...
```

**Reload API** (cached catalog):

```bash
export CONTEXT_RELOAD_SECRET=your-secret
./scripts/reload_context_layer.sh
```

Ensure the agent loads the metrics module (already true for `cc.reporting` via `ontology/agents.yml` → `modules: [metrics_ccass]`).

**Remove metric from agents:** delete the id from that preset’s `prompt.metrics` list → reload.

### B) Brand-new metric (does not exist yet)


| Step | Action                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------- |
| 1    | Add measure/metric + dimensions in `semantic/dbt/{product}/default/dbt/models/semantic_layer/semantic_layer.yml` |
| 2    | Update mart SQL if the metric needs new columns                                                                  |
| 3    | `dbt run` → `dbt parse` for that product                                                                         |
| 4    | `PYTHONPATH=. python3 scripts/generate_metric_registry.py`                                                       |
| 5    | `PYTHONPATH=. python3 scripts/generate_metric_thresholds.py`                                                     |
| 6    | Add entry in `ontology/metric_policies.yml` (`dims`, `scope`, `when`, `"on": wt:...`)                            |
| 7    | Add metric id to relevant presets in `ontology/catalog.yml`                                                      |
| 8    | `./scripts/reload_context_layer.sh`                                                                              |
| 9    | (Optional) `python3 scripts/generate_semantic_catalog.py` for SQL-agent catalog                                  |
| 10   | Smoke: `scripts/test_semantic_dim_resolve.py`, live query                                                        |


Step 4 auto-updates `ontology/modules/metrics_ccass.yml` (full certified list). Step 7 controls **which agents** actually see it.

---



## 3. Add or remove a dimension (existing metric)

Dimensions live in **two layers**:

1. **Physical** — must exist in `semantic_layer.yml` (MetricFlow semantic model).
2. **Agent-facing allowlist** — `ontology/metric_policies.yml` → `dims:`.



### Add dimension globally for a metric

```yaml
# ontology/metric_policies.yml
missed_contact_rate:
  dims: [channel, direction, queue_name, agent_name, priority]  # add priority
```

For product-specific overrides:

```yaml
sla_breach_rate:
  products:
    ccaas:
      dims: [channel, direction, queue_name, priority]
      scope: org
```

Then **reload API**.

### Remove dimension

Remove from `dims:` in `metric_policies.yml` → reload.  
(Leave it in `semantic_layer.yml` if other tools still need it.)

**There is no per-agent dimension list.** All agents using that metric get the same allowed dims. Agent-specific behavior is via **prompt rules** in `catalog.yml` (e.g. cc.reporting rules for `agent_name` vs `assigned_agent_name`).

---



## 4. Add or remove metric for a specific agent



### Metrics — edit `ontology/catalog.yml`

Find the preset via `ontology/agents.yml`:


| Agent id       | Preset key     |
| -------------- | -------------- |
| `cc.reporting` | `cc.reporting` |
| `cc.super`     | `cc.super`     |
| `cc.wfm`       | `cc.wfm`       |


```yaml
presets:
  cc.reporting:
    prompt:
      metrics: [total_conversations, handled_volume, ...]  # add/remove here
      rules:
        - "..."   # optional guidance for the LLM
```

Reload API after `catalog.yml` changes.

**Query enforcement** (`semantic/query.py`): metric must be in slice allowlist **and** certified in `metric_registry.yml`.

### Dimensions for one agent only

Not supported as a separate allowlist. Options:

- Tighten `dims` in `metric_policies.yml` for that metric (affects all agents), or
- Add a **prompt rule** in that preset telling the agent not to use certain dims, or
- Split metrics (e.g. assignment vs conversation grain) so different agents use different metrics.

---



## 5. Reload vs no reload


| Changed file                                            | Reload API?                                                |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| `tenants/org*/semantic.yaml`, `org*_metrics.yaml`       | **No**                                                     |
| `ontology/modules/*.yml` (auto-generated)               | **Yes** if you care about cache; often read fresh on slice |
| `ontology/catalog.yml`, `agents.yml`                    | **Yes**                                                    |
| `ontology/metric_policies.yml`, `metric_thresholds.yml` | **Yes**                                                    |
| `semantic_layer.yml` / dbt marts                        | **dbt parse** then **Yes**                                 |
| `.env` / Postgres host                                  | Restart API                                                |


```bash
export CONTEXT_RELOAD_SECRET=your-secret
./scripts/reload_context_layer.sh
# or restart:
./scripts/run_context_layer_api.sh
```

---



## Quick reference cheat sheet



### New org

```
1. Data in warehouse (organization_id)
2. dbt run + parse (if new data pipelines)
3. tenants/org{id}/semantic.yaml (+ org{id}_metrics.yaml)
4. Test slice + semantic query
```



### Expose existing metric to cc.reporting

```
catalog.yml → cc.reporting.prompt.metrics → reload
```



### New metric end-to-end

```
semantic_layer.yml → dbt run/parse
→ generate_metric_registry.py
→ generate_metric_thresholds.py
→ metric_policies.yml
→ catalog.yml (per agent)
→ reload
```



### Allow/disallow group_by on a metric

```
metric_policies.yml → dims → reload
(dim must exist in semantic_layer.yml first)
```



### Org-specific KPI warn/critical

```
tenants/org{id}/org{id}_metrics.yaml  (no reload)
```

---



## Ticketing attach (no-proxy contract)

Staff chat is **Super → Domain → Executor**. Context Layer keys allowlists on the **`agent` string in the HTTP body** — the worker sends **only its own runtime id** (registered in `ontology/agents.yml`), never a borrowed preset name.

| Endpoint | `agent` / `originAgent` | Purpose |
|---|---|---|
| `POST /v1/ontology/slice` | This worker's runtime id | Vocabulary (types, actions, headline metrics for LLM) |
| `POST /v1/semantic/query` | **Same** runtime id | Certified **numbers** only when `preset: tk.reporting` |
| `POST /v1/sql/query` | Lifecycle / tickets workers (`tk.tickets` preset) | **Rows** (list/search tickets, notes) — not KPIs |

**Rules**

- Slice `agent` = this worker's own name (must exist in `agents.yml`).
- Semantic `agent` = **the same name**; `product: ticketing`; `metrics[]` from that slice / reporting catalog.
- Only agents with `preset: tk.reporting` (e.g. `analytics_audit_query_executor`, `insights_analytics_executor`, `tiaa`) get the full certified pack **as themselves** — shared role, not a costume.
- Super, Domains, tickets, admin, proactive, teams, KB, macros, customers, portal: **no** metric allowlist; KPI questions must remount analytics.
- Counts never from SQL; rows never from semantic.
- **Headlines** (LLM prompt): 12 handoff KPIs on `tk.reporting`. **Leftovers** (83 ids in `ontology/metric_ownership.yml` `reporting_only.ticketing`): API-only on reporting agents, not in the prompt.

**Ticketing agents — semantic metrics (46 MAS workers, `asga` omitted)**

| Runtime agent | Semantic metrics | Reason |
|---|---|---|
| `ticketing_super_agent` | No | Routes only; remounts analytics for how-many |
| `intake_deflection_domain` | No | Plans create vs KB; does not query |
| `triage_routing_domain` | No | Plans classify / assign / workload |
| `resolution_lifecycle_domain` | No | Plans ticket work, not counts |
| `knowledge_domain` | No | Plans recommend / similar KB |
| `catalog_administration_domain` | No | May route to analytics; no metric pack |
| `analytics_audit_query_executor` | **Yes** | Dashboard / NL how-many / CSAT / SLA % |
| `insights_analytics_executor` | **Yes** | Same numbers; why → KG not semantic |
| `tiaa` | **Yes** | Scheduled insights (no chat bubble) |
| `ticket_creation_executor` | No | Create fields only |
| `ticket_lifecycle_executor` | No | List/update rows (SQL yes); not KPI counts |
| `ai_resolution_executor` | No | KB search / deflect |
| `classification_priority_executor` | No | Sets fields on one ticket |
| `intelligent_assignment_executor` | No | Picks assignee from roster |
| `workload_optimization_executor` | No | Uses Ticketing Home snapshot, not semantic pack |
| `root_cause_learning_executor` | No | Learning job; numbers via Super → analytics |
| `investigation_summary_executor` | No | Summary on one ticket |
| `sla_escalation_executor` | No | Escalates one ticket; not org SLA % |
| `customer_reply_drafting_executor` | No | Drafts reply text |
| `autonomous_resolution_executor` | No | Gated close/reopen |
| `resolution_quality_executor` | No | Close-out check, not CSAT aggregates |
| `personalized_notification_executor` | No | Staff bell |
| `resolution_knowledge_executor` | No | KB recommend for this ticket |
| `similar_ticket_detection_executor` | No | Similar rows, not counts |
| `team_queue_crud_executor` | No | Team/queue CRUD |
| `kb_quality_crud_executor` | No | KB author/publish |
| `macro_crud_executor` | No | Macro CRUD |
| `customer_directory_crud_executor` | No | Customer 360 read |
| `priority_status_crud_executor` | No | Priority/status catalog |
| `org_settings_integrations_executor` | No | Org prefs / integrations |
| `notification_inbox_executor` | No | Inbox read/clear |
| `automation_rule_crud_executor` | No | Automation CRUD |
| `tcaa` | No | Proactive twin of ticket creation |
| `dssa` | No | Proactive twin of AI resolution |
| `icpa` | No | Proactive twin of classify/prioritize |
| `itra` | No | Proactive twin of assignment |
| `wloa` | No | Proactive twin of workload (Home snapshot) |
| `rcaa` | No | Proactive twin of root-cause learning; never borrows reporting |
| `tsaa` | No | Proactive twin of investigation summary |
| `sema` | No | Proactive twin of SLA escalation |
| `crda` | No | Proactive twin of reply drafting |
| `ara` | No | Proactive twin of autonomous resolution |
| `rqa` | No | Proactive twin of resolution quality |
| `pna` | No | Proactive twin of notifications |
| `rkaa` | No | Proactive twin of resolution KB |
| `stda` | No | Proactive twin of similar-ticket detect |

**New Ticketing agent checklist**

1. Ticketing shares the **exact runtime string** they will send (e.g. `foo_executor`).
2. Add one row to `ontology/agents.yml`: `owned_product: ticketing`, `preset` = existing module (`tk.tickets`, `tk.reporting`, Domain preset, etc.).
3. Reload API (`CONTEXT_RELOAD_SECRET` or restart). Tenant YAML is not required.
4. They keep sending `agent: foo_executor` on every call — **never** `agent: tk.reporting` unless that worker is mapped to `preset: tk.reporting`.
5. Unknown names fail closed (`Unknown agent` / no metrics) — we do not auto-map to reporting.

See also: [ticketing_agents.md](ticketing_agents.md), [ticketing-agent-ontology-handoff.md](ticketing-agent-ontology-handoff.md).

---

## Common mistakes

1. **Editing only** `metrics_ccass.yml` — it is **auto-generated**; edit `semantic_layer.yml` and re-run `generate_metric_registry.py`.
2. **Adding metric to catalog but not policies** — query may work but prompt lacks `when`/dims; dim validation uses policies.
3. **Adding dim to policies but not MetricFlow YAML** — resolver returns 400.
4. **Expecting per-tenant metric lists** — tenants change **words and thresholds**, not certified metric sets.
5. **Forgetting reload** after `catalog.yml` / `metric_policies.yml` — API serves stale allowlists until reload.

---



## Smoke tests after changes

```bash
PYTHONPATH=. python3 scripts/test_semantic_dim_resolve.py
PYTHONPATH=. python3 scripts/test_metric_thresholds.py
PYTHONPATH=. python3 scripts/test_production_readiness.py
# Live (API on :8765):
PYTHONPATH=. python3 scripts/test_semantic_products.py
```

---



## Related docs

- [WORKFLOW.md](WORKFLOW.md) — architecture, file layers, overlay order
- [tenants/org1000/FETCH_EXAMPLES.md](../tenants/org1000/FETCH_EXAMPLES.md) — slice CLI examples
- [TRACEBACK.md](../TRACEBACK.md) — deployment history and ops commands

