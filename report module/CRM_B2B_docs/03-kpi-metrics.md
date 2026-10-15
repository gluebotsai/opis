# B2B KPI metrics

This file is the metric catalog for the reports domain agent. The SQL executor calculates these numbers. The knowledge-graph executor explains why a number moved. Neither executor invents a column that this catalog says is missing.

Amounts that are null count as 0. Totals are grouped by currency. A mixed-currency sum is not a result. Every query filters `organization_id` first.

## How role changes the calculation

The formula stays the same. The row set changes.

| Role | Row set | Write access |
| --- | --- | --- |
| admin | All rows in the organization | Read |
| sales_manager | All rows in the organization | Read |
| finance | All rows in the organization, for metrics they are allowed to see | Read |
| sales_rep | Deals, contacts, and activities they own, plus channel companies they own and those companies' children | Read |
| presales | Same owner scope as a sales rep | Read |
| marketing | Own contacts and campaign rows. Not org-wide deals or invoices | Read |
| viewer | Own records only | Read only |

A missing session returns no rows. Owner scope uses `owner_user_id` on the deal or contact. A rep's pipeline is not the team's pipeline with a different label.

Stage weights, used wherever this catalog says probability, are fixed today:

| Stage | Weight |
| --- | --- |
| qualification | 0.10 |
| discover | 0.25 |
| propose | 0.50 |
| negotiate | 0.75 |
| closed_won | 1 |
| closed_lost | 0 |

There is no per-deal probability column. High probability means an open deal whose stage weight is at least 0.75, which today is `negotiate`.

Open stages are qualification, discover, propose, and negotiate.

## 1. Dashboard metrics

These are the numbers the sales home dashboard already calculates in `getSalesMetricsDashboard`. A period metric uses `closed_at` when it is set, otherwise `created_at`, and keeps the row only when that timestamp falls inside the selected period.

Who can see this set: admin and sales manager for the organization; sales rep, presales, and viewer for their own deals. Finance does not get this set as a sales dashboard. Finance gets the invoice metrics in the core section. Marketing does not get this set.

### Total opportunities

Count of deals in the scoped row set, including won and lost.

`count(deals)`.

A rep's count is only deals they own. A manager's count is every deal in the tenant. A viewer sees the same shape as a rep and cannot edit the underlying deals.

### Active opportunities

Count of deals in an open stage.

`count(deals where stage in qualification, discover, propose, negotiate)`.

Same role split as total opportunities. The dashboard label for a rep is "My open deals".

### Total pipeline

Sum of `amount` on open deals.

`sum(amount) where stage is open`. Null amount adds nothing.

A rep sees the value of their open deals. A manager sees the organization's open deals. Do not include closed_won in this sum. Won money is a different card.

### Weighted pipeline

Open amount multiplied by the stage weight.

`sum(amount * stage_weight) where stage is open`.

This is the forecast stand-in until a deal stores its own probability. A rep's weighted pipeline uses only their open deals. A manager's uses the organization. The forecast auditor columns are not this formula.

### Won revenue

Sum of `amount` on `closed_won` deals whose close timestamp falls in the selected period.

`sum(amount) where stage = closed_won and coalesce(closed_at, created_at) in period`.

All-time won revenue is the same sum with no period filter. A rep sees won deals they own. A manager sees the organization.

### Lost revenue

Sum of `amount` on `closed_lost` deals in the period, using the same close timestamp rule.

`sum(amount) where stage = closed_lost and coalesce(closed_at, created_at) in period`.

All-time lost revenue drops the period filter. Grouping by `lost_reason` is the lost-reason chart, not a second revenue definition.

### Win rate

Share of decided deals in the period that were won.

`won_count / (won_count + lost_count)` for deals whose close timestamp is in the period. If both counts are 0, the rate is 0. Open deals are not in the denominator.

A rep's rate uses only their decided deals. A manager's rate uses the organization. A rep with one win and no losses shows 100 percent. That is the formula, and the explanation should say the sample is small.

### Average deal size

Open pipeline divided by the count of open deals.

`total_pipeline / active_opportunities`. If there are no open deals, the average is 0.

Role scope follows the open-deal row set. This is not the average of won deals.

### Average probability

Mean stage weight of open deals, shown as a percent.

`avg(stage_weight) * 100` over open deals. If there are no open deals, the average is 0.

This is not a blended forecast of won and lost, and it is not a field the rep typed on the deal.

### Average aging

Mean whole days from `created_at` to now, for open deals.

`avg(floor(days between created_at and now))` over open deals.

Aging is age since create, not days since the last stage change, because stage changes are not stored. A rep sees the age of their open deals. A manager sees the organization's.

### High-probability deals

