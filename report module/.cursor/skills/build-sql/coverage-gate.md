# Coverage gate

A spoke SQL agent is not done until every line is pass or has a written waiver in `product/coverage.yml`. A blank waiver is a fail.

Copy this list into the spoke's build notes and fill Pass / Fail / Waiver.

## Phase 0 — intake

- [ ] Pack folder is `reports_analytics_agent_<spoke>_v2/`
- [ ] Spoke schema, accounts, cdp, inventory, and shared schemas are each marked in or out
- [ ] Every in-scope table is listed
- [ ] Roles, default scope, and "my rows" column are written
- [ ] Each business object names the physical table that owns it
- [ ] Dashboard / industry metric wish list is written (this is not the catalog yet)
- [ ] Neighbour metric pairs for this spoke are listed (count vs rate, and this product's lookalikes)
- [ ] Join graph is written: grain tables, many-to-one, many-to-many fanout
- [ ] Time rule is UTC, week Monday–Sunday, and the business date column is named **per metric** when it differs
- [ ] Identity fields are listed. The model is not allowed to invent them
- [ ] Nothing was copied from another spoke's kpis.yml / dimensions.yml / run_kpi.py as the starting catalog

## Phase 1 — columns

- [ ] Every column of every in-scope table has a disposition: expose, hide, join_only, or derive
- [ ] No column was added only after a failed chat. The inventory came from the schemas first
- [ ] Each exposed column has object, grain, meaning, user_phrases, groupable, and sample_values_sql when the vocabulary is closed
- [ ] Each hidden column has a hide_reason
- [ ] Where the user word is not the column name, meaning and not_the_same_as say so (deal status → stage is the pattern)
- [ ] Colliding words across objects are listed (deal stage vs invoice status vs campaign lifecycle)

## Phase 2 — views

- [ ] Every exposed column appears on a `rpt` view
- [ ] Every view has grain, description, object, and a source that filters `{org_id}`
- [ ] Branch or queue token is in the source when the spoke needs it
- [ ] The model-facing prompt and examples contain no physical schema names
- [ ] Joins exist for every attribute that can filter or group this object (region on the account, product, customer, contact, owner), with on and why — written in this phase, not after a metric
- [ ] Join keys the user must not see are join_only, not selected for display

## Phase 3 — dimensions

- [ ] Every groupable column on the object and on its joined views has a dimension id (or an explicit not-a-dimension reason on the metric HITL list)
- [ ] Each dimension has meaning, user_phrases, and sql_expr per object
- [ ] Aliases are per object. A global status alias exists only if every object shares that column
- [ ] deal-style "status" maps to the real column for that object only
- [ ] day / week / month use the card time column, UTC, Monday–Sunday

## Phase 4 — metric cards and HITL

- [ ] Every wish-list metric is a card or a missing_kpis line with a reason
- [ ] Lists and lookups are not cards
- [ ] Every card has id, label, grain, unit, family, aggregation
- [ ] Every card has when_to_use, when_not, and not_confused_with
- [ ] No two cards could swap text and still sound right
- [ ] definition numerator, denominator, includes, and excludes are filled
- [ ] default_time_column and time_kind match the business date, not a nearby timestamp
- [ ] For each metric, a column-decision file lists every expose/join_only grain column and the same on joined tables (hide columns omitted; created_at marked time window)
- [ ] Each of those columns is filter, dimension, both, or not_this_metric with a reason
- [ ] No column on that list is blank
- [ ] A person signed hitl.reviewed_by and hitl.reviewed_at
- [ ] The card is not a short list copied from another spoke; every grain/join column has a HITL decision
- [ ] allowed_dimensions match HITL "dimension" and "both"
- [ ] filters match HITL "filter" and "both"
- [ ] unsupported_filters match HITL "not_this_metric" with the same reasons
- [ ] admin_only is set true or false
- [ ] Nothing in Python selects a card by keyword

## Phase 5 — templates

- [ ] `product/sql/<kpi_id>.sql` exists for every card
- [ ] Shared grain is `_base_<object>.sql`, not a fake card
- [ ] No user value is concatenated into SQL
- [ ] No `{{filters_sql}}` hole left as TRUE
- [ ] Time bounds and filters are bound parameters, not string-pasted into SQL
- [ ] Many-to-many joins do not multiply the grain COUNT
- [ ] Every accepted filter is a bound parameter in the template, with its join (EXISTS if many-to-many)
- [ ] Each allowed dimension joins the owning table and GROUP BY works
- [ ] A dimension that errors on that grain is not left on the card
- [ ] compare: true uses :cmp_start and :cmp_end
- [ ] Combinations were run: no dimension, each dimension, each accepted filter
- [ ] run_kpi refuses an unknown dimension or filter and does not append WHERE

## Phase 6 — access

- [ ] Each role has default_scope and my_rows_column
- [ ] Matrix covers every scope level and role with all or deny
- [ ] Each role sees only its views, with scope, hide, and mask
- [ ] Personal-data columns are named and hidden or masked
- [ ] Out-of-scope requests deny before the executor
- [ ] Deny is not repaired or replanned

## Phase 7 — prompts

- [ ] domain/agent.md has no metric catalog and no KPI ids
- [ ] sql_executor/agent.md is thin and does not brief the user
- [ ] It does not contain a KPI id list or 8–10 examples
- [ ] Metric skill and views skill are separate files
- [ ] Runtime loads exactly one skill per task
- [ ] Metric skill can return run_kpi, clarify, or needs_free_sql only
- [ ] Views skill returns one rpt SELECT and uses user_phrases, not word overlap
- [ ] Sample values for this org are injected on the free-SQL path
- [ ] :org_id is not given to the model
- [ ] examples/sql.yml, if present, is similarity-picked and never injected whole

## Phase 8 — Domain

- [ ] Domain prompt has no metric catalog and no KPI ids
- [ ] Plan tasks use path, goal, time words, scope words, slice words, answer_type
- [ ] slice stays user words
- [ ] needs_free_sql runs the views skill once and sets certified: false
- [ ] Briefing does not label an uncertified number with the metric name
- [ ] Briefing numbers come only from facts

## Phase 9 — engine and questions

- [ ] time, resolve, views, sql_guard, run_kpi, run_sql, facts, grounding, loop are the shared engine pointed at this product/
- [ ] No new regex router and no new guard design
- [ ] One repair, then one replan, then stop
- [ ] Question bank includes a neighbour-metric pair
- [ ] Question bank includes a user-word ≠ column-name pair
- [ ] Question bank includes a HITL-rejected filter (expects needs_free_sql, not a forgotten slot)
- [ ] Question bank includes a joined attribute that HITL accepted (region or product must stay on run_kpi)
- [ ] Question bank includes an access deny
- [ ] Question bank includes a list that must not be COUNT(*)
- [ ] Question bank includes a dimension that must join and group without error

## Waivers

Write each waiver in `product/coverage.yml`:

```yaml
waivers:
  - item: "Phase 1 column crm.internal_notes.body"
    reason: "Out of reporting scope until the notes product is on."
```

If `reason` is empty, the gate fails.
