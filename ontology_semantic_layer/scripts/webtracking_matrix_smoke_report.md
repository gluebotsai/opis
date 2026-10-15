# Webtracking matrix smoke + cost (Commit 7)

**Date:** 2026-09-20  
**Script:** `scripts/smoke_webtracking_tenant_matrix.py` (loads pairs from `mart_web_sites` at runtime)

## Tenant matrix (entitled)

| organization_id | website_id | session_rows |
|---|---|---|
| 1003 | 1001 | 266 |
| 1012 | 1011 | 17 |

(Org `1` / site `1001` appears in raw session marts but is **not** in `mart_web_sites` — not entitled.)

## Gates

| Gate | Result |
|---|---|
| Cross-tenant (1003 + site 1011) | `website_not_entitled` |
| Smoke metrics × week/month/overall × both pairs | 32 rows, **0 errors**, `source=sql_template` |
| `unique_visitors` + `device=mobile` | 200 / ok both pairs |
| `online_visitors` | 200 / 0 when no live visitors |
| Template sync | pass |
| CH refs (1003/1001) | 21/21 pass |
| Hardcoded tenant ids in app (`semantic/` `api/` `ontology/` excl. tests/scripts/dbt target/logs) | **empty** |

## Cost (largest pair 1003/1001)

| metric | period | value | wall_s | note |
|---|---|---|---|---|
| unique_visitors | overall | 121 | ~4.0 | ~266 session rows; budget OK for audit tenants |
| unique_visitors | month | 92 | ~4.3 | calendar month (flag off) |

Full JSON: `scripts/webtracking_matrix_smoke_report.json`.
