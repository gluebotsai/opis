# SQL executor and knowledge-graph executor

The reports and analytics domain agent answers questions about this B2B CRM. It has two executors. The SQL executor fetches, lists, and calculates. The knowledge-graph executor explains why a number, a deal, or a customer looks the way it does. The domain agent still speaks through the LLM. These executors return evidence. They do not replace the model with a keyword router or a canned sentence.

Both executors read the other three files in this folder before they touch data.

- `01-database-schema.md` is the table, column, join, and enum contract.
- `02-modules-roles-pipeline.md` is who may see which module and which rows.
- `03-kpi-metrics.md` is the formula for each metric, including the formulas that must not be invented.

## What both executors must satisfy

Every request is already inside one organization. The organization id comes from the signed-in session. It is a filter on every CRM query and on every graph traversal. A result that mixes two organizations is a failure.

The role comes from the same session. Admin, sales manager, and finance may see the organization, and only on the metric families their module access allows. Sales rep, presales, marketing, and viewer see their own records. Viewer results are read-only. A missing user id returns nothing.

The executors do not create, alter, or drop tables in `accounts`, `cdp`, or `inventory`. They may read the columns those schemas already expose to CRM. They do not select passwords, token columns, client secrets, or API-key hashes. They do not print a raw transcript into a metric card. A transcript is evidence for a why-question, and only for a meeting the role is allowed to see.

Money stays inside one currency. Null amounts count as 0 only where the metric catalog says so. Header totals and line totals are never added together.

If the catalog says an input does not exist, the executor says so. Stage history, per-deal probability, won reason, rep quota, email opens, and campaign spend are in that list. The SQL executor must not approximate them from notes. The knowledge-graph executor may quote a note as a person's words. It must not turn that quote into the missing official field.

The LLM chooses the executor and writes the reply. Code may check tenancy, role, payload size, and that a returned filter uses a real column and a real enum. Code must not decide the answer by matching "how many" or "why" itself and skipping the model.

## SQL executor

### Responsibility

The SQL executor is the only path that produces a KPI, a list, a count, or a sum. If a number appears in the answer, it came from this executor in this turn, from rows the role is allowed to read.

It covers the whole B2B working set: `crm` commercial tables, `crm.contact_profiles`, `cdp.customer_profile` and `cdp.identity_keys` for the person, `accounts.organizations` and `accounts.setup_users` for the tenant and the owner name, and `inventory.products` for the catalog. `cdp.products` is not the catalog.

### What it must be able to do

Resolve a metric in `03-kpi-metrics.md` to one query, with the period, the currency rule, and the role's row scope applied before the aggregate. Dashboard cards, funnel, aging, deal-size bands, owner bars, lost reasons, and the six-month won trend are in this set. So are quote acceptance, outstanding invoices, collected revenue, contract ARR, lead-status mix, activity counts, and product revenue.

List rows when the user asks who or which, not only the total. A pipeline question can return the total and the deals that make it. Lists stay bounded. Default to a small page, include the total count, and continue only if the user asks for more.

Join on the foreign keys in the schema file. Company name comes from `crm.companies`. Person name and email come from CDP, joined through `account_contact_id` or the deal's `contact_id`. Owner name comes from `accounts.setup_users`. Product name comes from `inventory.products`.

Filter categorical columns only with the enum or the documented varchar codes. Deal stage, quote status, invoice status, lead status, activity type, and channel role are the important ones. A user word such as "won" maps to `closed_won` through the LLM's choice of filter, then the executor rejects any value that is not in the enum.

Compare two periods by running the same formula twice, for example this month and last month, and return both numbers. The executor does not invent a trend sentence. The LLM writes that from the two figures.

Sort and rank inside the allowed scope. Top open deals, top owners, and top lost reasons are rankings. A rep's ranking does not include other reps' deals.

Count operational queues that are real tables: invoices in `pending_approval`, nurture or scoring jobs by status, unassigned active leads. Job counts stay labelled as jobs. They are not lead totals.

Refuse a metric whose inputs are absent, and name the missing input. Quota attainment, time in stage, won-reason mix, email open rate, and campaign ROI are refusals until those columns exist.

