# semantic/dbt — layout at a glance

| Folder | SQL (warehouse) | Semantic YAML (MetricFlow) | Notes |
|--------|-----------------|----------------------------|-------|
| **postgres/** | Yes — all Postgres staging + marts + shared time spine | No | Run `dbt_run_all.py` here |
| **ccaas/** | No (uses postgres package) | Yes | Parse → CCaaS manifest |
| **crm/** | No | Yes | Parse → CRM manifest |
| **campaign/** | No | Yes | Parse → Campaign manifest |
| **ticketing/** | No | Yes | Parse → Ticketing manifest |
| **webtracking/** | Yes (ClickHouse) | Yes | Separate engine — not in postgres mesh |

Full explanation: [docs/SEMANTIC_LAYER.md](../../docs/SEMANTIC_LAYER.md).
