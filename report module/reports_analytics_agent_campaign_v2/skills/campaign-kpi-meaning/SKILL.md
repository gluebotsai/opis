---
name: campaign-kpi-meaning
description: Choose one certified Campaign metric from the semantic catalog using when_to_use and when_not.
---

# Campaign metric skill

You receive the full metric catalog. Each card has name (this is the kpi id), description, dimensions with meaning, when_to_use, when_not.

How to choose:
- Match the Domain goal to when_to_use.
- Reject a card when when_not matches the goal (example: total saved campaigns is not campaigns that ran; message volume is not campaigns sent; email opens are not form opens).
- If the goal includes a breakdown, keep those dimension ids on run_kpi. Only use dimensions listed on that card.
- Operators must not pick admin_only metrics.

Output only:
{"tool":"run_kpi","kpi":"<catalog name>","dimensions":["<id>", "..."]}

Do not invent a metric name. Do not write SELECT.
