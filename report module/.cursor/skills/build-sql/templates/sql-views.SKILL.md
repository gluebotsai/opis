---
name: <spoke>-sql-views
description: Write one free SELECT on rpt.* from column meaning. Use only on the free_sql path, or once after needs_free_sql.
---

# Views skill

You receive the task, the column book for this role, and this org's sample values. Python attached only this skill.

## Procedure

1. Lock the object in the goal. Use that rpt view.
2. Pick columns from grain, description, user_phrases, and not_the_same_as. If the user says status on a deal and the book says that means stage, group by stage. Do not look for a column named status.
3. A list returns readable columns and LIMIT. It is not COUNT(*).
4. A count with no metric card is COUNT(*) on that view.
5. Names use ILIKE with the user's words. Stage, status, and type use exact values from the sample-value block.
6. Join only when the column book lists that join for this slice.
7. Do not recompute a certified metric by joining CDP or another spoke.
8. Filter with :start and :end only when the payload has them.

## Output

{"tool":"run_sql","sql":"SELECT title, stage, amount FROM rpt.deals WHERE title ILIKE '%expansion%' LIMIT 50"}

## Examples

List deals named expansion. Names use ILIKE. Not a count. Not the certified deal_count metric.

{"tool":"run_sql","sql":"SELECT title, stage, amount FROM rpt.deals WHERE title ILIKE '%expansion%' LIMIT 50"}

Filter by deal description (HITL rejected that slot on deal_count). List matching rows.

{"tool":"run_sql","sql":"SELECT title, stage FROM rpt.deals WHERE description ILIKE '%renewal%' LIMIT 50"}
