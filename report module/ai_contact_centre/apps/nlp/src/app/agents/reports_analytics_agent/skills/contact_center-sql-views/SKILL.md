---
name: contact_center-sql-views
description: Write one free SELECT on rpt.* from column meaning. Use only on the free_sql path, or once after needs_free_sql.
---

# Views skill

You receive the task, the column book for this role, and this org's sample values. Python attached only this skill.

## Procedure

1. Lock the object in the goal. Use that rpt view.
2. Pick columns from grain, description, user_phrases, and not_the_same_as. If the user says status on a conversation, group by conversation status, not presence or queue status. If certified_meaning is attached, a list of that concept uses that include and exclude. Do not swap in a lookalike column.
3. A list returns readable columns and LIMIT. It is not COUNT(*). A transferred roster is transferred_at IS NOT NULL. It is not resolution_code = transferred.
4. A count with no metric card is COUNT(*) on that view. A survey score such as CSAT or NPS is not a column here. Do not average sentiment scores as CSAT. Return {"tool":"unavailable","reason":"Customer satisfaction surveys are not in Contact Center reports."}
5. Names use ILIKE with the user's words. Channel, status, and type use exact values from the sample-value block.
6. Join only when the column book lists that join for this slice.
7. Do not recompute a certified metric by joining CDP or another spoke.
8. Filter with :start and :end only when the payload has them.
9. Every computed expression needs an alias. Rates multiplied by 100 use suffix `_pct` and two decimals. Raw fractions use `_ratio`. Durations: divide epoch seconds by 60 and alias `_minutes`, or keep seconds and alias `_seconds`. Never leave `?column?`.
10. Card-style windows on rpt.conversations use reporting_period_at with :start and :end.

Answers show names, never ids. Queue name is rpt.queues / conversations.queue_name, not a setup-queue profile.

## Output

{"tool":"run_sql","sql":"SELECT customer_name, channel, status, queue_name FROM rpt.conversations WHERE customer_name ILIKE '%acme%' LIMIT 50"}

## Examples

List conversations for a customer named Acme. Names use ILIKE. Not a count. Not the certified total metric.

{"tool":"run_sql","sql":"SELECT customer_name, channel, status, queue_name, created_at FROM rpt.conversations WHERE customer_name ILIKE '%acme%' ORDER BY created_at DESC LIMIT 50"}

Filter by conversation subject (HITL rejected that slot on volume KPIs). List matching rows.

{"tool":"run_sql","sql":"SELECT id, subject, channel, status, queue_name FROM rpt.conversations WHERE subject ILIKE '%billing%' LIMIT 50"}

Ad-hoc disconnect percent by handler. Alias `_pct`. Do not invent a certified card.

{"tool":"run_sql","sql":"SELECT handler, ROUND(100.0 * COUNT(*) FILTER (WHERE end_reason = 'customer_disconnected') / NULLIF(COUNT(*), 0), 2) AS disconnect_pct FROM rpt.conversations WHERE (CAST(:start AS timestamptz) IS NULL OR reporting_period_at >= CAST(:start AS timestamptz)) AND (CAST(:end AS timestamptz) IS NULL OR reporting_period_at < CAST(:end AS timestamptz)) GROUP BY handler"}

Webchat disconnect percent by page URL.

{"tool":"run_sql","sql":"SELECT w.page_url, ROUND(100.0 * COUNT(*) FILTER (WHERE c.end_reason = 'customer_disconnected') / NULLIF(COUNT(*), 0), 2) AS disconnect_pct FROM rpt.conversations c JOIN rpt.webchat_sessions w ON w.conversation_id = c.id WHERE c.channel = 'webchat' GROUP BY w.page_url ORDER BY disconnect_pct DESC LIMIT 20"}
