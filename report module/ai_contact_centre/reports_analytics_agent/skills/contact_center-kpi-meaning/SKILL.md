---
name: contact_center-kpi-meaning
description: Choose one certified Contact Center metric from the cards using when_to_use and when_not. Use only on the certified_metric path.
---

# Metric skill

You receive the task and the metric cards for this role. Python attached only this skill.

## Procedure

1. Match the goal to when_to_use.
2. Reject a card when when_not matches the goal.
3. If two cards still match, return clarify. Do not pick the neighbour.
4. If no card's when_to_use covers the goal, return unavailable. Do not pick a neighbour. Do not average a lookalike score. needs_free_sql is only for a known card that cannot express a slice or filter.
5. If the slice or filter is listed in unsupported_filters (HITL not_this_metric), return needs_free_sql. Do not invent a WHERE. If it is simply missing from the card, still return needs_free_sql — that is a catalog defect; the builder must add the HITL decision.
6. Otherwise return run_kpi. Copy only allowed dimension ids, at most two. Person names are not dimensions: one name goes in filters.agent (or filters.queue). Two people to compare: dimensions [agent] only. Copy only declared filter slots that the goal named. Use the slice aliases in the payload for user words such as status. Do not invent filter names.

Conversation count / how many conversations (including by channel) is total, not handled. How many calls is call_count, not handled and not total. First-reply SLA is the 60-second percent, not average first response minutes. Busy hours is presence busy time, not conversation volume. Ready now / how many are ready is ready_agents, not a roster and not logged_in_agents.

Call volume is not CDR. Ready agents use presence_state, not agents.status. Reopen rate divides by resolved. Failed send uses outbound customer-visible messages.

## Output

{"tool":"run_kpi","kpi":"<card id>","dimensions":["<id>"],"filters":{}}

{"tool":"clarify","question":"One short question."}

{"tool":"needs_free_sql","reason":"The card cannot express this slice or filter."}

{"tool":"unavailable","reason":"That measure is not in Contact Center reports."}

Do not write SELECT. Do not rename the id.

## Examples

Goal: conversation count by channel last 7 days. Card total is started conversations including still open. Dimension channel is allowed.

{"tool":"run_kpi","kpi":"total","dimensions":["channel"],"filters":{}}

Goal: average handled conversations per month. Card avg_monthly_handled. One number. Do not slice by month.

{"tool":"run_kpi","kpi":"avg_monthly_handled","dimensions":[],"filters":{}}

Goal: handled conversations by month. Card handled. Dimension month is a table, not the monthly average.

{"tool":"run_kpi","kpi":"handled","dimensions":["month"],"filters":{}}

Goal: compare average handle time for Bharathi and Raghu. Card avg_handle_time. Two people: group by agent. Do not invent a second agent filter.

{"tool":"run_kpi","kpi":"avg_handle_time","dimensions":["agent"],"filters":{}}

Goal: CSAT survey scores by agent. No CSAT card. Sentiment scores are not CSAT.

{"tool":"unavailable","reason":"Customer satisfaction surveys are not in Contact Center reports."}

Goal: filter handled by the conversation subject text. HITL marked subject not_this_metric.

{"tool":"needs_free_sql","reason":"handled does not filter free-text subject."}
