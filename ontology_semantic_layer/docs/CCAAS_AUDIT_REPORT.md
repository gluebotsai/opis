# CCaaS audit report (ticketing-grade build)

**Date:** 2026-09-17  
**Org reference:** 1000  
**Scope:** All 58 `aiccaas` metrics — certification, agents, source validation, thresholds, guardrails.

## Summary

| Area | Status | Notes |
|------|--------|-------|
| Metric inventory | ✅ | `docs/CCAAS_METRIC_AGENT_MAP.md` — 58 metrics mapped |
| SQL templates | ✅ | `scripts/expand_ccaas_sql_templates.py` → 58 templates in `semantic/sql/metric_templates/ccaas.yml` + `semantic/metrics/ccaas.yml` |
| Runtime catalog | ✅ | `list_certified_for_source('aiccaas')` returns **58** |
| `cc.reporting` / `cc.reporting_mas` | ✅ | Full 58-metric grants in `ontology/agent_metrics.yml` |
| Specialist agents | ✅ | `cc.ai_support` wired (5 AI metrics); `cc.forecast` wired (4 metrics) |
| Semantic layer channel | ✅ | `call_volume` → `voice`; `chat_volume` → non-`voice` |
| Marts enriched | ✅ | `mart_agent_tasks`, `mart_agent_presence_history`, `mart_conversation_dispositions`, `mart_copilot_turns`, `mart_copilot_skill_executions` |
| Compiled catalog | ✅ | `semantic/catalog/compiled/ccaas.yml` (16 tables) |
| `resolution_rate` catalog gap | ✅ | Added to `semantic/catalog/ccaas.yaml` |
| Source validator | ✅ | `scripts/validate_ccaas_core_metrics.py` (ccass.* / accounts.* only) |
| Thresholds | ✅ | `scripts/generate_metric_thresholds.py` — direction fixes + CCaaS/ticketing bands; org1000 backlog overlays |
| Guardrails | ✅ | `scripts/test_ccaas_guardrails.py` — alias, channel filter, validator literal, catalog count |

## Acceptance checklist

- [x] All 58 certified in registry + metrics catalog + SQL templates
- [x] `cc.reporting` can query any certified metric (grant size 58)
- [x] Specialist subsets assigned via `metric_ownership.yml` specialist_rules
- [x] `cc.ai_support` removed from `never_assign`; slice `metric_ids` populated
- [x] Ground-truth validator uses **source tables only** (not marts/staging)
- [x] Ticketing postmortem guardrails covered in `test_ccaas_guardrails.py`
- [x] Live API validation **58/58** — `scripts/ccaas_core_metrics_report.json` (org 1000, ground truth `ccass.*` / `accounts.*`)
- [x] dbt parse **6/6** projects (`scripts/dbt_parse_all.py`)
- [x] dbt run **32/32** CCaaS views (`scripts/dbt_run_all.py --select ccaas`)
- [x] dbt test **81/81** PASS (`dbt test --select tag:ccaas`)
- [x] Guardrails **4/4** (`scripts/test_ccaas_guardrails.py`)
- [x] Agent matrix **0 failures** (`scripts/test_ccaas_agent_matrix.py`)

### Trace-back fix (2026-09-17)

`missed_contact_rate` HAND_TUNED template used wrong assignment states (`missed`, `abandoned`, `timeout`). Aligned to source truth: `lower(state) IN ('rejected', 'expired')` — matches `semantic_layer.yml` and `ccass.conversation_assignments`.

## Residual proxy risks

| Metric | Risk | Tolerance |
|--------|------|-----------|
| `ai_containment_rate` | Inferred from `handoff_reason` + `assigned_agent_id` + terminal status | 5% drift in validator |
| `agent_assist_adoption_rate` | Copilot `accepted` boolean + `final_text` vs `suggestion_text` proxy | 5% drift |
| `agent_assist_modification_rate` | Same disposition inference | 5% drift |
| `ai_handover_rate` / `handover_rate` | `handoff_reason IS NOT NULL` proxy | 5% drift |
| CSAT | **No source column** — not in 58-metric CCaaS set | Documented out of scope |

## Key artifacts

| Artifact | Path |
|----------|------|
| Metric-agent map | `docs/CCAAS_METRIC_AGENT_MAP.md` |
| Template expander | `scripts/expand_ccaas_sql_templates.py` |
| Source validator | `scripts/validate_ccaas_core_metrics.py` |
| Agent matrix test | `scripts/test_ccaas_agent_matrix.py` |
| Guardrails | `scripts/test_ccaas_guardrails.py` |
| Thresholds | `semantic/metric_thresholds.yml` |

## Ticketing guardrails applied

1. **Catalog drift (16 vs 58)** — expanded templates + metrics catalog atomically  
2. **Product alias** — `contact_centre` / `aiccaas` → `ccaas` (tested)  
3. **Channel on wrong mart** — `resolve_channel_filter` skips `mart_copilot_turns` (tested)  
4. **Validator `'call'` literal** — quoted-literal stripping (tested)  
5. **Source vs mart validation** — validator ground truth = `ccass.*` / `accounts.*` only  
6. **call → voice** — semantic_layer + templates aligned  
7. **Threshold direction** — explicit overrides for `reopen_rate`, `assignment_rate`, SLA compliance rates, etc.  
8. **Slice YAML** — `cc.ai_support` `metric_ids` fixed; `cc.forecast` agent wired in `agents.yml`
