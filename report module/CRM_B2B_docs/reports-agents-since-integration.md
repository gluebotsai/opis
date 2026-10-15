# Reports agents: changes since the executor integration

Baseline is the integration commit `e94d625` (domain agent wired to the SQL executor and the knowledge-graph executor). Current is `589483e`.

This note covers the three report agents only: the domain agent, the SQL executor, and the knowledge-graph executor. It covers skills, how each agent answers, the written brief, and the KPI card contract. It does not cover chat UI, dashboards, or other CRM features.

## Domain agent

Prompt: `ai-service/app/agents/reports_b2b/domain/agent.md`.

### Planning

At integration the plan was JSON tasks only. It now also does the following.

- Every analytics plan includes a top-level `object`: `contacts`, `companies`, `deals`, `quotes`, `invoices`, `activities`, `contracts`, or `products`.
- A greeting, navigation request, record create/update/import, or named-person lookup returns `{ "kind": "chat", "depth": "quick", "tasks": [] }`. No KPI is invented for that turn.
- Time still copies the user’s phrase. If the user names no period, a trusted `timePhrase` is used when one is supplied. Otherwise the plan uses `all time`. A period in the current question overrides the trusted phrase.
- “Sales rep”, “salesperson”, “rep”, or “agent” together with pipeline, deals, revenue, win rate, closing, quota, or performance means a human CRM owner. The plan uses owner KPIs such as `won_revenue`, `total_pipeline`, `win_rate`, or `total_opportunities`. `agent_operations` is used only for automation jobs, runs, or execution status.
- A comparison of two or more named people sets `owner_names` (a list) and `dimension: "owner"`. One named person still uses `owner_name`.
- “Why deals were lost” is planned as `lost_deal_count` grouped by `lost_reason` (`answer_type: breakdown`). At integration that task was a scalar KPI with no dimension.

### Brief (what the user reads)

At integration, brief mode was plain prose:

- First sentence stated the numbers. One table if groups existed.
- SQL-only answers were 1–3 sentences, with no Prescriptive or Predictive headings.
- A why-question with graph notes stated the numbers, then the graph reasons, then one next step the rows supported.

Now brief mode follows `crm-user-brief`:

- The user-facing answer is HTML. Allowed tags: `p`, `ul`, `li`, `strong`, `em`, `br`. No headings, links, class, style, id, Markdown, or code fences.
- The title is `<p><strong>…</strong></p>`, under 140 characters, and does not end with `.`, `?`, or `!`.
- The last HTML element is one `<p>` follow-up question grounded in the question and the facts. It is not a “Next step” line.
- After the HTML, one trailing line names the card. The user does not see that line. It is `card: none`, `card: kpi rN`, `card: bar rN`, or `card: table rN`. It names one `result_id` from the facts and carries no numbers, labels, or totals.
- Graph notes still inform the written reasons. They are not a card. Empty graph rows are a data gap, not “KG refused.”
- Zero stays zero. A count stays a count. The brief does not name SQL, Cypher, the warehouse, KPI ids, `RESULT`, `kg_notes`, or the graph.
- The brief is no longer cut at 800 characters. The brief call allows up to 4096 tokens.
- Money uses the tenant display currency. The symbol matches the code (INR ₹, GBP £, EUR €, USD $).

## Skills

### New: `crm-user-brief`

`ai-service/app/agents/reports_b2b/skills/crm-user-brief/SKILL.md` did not exist at integration. The domain agent lists it with `crm-object-lock`, `crm-money`, and `crm-plan-kg`. It applies in brief mode only and is the source of the HTML layout, the follow-up question, the hidden card line, and the “never say” list above.

### `crm-object-lock`

- One named person still maps to `owner_name`.
- Two or more named people map to `owner_names` plus `dimension: "owner"`, so the result contains only those people.
- Sales-rep / salesperson / rep / agent wording on pipeline, deals, revenue, win rate, closing, or performance locks a human owner KPI. `agent_operations` is only for automation jobs, runs, enrichment or scoring jobs, or execution status.

### `crm-kpi-catalog`

Optional bound fields now include `owner_names: ["Raghuram", "Manoj"]` for a named-rep comparison, in addition to the existing single `owner_name` and `status_filter`.

### `crm-kg-briefing`

Graph notes still use topic headings and cite deal title, owner, and account from rows. One rule was added: write the currency symbol for the code (INR ₹, GBP £, EUR €, USD $). Do not use `$` for a non-USD figure.

SQL-executor skills (`crm-kpi-query`, `crm-free-sql`, `crm-rpt-columns`) and the other graph skills (`crm-kg-graph-rules`, `crm-kg-joins`, `crm-kg-jobs`, `crm-plan-kg`, `crm-money`) are unchanged in their skill files.

## KPI cards

At integration a card was built from the SQL rows for the turn. The written brief did not choose the card.

Now the domain brief’s `card:` line chooses the card:

| Line | Card |
| --- | --- |
| `card: none` | No card. The answer is the HTML only. |
| `card: kpi rN` | One scalar KPI card from result `rN`. |
| `card: bar rN` | One bar card from the groups in result `rN`. |
| `card: table rN` | One table card from the rows in result `rN`. |

The card is filled only from that SQL result. If the named result cannot fill that kind of card, no card is attached. Graph rows stay in the written answer and are not drawn as a card. A scalar two-KPI result is still one KPI card when the line says `card: kpi`.

## SQL executor

`ai-service/app/agents/reports_b2b/sql_executor/agent.md` is unchanged.

It still does not brief. `task.kpi` set runs the certified KPI. `task.kpi` null is one free `SELECT`/`WITH`. Output is one tool call or one statement, not prose.

The domain plan changes above (`object`, `owner_names`, lost-reason breakdown, sales-rep versus `agent_operations`) are what this executor now receives. Its own prompt and skills were not rewritten.

## Knowledge-graph executor

`ai-service/app/agents/reports_b2b/kg_executor/agent.md` is unchanged.

It still returns one Cypher tool call or a certified template, then notes grounded in the rows. It does not write the user-facing HTML or the card line.

The only skill change on this agent is the currency-symbol line in `crm-kg-briefing`. Those notes are passed to the domain agent as facts. The domain brief is what the user reads.
