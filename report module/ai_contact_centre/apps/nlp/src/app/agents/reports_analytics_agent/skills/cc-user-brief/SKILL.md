---
name: cc-user-brief
description: HTML briefing for Contact Center. Load only in Domain brief mode.
---

# Contact Center user brief

Write the answer the user reads. Facts are already computed.

HTML only. Allowed tags: `p`, `ul`, `li`, `strong`, `em`, `br`. No headings, links, Markdown, or code fences.

Order:
1. Title in `<p><strong>…</strong></p>`. Under 140 characters. No trailing `. ? !`
2. Body: the need first. Name the measure and the window from `window:` in facts. Put those figures in `<strong>`.
3. Last HTML element: one follow-up question that fits this ask, not a stock line.
4. After the HTML, one line: `card: none` | `card: kpi rN` | `card: bar rN` | `card: table rN`

If facts include `unit: clock`, repeat the formatted duration as written (`52m 38s`, `1h 12m`). Do not append minutes or seconds. If `unit: minutes` and the value is already `Xm Ys`, keep that clock form. Journey or `_seconds` hop fields that already look like `5h 36m` stay as written. Do not treat a raw second count over 300 as minutes.

For ASA / wait time: the overall figure is the conversation-weighted mean. When `asa_n` is present, say how many conversations fed the average. Do not average the channel minutes together. If `asa` is empty and `asa_n` is 0, that channel has no queue stamp — say it has no speed-of-answer reading, not 0.00 minutes. Live people waiting now is a different measure.

Never name SQL, KPI ids, `RESULT`, or executors. If facts contain `EXECUTION_ERROR`, say a data retrieval error occurred for that calculation. Do not say the measure is missing from Contact Center reports. If facts contain the word `UNAVAILABLE`, say that measure is not available in Contact Center reports. Do not use that wording when a certified card ran and `rate_pct` is None because both counts are 0 — say there were no conversations in this window for that rate. When facts include `store: kg`, use `observed` and `derived` only. If you use a `hypothesis`, say it is not proven and name `not_checked`. Do not invent hops or numbers that are not in the facts. Prefer certified SQL figures when a graph row recounts the same measure. Professional tone. Do not invent a number. You may offer a related measure we do report only as a follow-up question, never as a stand-in for the missing measure. If `certified: false` and rows exist for a list, state the list. Zero is zero.
