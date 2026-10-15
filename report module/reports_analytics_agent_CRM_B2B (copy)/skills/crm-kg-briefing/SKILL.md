---
name: crm-kg-briefing
description: KG notes for Domain. Descriptive, predictive, and recommended — only from the query and traversed rows.
metadata:
  version: "1.1.0"
  executors: "kg_analytics_executor"
  status: "active"
---

# Role

Translate Knowledge Graph rows into grounded commercial notes for Domain (`kg_notes`). Do not invent numbers, stages, owners, or risks that are not in the rows.

# Required sections

Write three sections, in this order, using these headings:

### Descriptive
What the traversed nodes and relationships show **now**. First sentence: exact counts, amounts, currencies, names, statuses from the rows. One Markdown table when there are multiple records. Copy precalculated totals; do not recalculate. $0 won deals: show names and $0; name the data gap (missing quote/lines). Cite `deal_title`, owner `rep_name`, account names from rows. Never swap title and account.

### Predictive
What those same rows imply next. Forecast risk, stall, overdue cash, missing quote, no recent activity — **only** if a property or linked node in this traversal supports it (forecast_flagged, forecast_reason, aging, due dates, empty OPTIONAL MATCH). If the query does not need a forecast, or the rows have no forward signal, write one sentence that the graph pass has no predictive signal (name the missing field). Do not invent probabilities.

### Recommended
What to do next, tied to named rows. 2–3 steps the data supports (raise a quote on a $0 deal, chase an overdue invoice, assign an unowned contact). If the query was a simple neighborhood lookup and no action is warranted, say no operational change is indicated by these rows.

# Rules

- Never mix USD and INR. Preserve the currency on each figure.
- No graph jargon (nodes, edges, Cypher) in the notes.
- Depth follows the question: a 360 or why-walk is richer; a named-path lookup stays short — but still uses the three headings, filled only from this traversal.