### What it must not do

It does not explain motive, risk, or next step in its own voice. It can return the columns that support that explanation, such as `lost_reason`, `forecast_reason`, last activity date, and invoice `due_at`.

It does not parse note text, transcript text, or email body to fill a metric. It may return that text as a column when the knowledge-graph executor, or the user, asked to see it, and the role may see that record.

It does not write business data as part of answering a question. Saving a `report_snapshots` row is allowed only when the user asked to save a report. Live answers are calculated again from the source tables.

It does not use a query that updates, deletes, or changes schema. A report is a read.

## Knowledge-graph executor

### Responsibility

The knowledge-graph executor answers why, what changed in the relationship, and what the record is connected to. It does not replace a sum. When the user asks both "what is the number" and "why", the SQL executor produces the number and this executor produces the explanation. The LLM puts them in one reply.

A why-answer is grounded in links the CRM actually has. It cites the records. It does not invent a cause from the industry, the country, or a score reason the product has stopped using.

### What it must be able to do

Walk the B2B path for one company or one deal. The path is company, locations, contacts, deals, activities, proposals, quotes, quote lines, orders, invoices, and contracts. Each hop uses a foreign key from the schema file. The walk stays inside the role's scope, so a rep does not traverse into another rep's deal and then describe it.

Explain a dashboard number with the rows behind it. If won revenue fell, the executor can show which `closed_lost` deals in the period carry a `lost_reason`, which open deals slipped past `expected_close_date`, and which invoices went `overdue`. Those are facts. The LLM may summarize them. The executor does not add a cause that no row supports.

Explain a single deal. Useful evidence is the current stage, amount, expected close, close time, lost reason, forecast flag and forecast reason, the quote status, the last activities, and the company and contact on the deal. Stage history is absent, so the explanation says the current stage and does not narrate a path that was not stored.

Explain a contact. Evidence is lead status, BANT flags, owner, source, opt-out, converted deal, and the recent contact activities. Name, title, and email are read from CDP for that same person. A disqualified lead is explained from `disqualify_reason` and the activity timeline, not from a guessed persona.

Explain finance on a deal the role can see. Evidence is the quote status, the order number, the invoice status, the approval status, the due date, and the paid time. "Waiting on finance" means `approval_status = pending_approval`. "Customer has not paid" means the invoice was sent and is not paid.

Connect a meeting to the account. An appointment, a meeting activity, a Meet assist session, and a transcript chunk are linked records. The executor may use the transcript and the meeting analysis to say what was committed or objected to, for a meeting in scope. It does not score the lead from the transcript on its own, and it does not create a contact.

Use owner and team links for a manager's why-question. Pipeline by owner, deals with no recent activity, and lost reasons by owner are graph groupings over the same rows the SQL executor counted. A rep does not receive other owners' narratives.

Say when the graph cannot support the question. No won reason, no stage history, no quota, and no campaign spend means the answer is that the link is not in the CRM. The executor does not fill the gap with a plausible story.

### What it must not do

It does not calculate a KPI by walking nodes and adding amounts in prose. If the reply needs a total, it asks the SQL executor for that total and uses the graph only to name the contributors.

It does not treat free text as an enum. A note that says the buyer went quiet is a citation. It is not a new lead status and not a new lost reason unless the structured column already says that.

It does not read credentials, and it does not expose a transcript, email body, or note from a record outside the role's scope.

It does not change stage, owner, invoice, or lead status. Explanation is read-only.

## How a question is split

| User need | Executor |
| --- | --- |
| A KPI, a count, a sum, a list, a ranking, a period comparison | SQL |
| Why a deal was lost, why a forecast is flagged, what happened on the account, what a meeting committed | Knowledge graph |
| The number and the reason in one question | SQL for the number, knowledge graph for the cited rows, LLM for the reply |
| A metric the catalog marks as missing | SQL refuses the calculation. The knowledge graph does not invent a substitute figure |

The domain agent can call both in one turn. It must not call the knowledge-graph executor alone and then state a revenue number from memory or from a previous chat. A previous chat can name the deal. The amount is read again.
