# Ticketing CL parity triage (org 1012) — Sep 20

Source report: [ticketing-mas-context-layer-check-report.md](./ticketing-mas-context-layer-check-report.md)

Mart spot-check (live PG, org `1012`):

| Flag / grain | Count |
|---|---:|
| total tickets | 1503 |
| `is_open` (status=Open) | 2 |
| `is_pending` (non-closed) | 906 |
| `is_closed` | 597 |
| status=Closed only | 274 |
| `is_breached_proxy` | 781 |
| `is_overdue` | 898 |
| distinct `account_id` | **0** (all null — B2C) |
| distinct `customer_id` | 1000 |
| approvals all / last7d | 1357 / 1357 (all recent) |
| customer notes all / last7d | 158 / 158 |

## Tags

| Metric family | Tag | Notes |
|---|---|---|
| `active_tickets_metric` | **DEFN_FIX** | SoT now `is_pending` (was `is_open` → 2). Expect ~906. |
| `open_tickets_metric` | KEEP | Still literal Open (=2). |
| `closed_tickets_metric` | ORACLE_BUG | CL `is_closed`=597 correct; MAS DB 274 = status Closed only. |
| `breached_tickets_metric` | ORACLE_BUG | CL `is_breached_proxy`; MAS 898 ≈ overdue count. |
| `accounts_served` | DATA_OK | 0 is correct for B2C org with null `account_id`. Use `customers_served`. |
| `customers_served` | COVERAGE | Template exists; certify via matrix. |
| `average_open_ticket_age_days` | ORACLE_BUG | MAS DB used open **counts**, not age. |
| `average_overdue_hours` | ORACLE_BUG | MAS DB used overdue **counts**. |
| `csat_score_total` | ORACLE_BUG + FIX | SUM vs MAS average; today now `default_zero` → 0. |
| `average_csat_score` × `agent_name` | **FIXED** | Alias `agent_name`→`assignee_name`; template group_by. |
| `approval_volume` / `customer_reply_volume` time | DATA_OK | All rows within last 7d on this org; today filter works. |
| `audit_event_volume` vs ticket counts | ORACLE_BUG | MAS compared events to ticket volume. |
| `average_tickets_per_day` | **FIXED** | Was raw ticket count; now tickets÷distinct days. |
| Boolean / `status_display_name` group_by | **FIXED** | Template path returns full buckets; compare sum≠first-bucket. |
| `last_7d` / `last_30d` periods | **FIXED** | Aliased in `time_resolver` (were ignored → no window). |
| Rates / UNMAPPED (334) | COVERAGE | Certified templates exist; external harness lacked DB SQL. |
| Alphabet after `due_today_*` | COVERAGE | Run full matrix (`audit_ticketing_semantic_matrix.py`). |

## Fixes shipped in this pass

1. `active_ticket_count` → `is_pending` + template regen  
2. `average_tickets_per_day` true average  
3. `last_7d` / `last_30d` time aliases  
4. `agent_name` ↔ `assignee_name` aliases + CSAT policy dims  
5. Ticketing SQL templates allow `group_by` (full series)  
6. Postgres org/`{{extra_where}}` param binding (double-org + orphan mustache)  
7. `csat_score_total` `default_zero`  
8. In-repo matrix: `scripts/audit_ticketing_semantic_matrix.py`  
9. Oracle contract: [ticketing-mas-oracle-contract.md](./ticketing-mas-oracle-contract.md)

## Deploy note

Restart Context Layer process on `192.168.11.25:8765` (or local) to load code + regenerated templates. In-process execute already validates the fixes.
