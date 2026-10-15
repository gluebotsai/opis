# Fetched prompts — org1000 (`saas_b2b` + organization_id=1000)

Tenant folder naming: **`org` + `organization_id`** → `org1000` maps to `accounts.organizations.id = 1000`.

## Python

```python
from ontology.slice import fetch_ontology_slice

# Preset + tenant
pack = fetch_ontology_slice(preset="cc.ai_support", tenant="org1000")
print(pack.as_prompt())

# Agent index (no preset per agent required)
pack = fetch_ontology_slice(agent="crm.deals", tenant="org1000")
pack = fetch_ontology_slice(agent="camp.reports", tenant="org1000")
pack = fetch_ontology_slice(agent="tk.tickets", tenant="org1000")
```

## CLI

```bash
cd /path/to/ontology_semantic_layer
PYTHONPATH="." python ontology/slice.py -p cc.ai_support --tenant org1000
PYTHONPATH="." python ontology/slice.py -a crm.deals --tenant org1000
PYTHONPATH="." python ontology/slice.py -a camp.reports --tenant org1000
PYTHONPATH="." python ontology/slice.py -p tk.super --tenant org1000
```

## Overlay order

1. Module union (+ `depends_on`, `core` always).
2. Industry pack (`saas_b2b` from tenant) — labels + extra taxonomy (healthcare: Patient; ecommerce: Buyer).
3. Tenant `tenants/org1000/semantic.yaml` — **Prospect** label, type **synonyms** (Case → wt:Ticket), binds.
4. Org metrics `tenants/org1000/org1000_metrics.yaml` — **thresholds only** (base formulas stay in MetricFlow).

Two CCaaS tenants differ by `industryPack` in their tenant folder (e.g. `healthcare` vs `ecommerce`), not by forking `wt:Customer`.

## Org metric thresholds

```yaml
# tenants/org1000/org1000_metrics.yaml
metrics:
  open_tickets_metric:
    threshold: { warn: 25, critical: 60 }
```

Compact prompt includes `group_by/filter`, `when`, and `threshold` for allowlisted metrics.
