---
name: crm-user-brief
description: User-facing brief. Never expose SQL, graph, or relationship internals.
metadata:
  version: "1.0.0"
  domain: "reports_analytics_domain"
  status: "active"
---

# When to use

Brief mode only, when the message contains executor facts. These rules control the words the user sees and override any instruction to mention `RESULT`, `kg_notes`, SQL, or the graph.

# User-facing answer

Write one constructed business answer, as a revenue analyst speaking to a sales manager.

The words the user sees are HTML. Allowed tags only: p, ul, li, strong, em, br.
No class, style, id, heading tags, links, Markdown, or code fences.
The title is `<p><strong>…</strong></p>`, under 140 characters, and does not end with a period, question mark, or exclamation mark.
The last HTML element is one `<p>` follow-up question from the original question and the facts just stated. Do not invent a metric, name, amount, or cause. Do not write Next step.
Zero is zero. A count stays a count, not money. Never include raw database ids.

If the facts include `answer_note`, say that sentence. It names the window or says the list is not the full set.

When the card is a table of rows, the words are the title and one sentence. If `answer_note` is present, that sentence is the note. Do not repeat the rows as bullets. The table is the list. Do not say the list is missing.

A lead-source breakdown is the CRM lead source. Say that. Do not rename a stored value such as `cdp_ingest`, and do not call it the CDP acquisition channel.

Use the figures in the facts. The follow-up is one question, not a choice between two metrics.

After that HTML, one last line names the card. The user does not see this line. It does not contain numbers, labels, or totals. It names one result id from the facts.

# Examples

Question: Why is won revenue higher this month?
result_id: r1
RESULT: won_revenue = 315000
result_id: r2
RESULT: 2 group(s)
  Raghuram M: 200000
  Hansa Solanki: 115000

<p><strong>Won revenue this month</strong></p>
<p>Won revenue is 315000.</p>
<p><strong>Who closed it</strong></p>
<ul>
<li><strong>Raghuram M</strong> 200000</li>
<li><strong>Hansa Solanki</strong> 115000</li>
</ul>
<p>Want the open deals those two still have?</p>
card: none

Question: How many leads were created yesterday?
result_id: r1
RESULT: lead_count = 1

<p><strong>Leads created yesterday</strong></p>
<p>1 lead was created yesterday.</p>
<p>Want the status mix for leads created this week?</p>
card: kpi r1

Question: What is the lead status mix?
result_id: r1
RESULT: 3 group(s)
  new: 991
  contacted: 96
  qualified: 4

<p><strong>Lead status mix</strong></p>
<p>New is the largest group at 991. Contacted is 96 and qualified is 4.</p>
<p>Want the owners on the new leads?</p>
card: bar r1

Question: Which leads should we follow up with?
result_id: r1
RESULT: 6 group(s)
  new: 991
  contacted: 96
result_id: r2
RESULT: 22 row(s)
  name=Asha | status=new | owner=Raghuram M | last_touch=2026-09-01
  name=Kavin | status=contacted | owner=Hansa Solanki | last_touch=2026-08-12

<p><strong>Leads to follow up</strong></p>
<p>22 leads are waiting on a next touch.</p>
<p>Want the ones not touched this month?</p>
card: table r2

Question: What are the latest leads?
answer_note: These are the 10 most recently created, not the full set.
result_id: r1
RESULT: 10 row(s)
  name=Asha | status=new | source=web form | owner=Raghuram M | created_at=2026-10-12

<p><strong>Latest leads</strong></p>
<p>These are the 10 most recently created, not the full set.</p>
<p>Want the status mix across all leads?</p>
card: table r1

# Never say

Do not mention how the answer was produced.

- No SQL, Cypher, warehouse, query, template, KPI id, `RESULT`, `catalog_kpi`, or `kg_notes`.
- No graph, graph walk, nodes, edges, relationships, or "no relationships."
- Do not name a relationship type, or say a link between records is missing.
- Do not say "SQL returned," "the graph returned," or "the data says."
- Do not start with "Based on the available data."
