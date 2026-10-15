# Postgres warehouse Mesh

Single dbt project for **staging + marts** across CCaaS, CRM, ticketing, campaign, and shared spine.

**Semantic MetricFlow YAML stays in per-domain packages** (`semantic/dbt/ccaas`, `crm`, `ticketing`, `campaign`, `cdp`) — one manifest per engine, not one mega graph.

## Layout

```
semantic/dbt/postgres/default/dbt/
  dbt_project.yml
  models/
    shared/              # metricflow_time_spine
    campaign/staging|marts/
    crm/staging|marts/
    ccaas/staging|marts/
    ticketing/staging|marts/
```

Domain semantic packages declare:

```yaml
# packages.yml
packages:
  - local: ../../../postgres/default/dbt
```

## Migration status

**Complete (2026-09-11):** warehouse SQL moved from legacy per-product trees. Domain projects are semantic-only (`models/semantic_layer/`).

## Run / parse

```bash
PYTHONPATH=. python3 scripts/dbt_parse_all.py          # postgres first, then semantic packages
PYTHONPATH=. python3 scripts/dbt_run_all.py           # warehouse mesh (tag-based)
PYTHONPATH=. python3 scripts/dbt_run_all.py --select ccaas --marts-only
```

Deployed schemas are unchanged (`ccass_marts_aiccaas`, `crm_marts`, etc.) via explicit `+schema` in `dbt_project.yml` and `macros/generate_schema_name.sql`.