Count of open deals with stage weight of at least 0.75.

`count(open deals where stage_weight >= 0.75)`.

Today that set is the negotiate stage. Propose is 0.50 and is not included.

### New pipeline this month

Sum of `amount` on deals created from the first day of the current calendar month through now, whether or not they are still open.

`sum(amount) where created_at >= month_start and created_at < now`.

This is creation value, not won value. Role scope still applies, so a rep sees deals they own that were created this month.

### Sales velocity

Estimated value per day from the open book, the period win rate, the average open deal, and the average cycle of period wins.

`(active_opportunities * (win_rate / 100) * average_deal_size) / average_cycle_days`.

Average cycle days is the mean of `(coalesce(closed_at, created_at) - created_at)` in whole days, for `closed_won` deals in the period, keeping only samples greater than 0. If the cycle is 0 or there are no open deals, velocity is 0.

A rep's velocity uses their opportunities, their win rate, and their won cycle. A manager's uses the organization. Do not mix a rep's open count with the team's win rate.

### Pipeline by stage

Two series. Count of deals in qualification, discover, propose, negotiate, and closed_won. Sum of amount in those same stages. Closed_lost is not a funnel bar. It is in the win/loss split.

Role scope applies before the group. A rep's funnel is their deals.

### Win and loss split

Count of `closed_won` and count of `closed_lost` in the scoped set. The period win rate is the stricter period version of this split.

### Aging bands

Count of open deals by days since `created_at`: 0–30, 31–60, 61–90, and 91 or more.

A deal in 90+ has been open at least 91 days. It is not a statement that the last activity was 91 days ago.

### Deal size bands

Count of open deals by amount, in major currency units, not converted: small is under 500,000, mid is 500,000 through 2,500,000, large is above 2,500,000.

A USD deal and an INR deal can fall in the same band because the bands are absolute numbers. Say the currency when the book is mixed.

### Pipeline by owner

Sum of open `amount` grouped by `owner_user_id`, top 10, with the name from `accounts.setup_users`. A null owner is "Unassigned".

A manager sees up to ten owners. A rep usually sees one bar, their own, plus unassigned only if they somehow own a null owner row, which they do not under owner scope. This chart is an organization view. Show the full top 10 to admin and sales manager. For a rep, the honest result is their own open total, not other people's bars.

### Lost reasons

Count of `closed_lost` deals grouped by `lost_reason`, top 8. Blank reason is "Unspecified".

Admin and sales manager see the organization's reasons. A rep sees reasons on the losses they own.

### Won revenue trend

Sum of won `amount` for each of the last six calendar months, oldest first. The month uses `closed_at`, or `created_at` when close time is missing.

A rep sees their six months. A manager sees the organization's six months.

### Top open opportunities

The ten open deals with the largest amount, with title, stage, company name, owner name, aging days, and stage weight percent.

A rep sees their own top deals, at most ten. A manager sees the organization's top ten. This is a list the dashboard shows beside the charts. The SQL executor may return these rows. It is still a dashboard metric, not a separate export of every deal.

## 2. Core metrics beyond the dashboard

These are the next numbers a B2B sales or finance lead asks for. They are calculated from tables that exist. They are not all drawn on the home dashboard.

Who can see a metric is stated on that metric. Calculation for a rep or presales or viewer always starts from their owner scope. Admin and sales manager use the organization. Finance uses the organization on finance metrics and does not receive the sales-only book as a management view.

### Average sales cycle

Mean days from `created_at` to `coalesce(closed_at, created_at)` for `closed_won` deals in the period, using only positive durations.

This is the cycle input inside sales velocity, exposed on its own so someone can ask "how long do we take to win" without the velocity formula.

Admin and sales manager see the organization. Sales rep, presales, and viewer see their own wins. Finance and marketing do not get this metric.

### Quote acceptance rate

Accepted quotes divided by quotes that reached a decision.

`count(status = accepted) / count(status in accepted, rejected)` for quotes in the period, using the quote's decision timestamp when the column is set, otherwise `updated_at`. Draft, sent, and void are not in the denominator. Sent-but-not-decided quotes are a separate open-quote count.

Join `crm.quotes` to `crm.deals` and apply owner scope on the deal owner. Admin and sales manager see the organization. Sales rep, presales, and viewer see quotes on deals they own. Finance may see the rate for the organization because accepted quotes become invoices they approve.

### Open quote value

Sum of quote totals where status is `draft` or `sent`.

This is uncommitted price, not pipeline. Pipeline remains the open deal amount. A deal can have a quote total that differs from `deals.amount`. Report them as different numbers.

Same access as quote acceptance rate.

### Expected close value

Sum of open deal `amount` whose `expected_close_date` falls in the asked period.

