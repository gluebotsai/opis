# Coverage gate — contact_center_v2

Filled 2026-10-08. Domain (7 Domain prompt + 8) skipped by request.

## Phase 0 — intake

- [x] Pack folder is `reports_analytics_agent_contact_center_v2/`
- [x] Spoke schema, accounts, cdp, inventory, and shared schemas are each marked in or out
- [x] Every in-scope table is listed
- [x] Roles, default scope, and "my rows" column are written
- [x] Each business object names the physical table that owns it
- [x] Dashboard / industry metric wish list is written
- [x] Neighbour metric pairs for this spoke are listed
- [x] Join graph is written
- [x] Time rule is UTC, week Monday–Sunday, business date per metric
- [x] Identity fields are listed. The model is not allowed to invent them
- [x] Nothing was copied from another spoke's kpis.yml / dimensions.yml / run_kpi.py as the starting catalog

## Phase 1 — columns

- [x] Every column of every in-scope table has a disposition
- [x] Inventory came from the schemas first
- [x] Each exposed column has object, grain, meaning, user_phrases, groupable
- [x] Each hidden column has a hide_reason
- [x] Colliding words are listed per object
- Waiver: generic expose one-liners (coverage.yml)

## Phase 2 — views

- [x] Every exposed column appears on a `rpt` view
- [x] Every view has grain, description, object, and a source that filters `{org_id}`
- [x] Queue ids bound by engine on views that have `queue_id` when scope is queue
- [x] Model-facing prompts contain no physical schema names
- [x] Joins exist for filter/group attributes
- [x] Join keys the user must not see are join_only

## Phase 3 — dimensions

- [x] Groupable columns have a dimension id or HITL not_this_metric
- [x] Each dimension has meaning, user_phrases, sql_expr per object
- [x] Aliases are per object. No global status
- [x] day / week / month use the card time column, UTC, Monday–Sunday

## Phase 4 — metric cards and HITL

- [x] Every wish-list metric is a card (`missing_kpis: []`)
- [x] Lists are not cards
- [x] Cards have id, label, grain, unit, family, aggregation, when_to_use, when_not, not_confused_with
- [x] definition numerator/denominator/includes/excludes filled
- [x] Column decisions present for each certified KPI
- [x] allowed_dimensions / filters / unsupported_filters match HITL
- Waiver: shift GROUP BY; time_kind live implemented in engine

## Phase 5 — templates

- [x] `product/sql/<kpi_id>.sql` exists for every card
- [x] Shared grain `_base_conversation.sql` is not a fake card
- [x] No `{{filters_sql}}` hole
- [x] Bound parameters
- [x] Fanout uses EXISTS
- [x] run_kpi refuses unknown dimension or filter
- [x] Combinations run in `tests/test_question_bank.py`

## Phase 6 — access

- [x] Each role has default_scope and my_rows_column
- [x] Matrix covers org / own / queue
- [x] Agent org is deny
- [x] Deny is not repaired
- Waiver: PII hide in coverage vs access mask

## Phase 7 — prompts

- [x] sql_executor/agent.md is thin and does not brief
- [x] No KPI id list or 8–10 examples in the executor
- [x] Metric skill and views skill are separate
- [x] Runtime loads exactly one skill per task
- [x] Metric skill returns run_kpi, clarify, or needs_free_sql only
- [x] Views skill returns one rpt SELECT
- [x] :org_id is not given to the model
- [x] Free-SQL path injects org sample values, a view index, joins, and at most 3 similar examples
- [x] `execute_sql_task` is the Domain handoff (no KPI id; needs_free_sql → views once; one repair then REPLAN)
- Waiver: domain/agent.md skipped

## Phase 8 — Domain

- Waiver: Domain agent.md / briefing skipped. Executor accepts Domain task JSON and returns facts.

## Phase 9 — engine and questions

- [x] time, resolve, views, sql_guard, run_kpi, run_sql, facts, grounding, loop pointed at this product/
- [x] No new regex intent router
- [x] One repair, then one replan, then stop; deny stops
- [x] Question bank: neighbour pair, user-word ≠ column, HITL-rejected filter, joined accepted filter, access deny, list not COUNT(*), dimension GROUP BY
- [x] CTE wrapper selects only columns the view source emits (catalog-only keys skipped)
- [x] Unbounded time words raise; non-live KPIs require a UTC window
- [x] `tests/test_question_bank.py` green on org 1012
- [x] All 45 certified KPIs execute on org 1012 (offer_accept_rate / offers_ringing use `assignments.reason`)

## Phase 10 — coverage gate

- [x] This file filled Pass / Waiver
- [x] Domain 7+8 waived in `product/coverage.yml`
- [x] Remaining waivers have reasons (business_hours timezone, CSAT/out-of-scope, occupancy shift, generic expose, PII, catalog-only columns)
