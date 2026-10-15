# reports_analytics_agent_ticketing_v2 — every file

This pack answers ticketing questions.

- **SQL** = Postgres warehouse (`rpt.*` views, certified KPIs).
- **KG** = Neo4j graph (Cypher).
- **Both** = Domain, facts, or shared Python used on either path.

```
User question
    → Domain
        → SQL executor  or  KG executor
        → Python guards
        → facts
    → Domain briefing
```

The chat runner that calls this pack is `ticketing/turn.py` under the Streamlit app folder (outside this pack).

---

## Root

| File | Kind | What it is |
|------|------|------------|
| `__init__.py` | Both | Package entry: exports `run_kpi`, `run_sql`, `run_cypher`, facts, time, loop. |
| `HOW_THE_FILES_WORK.md` | Both | This guide. |

---

## Agents (prompts)

| File | Kind | What it is |
|------|------|------------|
| `domain/agent.md` | Both | Plans tasks (KPI + dimension, or graph path). Writes the English briefing from facts. Never writes SQL or Cypher. |
| `sql_executor/agent.md` | SQL | Writes `run_kpi` or `run_sql` against `rpt.*`. |
| `kg_executor/agent.md` | KG | Writes Cypher (`MEMBER_OF`, `ROUTED_TO`, notes, …). Org-wide staffing needs no queue name; ticket/note paths need a name. |

---

## Skills

| File | Kind | What it is |
|------|------|------------|
| `skills/analytics-kpi-query/SKILL.md` | SQL | How to ask for a certified KPI. |
| `skills/analytics-count-breakdown/SKILL.md` | SQL | How to ask for a count split (GROUP BY). |
| `skills/analytics-report-list/SKILL.md` | SQL | How to list/find rows with free SQL. |
| `skills/analytics-export/SKILL.md` | SQL | How to shape export-style results. |
| `skills/analytics-threshold-check/SKILL.md` | SQL | How to compare a KPI to tenant thresholds. |
| `skills/analytics-graph-path/SKILL.md` | KG | How to walk staffing, notes, neighborhood, why-paths. |

---

## Product — SQL catalog

| File | Kind | What it is |
|------|------|------------|
| `product/product.yml` | SQL | Product id, Postgres engine, UTC defaults, CDP/hub pointers. |
| `product/schema.yml` | SQL | Virtual `rpt.*` views and every exposable column’s meaning. |
| `product/access.yml` | SQL | Admin / agent / resolver grants, scopes, masks. |
| `product/kpis.yml` | SQL | Certified metrics: `answers`, `not`, `grain`, allowed dimensions. |
| `product/dimensions.yml` | SQL | GROUP BY dictionary (`status`, `queue`, `day`, …) and user words. |
| `product/examples/sql.yml` | SQL | Few-shot SELECT shapes for the SQL executor. |
| `product/catalog.yml` | SQL | Older table catalog. Superseded by `schema.yml`; kept for compatibility. |

---

## Product — SQL KPI templates (`product/sql/`)

Each file is **SQL**. One certified template. Name = KPI id.

| File | What it measures |
|------|------------------|
| `_base_ticket.sql` | Shared ticket grain CTE inlined into other KPIs (not a KPI itself). |
| `ticket_count.sql` | How many tickets. |
| `avg_tickets_per_day.sql` | Tickets created per UTC day. |
| `avg_open_ticket_age.sql` | Average age of tickets with status Open. |
| `days_since_last_ticket.sql` | Days since the latest ticket was created. |
| `resolution_rate.sql` | Share of tickets that are Resolved or Closed. |
| `assignment_rate.sql` | Share of tickets assigned at least once. |
| `reopen_count.sql` | Count of tickets currently Reopened. |
| `reopen_rate.sql` | Reopened among finished / reopened. |
| `escalation_rate.sql` | Share of tickets that were escalated. |
| `reassignment_rate.sql` | Share of assigned tickets assigned more than once. |
| `avg_first_response_time.sql` | Average hours to first response. |
| `avg_resolution_time.sql` | Average hours created → resolved. |
| `avg_resolution_variance_vs_sla.sql` | Average hours resolved minus due. |
| `first_response_sla_compliance.sql` | Share of first-response SLAs met. |
| `resolution_sla_compliance.sql` | Share of resolution SLAs met. |
| `sla_breach_rate.sql` | Share of resolution SLAs missed. |
| `first_response_at_risk_count.sql` | Tickets close to missing first-response SLA. |
| `resolution_at_risk_count.sql` | Tickets close to missing resolution due. |
| `no_sla_count.sql` | Tickets with no resolution due. |
| `queues_at_risk.sql` | Per-queue count of resolution-at-risk tickets. |
| `average_overdue_hours.sql` | Average hours past due. |
| `avg_csat.sql` | Average CSAT 1–5. |
| `csat_response_rate.sql` | Share of completed tickets with a CSAT score. |
| `csat_distribution_rate.sql` | Promoter / neutral / detractor mix. |
| `customers_served.sql` | Distinct customers on tickets. |
| `accounts_served.sql` | Distinct contact profiles on tickets. |
| `active_customers.sql` | Distinct customers with Active profiles. |
| `total_customers.sql` | CDP people with the ticketing product. |
| `active_agents.sql` | Staff with role agent and status Active. |
| `total_users.sql` | All staff rows. |
| `queue_count.sql` | How many queues. |
| `queue_coverage.sql` | Queue membership row count. |
| `distinct_agents_in_queues.sql` | Distinct people on at least one queue. |
| `distinct_queues_covered.sql` | Distinct queues that have a member. |
| `note_count.sql` | How many notes. |
| `escalation_count.sql` | How many escalate events. |
| `reassignment_count.sql` | How many second-or-later assign events. |
| `kb_article_count.sql` | Published KB articles. |
| `kb_views.sql` | Sum of KB view counters. |
| `recommendation_count.sql` | AI recommendations. |
| `recommendation_acceptance_rate.sql` | Share of recommendations accepted. |
| `approval_count.sql` | AI approval rows. |
| `approval_rate.sql` | Share of decided approvals that were approved. |
| `unread_notifications.sql` | Unread in-app notifications. |

