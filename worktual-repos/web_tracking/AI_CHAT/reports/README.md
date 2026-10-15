# Web Tracking reports domain agent (ticketing blueprint)

Adapted from the ticketing product team pack at `ticketing_architechure/`:

| Ticketing | Web Tracking co-worker |
|-----------|-------------------------|
| `reports_analytics_domain` | `reports/domain/agent.md` |
| `sql_analytics_executor` + `run_sql` / `run_kpi` (PostgreSQL) | `reports/semantic_executor/agent.md` + `run_semantic` / `run_kpi` (ClickHouse + Context Layer) |
| `rpt.*` virtual views | Ontology slice + certified semantic metrics |
| `product/kpis.yml` + `product/sql/*.sql` | `product/kpis.json` + `shared/analytics_metrics.py` (ClickHouse) |
| Domain synthesizes from `RESULT:` fact blocks | Same pattern in `app/reports/` |

Runtime entry: `app/reports/orchestrator.py` (called from `app/mas/turn.py` for analytics turns).