`sum(amount) where stage is open and expected_close_date in period`.

Weighted expected close multiplies each amount by the stage weight first. Deals with a null expected close date are excluded and should be counted aside as "no close date", not dropped silently.

Admin and sales manager see the organization. Sales rep, presales, and viewer see their own open deals. Finance does not get this as a collections number.

### Lead status mix

Count of `crm.contact_profiles` where `crm_status = active`, grouped by `lead_status`.

Values are new, contacted, qualified, disqualified, and converted. Join CDP only when the question also asks for name, email, industry, or contact type.

Admin and sales manager see the organization. Sales rep, presales, marketing, and viewer see contacts they own. Finance sees the organization only when the question is about customers tied to invoices, not as a lead-generation report.

### Unassigned leads

Count of active contact profiles with `owner_user_id` null and lead status not converted and not disqualified.

This is the pool nobody owns. Admin and sales manager see it. A rep does not see other people's unassigned pool unless the product's list scope already returns those rows to them. The reports agent shows the pool to admin and sales manager.

### Days since last touch

For a contact or a deal, the number of days from the latest related activity `created_at` to now.

Deal touch reads `crm.deal_activities`. Contact touch reads `crm.contact_activities`. If there is no activity, say there is no logged touch. Do not substitute `updated_at` and call it a meeting.

Admin and sales manager can ask for the organization, usually as a count of open deals with no touch in 14 days. A rep can ask for their own book. Viewer can ask for their own book.

### Activity volume

Count of activities by `type` (`call`, `meeting`, `email`, `sms`, `note`, `task`) in the period, from deal activities and contact activities.

State which table the count came from. Adding both tables double-counts a meeting that was logged twice. If the question is "meetings held", count rows of type `meeting` and say whether the source is the timeline, the appointment table, or both.

Admin and sales manager see the organization. Sales rep, presales, and viewer see activities they created or that sit on records they own. Marketing sees activity on contacts they own. Finance does not get an activity scorecard.

### Open task count

Count of contact activities with `type = task` and `task_status` in `open`, `in_progress`.

Overdue is `due_at < now` and status not completed. Completed tasks are not open.

A rep sees tasks assigned to them (`assignee_user_id`) or created on their records. Admin and sales manager see the organization. Viewer sees their own and cannot complete them from a report.

### Invoice outstanding

Sum of `crm.invoices.total` where `status` is `sent` or `overdue`, minus nothing further unless a partial payment column exists. Paid and void are excluded. Draft is not yet money owed by the customer.

Group by currency. Join the company for the account name.

Admin and finance see the organization. Sales manager may see it because they can view all records and can open finance by deep link. A sales rep may see outstanding only for invoices tied to deals they own. Marketing and viewer do not get a collections book.

### Overdue amount

Sum of invoice `total` where `status = overdue`, or where `status = sent` and `due_at < now` if status was not flipped yet. Say which rule was used. Prefer the stored `overdue` status when it is set, and mention sent invoices past `due_at` as a second figure if they disagree.

Same access as invoice outstanding.

### Collected revenue

Sum of invoice `total` where `status = paid` and `paid_at` is in the period.

This is cash collected in CRM, not the payment-gateway ledger. `payment_method` may be `offline`, `manual`, `stripe`, or `razorpay`. A gateway event in `crm.payment_gateway_events` can support the paid invoice. It is not a second sum added on top of the invoice total.

Admin and finance see the organization. Sales manager can see the organization. A rep can see paid invoices on their deals. Marketing and viewer do not.

### Approval queue

Count of invoices whose `approval_status` is `pending_approval`.

This is the finance work queue. The invoice `status` may still be `draft`. Do not call these collected or sent.

Admin and finance see the queue. Sales roles see that their quote produced a draft waiting on finance, for invoices on their deals. They do not see other reps' approval queue.

### Contract ARR

Sum of `crm.contracts.arr` where `status = active`.

Null `arr` adds nothing and should be counted as "active contracts with no ARR". Do not invent ARR by multiplying invoice totals. Billing frequency on the contract is `monthly`, `quarterly`, or `annual` when set.

Admin, finance, and sales manager see the organization. A rep sees contracts on companies or deals they own. Marketing and viewer do not get ARR.

### Renewal book

Count and ARR of active contracts whose `ends_at` falls in the asked window, plus the count that already has a `renew_deal_id`.

A contract with no renewal deal is the gap. Admin, finance, and sales manager see the organization. A rep sees renewals on their accounts.

### Product revenue

Sum of invoice line amounts for `status = paid` invoices, grouped by `product_id`, joined to `inventory.products` for the name.