---

## Product — KG catalog (`product/kg/`)

| File | Kind | What it is |
|------|------|------------|
| `schema_registry.json` | KG | Allowed labels, relationships, properties (`properties_by_label`). |
| `product_edges.yml` | KG | Allowed hops, e.g. Ticket-ROUTED_TO-SupportQueue, Agent-MEMBER_OF-Queue. |
| `examples/cypher.yml` | KG | Worked MATCH queries (staffing named + all queues, notes, neighborhood). |
| `measures.yml` | KG | Named graph jobs: neighborhood, why, assignment, staffing, notes, customer. |
| `concept_cards.json` | KG | When to use which graph path. |
| `neo4j.yml` | KG | Neo4j URI, user, org database prefix (`org1012`). |
| `ontology_base.ticketing.json` | KG | Older ontology dump. Live allowlist is `schema_registry.json`. |

### Certified Cypher templates (`product/kg/cypher/`)

Each file is **KG**.

| File | What it is |
|------|------------|
| `ticket_neighborhood.cypher` | One ticket plus queue, assignee, resolver, SLA, notes. |
| `assignment_path.cypher` | Ticket → queue (`ROUTED_TO`) and assignee (`ASSIGNED_TO`). |
| `staffing_path.cypher` | Who sits on queues (`MEMBER_OF`). Queue name optional. |
| `note_path.cypher` | Notes on a ticket and who wrote them (`HAS`, `WRITTEN_BY`). |
| `customer_path.cypher` | Ticket → Contact (`raised_by`). |
| `why_breakdown.cypher` | Ticket counts split using graph hops. |

---

## Tenant overlay

| File | Kind | What it is |
|------|------|------------|
| `organizations/org_1012/tenant_thresholds.yml` | Both | Org 1012 thresholds only. Does not add or drop KPIs. |

---

## Python — `core/`

| File | Kind | What it is |
|------|------|------------|
| `__init__.py` | Both | Core package marker. |
| `loader.py` | Both | Loads YAML/JSON into one catalog. |
| `context.py` | Both | Builds KPI meaning index, dimension glossary, rpt column book, KG schema brief. |
| `time.py` | Both | Turns “last 7 days” / dates into UTC `[start, end)`. |
| `resolve.py` | Both | Turns names into ids (queues, people) in Python. |
| `templates.py` | SQL | Fills `{{dimension_select}}` / slots from `dimensions.yml`. |
| `views.py` | SQL | Turns `rpt.tickets` into a role-scoped CTE. |
| `sql_guard.py` | SQL | Parses SQL, allowlists views/columns, binds parameters. |
| `run_kpi.py` | SQL | Fills a certified KPI template and runs it. |
| `run_sql.py` | SQL | Guards and runs free SELECT. |
| `db.py` | SQL | Postgres fetch. |
| `access.py` | SQL | Role and scope checks. |
| `cypher_validate.py` | KG | Parses Cypher; checks labels and hops. |
| `cypher_guard.py` | KG | Read-only, allowlist, LIMIT, role params. |
| `run_cypher.py` | KG | Guards and runs Cypher. |
| `kg_client.py` | KG | Neo4j driver (org database). |
| `facts.py` | Both | Turns result rows into the fact block Domain reads. |
| `grounding.py` | Both | Briefing figures must appear in the facts. |
| `analysis.py` | Both | Simple arithmetic on result numbers. |
| `examples.py` | Both | Picks few-shot SQL/Cypher examples for the executor. |
| `loop.py` | Both | One repair, one Domain re-plan, then stop. |
| `errors.py` | Both | Public error messages (no internals leaked). |
| `thresholds.py` | Both | Loads tenant threshold numbers. |
| `validate.py` | Both | Pack self-check: KPI/SQL pairing, views, guards, time. |

---

## Where to change what

| I want to… | File |
|------------|------|
| Add or fix a warehouse metric | `product/kpis.yml` + `product/sql/<id>.sql` |
| Expose a warehouse column | `product/schema.yml` + `product/access.yml` |
| Fix GROUP BY (status / team / day) | `product/dimensions.yml` + KPI `allowed_dimensions` |
| Allow a new graph hop | `product/kg/schema_registry.json` + `product/kg/product_edges.yml` |
| Change staffing Cypher | `product/kg/examples/cypher.yml` + `kg_executor/agent.md` |
| Change which KPI Domain picks | KPI `answers`/`not` in `kpis.yml` + `domain/agent.md` |
