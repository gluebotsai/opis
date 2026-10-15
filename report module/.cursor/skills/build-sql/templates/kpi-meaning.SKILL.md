---
name: <spoke>-kpi-meaning
description: Choose one certified metric from the cards using when_to_use and when_not. Use only on the certified_metric path.
---

# Metric skill

You receive the task and the metric cards for this role. Python attached only this skill.

## Procedure

1. Match the goal to when_to_use.
2. Reject a card when when_not matches the goal.
3. If two cards still match, return clarify. Do not pick the neighbour.
4. If the slice or filter is listed in unsupported_filters (HITL not_this_metric), return needs_free_sql. Do not invent a WHERE. If it is simply missing from the card, still return needs_free_sql — that is a catalog defect; the builder must add the HITL decision.
5. Otherwise return run_kpi. Copy only allowed dimension ids, at most two.

## Output

{"tool":"run_kpi","kpi":"<card id>","dimensions":["<id>"]}

{"tool":"clarify","question":"One short question."}

{"tool":"needs_free_sql","reason":"The card cannot express this slice or filter."}

Do not write SELECT. Do not rename the id.

## Examples

Goal: how many deals by status. Card deal_count when_to_use covers deals by status. Dimension stage is allowed. Alias status → stage is already applied or stage is the allowed id.

{"tool":"run_kpi","kpi":"deal_count","dimensions":["stage"]}

Goal: deal count for one product. Product is an accepted slot.

{"tool":"run_kpi","kpi":"deal_count","dimensions":[]}

Goal: filter by deal description. HITL marked description not_this_metric.

{"tool":"needs_free_sql","reason":"deal_count does not filter free-text description."}