Use invoice lines for collected product mix. Use order lines for booked product mix. Say which one. Do not add invoice headers and lines. One-time versus recurring comes from the product `billing_type`, which is `one_time` or `recurring`.

Admin, finance, and sales manager see the organization. A rep sees product mix on their paid invoices or orders. Marketing does not get product revenue unless the question is only about a catalog count, which is not revenue.

### Average discount

Mean of quote or invoice `discount_amount` divided by the pre-discount total, for sent or accepted quotes, or for sent or paid invoices. State the document.

Access follows the document. Discount approval rights belong to admin and sales manager. The metric is still visible to a rep for their own quotes.

## 3. Next-tier metrics

These are valid B2B questions. Several cannot be computed honestly from the tables that exist today. The SQL executor returns the number only when the formula below says the inputs exist. Otherwise it says what is missing and does not approximate with a keyword read of notes.

### Quota attainment

Won revenue in the period divided by the rep's target for that period.

The CRM does not store a monthly target per rep. Until that table exists, this metric is undefined. Do not use pipeline or a verbal target in a note as the denominator.

When a target table exists, admin and sales manager see every rep, a rep sees their own attainment, and finance sees organization attainment against the summed target. Viewer sees their own if they have a target.

### Stage conversion

Share of deals that moved from one stage to the next during a period.

The CRM stores the current stage only. A true conversion rate needs a stage-history row with from, to, who, and when. Current counts by stage are the dashboard funnel, not a conversion rate. Do not compute "propose to negotiate" by comparing today's stock.

### Won reason mix

Group of `closed_won` deals by why they were won.

There is no won-reason column. Lost reason exists. Do not copy `lost_reason` or parse notes into a won-reason chart.

### Time in stage

Days a deal spent in each stage.

This needs stage history. `updated_at` only says the row changed, not which stage it left. Do not report time in stage until history exists.

### Forecast versus target

Weighted pipeline or expected-close value compared with a stored target.

Weighted pipeline and expected-close value exist. The target does not. Report the forecast side and say the target is not stored.

### Territory performance

Won revenue, pipeline, and activity counts grouped by region or territory.

Company location has an address and an optional region code where that column exists. There is no territory assignment table that maps reps to regions as a maintained hierarchy. A region rollup is allowed only by grouping a real location column. A rep still sees only their scope. Admin and sales manager see the organization.

### Lead-source conversion

Count of leads and count of converted leads grouped by `lead_source`, then won amount through `converted_deal_id`.

`lead_source` exists on the contact profile. This metric is computable. It becomes ROI only when a spend amount exists for that source. Spend for ZoomInfo, ads, or campaigns is not a CRM deal column. Report conversion. Do not invent cost.

Admin and sales manager see the organization. Marketing sees sources on contacts they own, not won revenue for the whole team. A rep sees sources on their own contacts.

### Campaign attribution

Revenue joined from a campaign id on the lead to the deal and the invoice.

That chain is not a complete CRM fact yet. Do not build a first-touch or last-touch ROI number by guessing from notes. Marketing can count campaign rows in the marketing tables. They cannot be given a fabricated revenue attribution.

### Email open rate and click rate

Opens divided by emails sent, and clicks divided by emails sent.

Those events are not stored as reportable columns on `contact_activities` today. A count of email activities is activity volume, not an open rate.

### Attach rate

Share of won deals or paid invoices whose lines include an add-on.

Computable from `invoice_lines` or `quote_lines` joined to add-ons, for admin, finance, and sales manager at organization scope, and for a rep on their own documents. Define the denominator as won deals or as paid invoices and keep it consistent.

### Customer retention

Active contracts that reached `ends_at` and are still `active` with `auto_renew`, versus contracts that became `expired` or `cancelled`.

Computable from `crm.contracts`. Churned people in CDP `contact_type = churned` are a person flag, not ARR churn. Do not mix the two without labelling them.

Admin, finance, and sales manager see the organization. A rep sees their accounts.

### Meeting completion

Appointments in the period that have a later meeting activity, a transcript, or a meeting-assist session, divided by appointments scheduled.

Computable by joining `crm.appointments` to activities or `crm.meeting_assist_sessions`. Say which link was used. Admin and sales manager see the organization. A rep sees meetings they own. Transcript text itself is not the metric. The knowledge-graph executor reads the transcript only when the user asks why.

### Agent operations

Counts of enrichment, scoring, nurture, and lifecycle jobs by status.

These are operations metrics for admin and sales manager. They are not lead counts and not pipeline. A failed job is not a disqualified lead.

### Sequence and repeat-activity compliance

Share of completed tasks that produced the next scheduled task.

Repeat rules and required call outcomes are not stored as a closed status set the way a finished sequence product would store them. Do not score compliance against an outcome list the database does not contain.
