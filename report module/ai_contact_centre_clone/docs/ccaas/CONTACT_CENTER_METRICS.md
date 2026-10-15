# Contact Center metrics

How Reports, the dashboard, and Analytics calculate each number in this product.
Every formula below is the one `cc-core` actually runs. Do not average a rate of rates, and do not count a conversation twice because it has many messages.

The reporting period is half-open. A conversation is in the period when its reporting timestamp is greater than or equal to the start and strictly less than the end.
An agent report adds `assigned_user_id` or `assigned_agent_id` equal to that person. An admin report does not add that filter, so it includes every conversation in the organization.

Source: `apps/cc-core/src/services/reporting.ts` (`AGGREGATE_SQL`, `buildPerformanceKpis`).
Rates use one decimal: `round(numerator / denominator * 1000) / 10`. If the denominator is 0, the rate is 0. A duration that has no rows is null and the UI shows an em dash, not zero.

---

## Handled

Handled is a conversation that finished in the period, not a message and not an offer that is still ringing.
The row counts when `status` is `resolved` or `closed`, or when `ended_at` is set, even if wrap-up has not stored a disposition yet.

```
handled = COUNT conversations
  WHERE status IN ('resolved', 'closed') OR ended_at IS NOT NULL
```

Dashboard use: the Handled KPI, the daily volume bars, and the denominator of resolution rate.
A conversation that is still `bot_active`, `queued`, or `assigned` is not handled.

## Handled change versus the prior period

This compares handled in the selected window with handled in the immediately previous window of the same length.
It is a percent change of counts, not a change of the resolution rate.

```
change = round((handled_now - handled_prior) / handled_prior * 1000) / 10
```

If the prior window handled nothing and this window also handled nothing, the change is 0.
If the prior window handled nothing and this window handled some, the change is null and the dashboard prints "New" rather than a percent.

## Resolved

Resolved counts conversations that have `resolved_at` set inside the reporting rules for the period.
Ending a call without saving a resolution does not set `resolved_at`, so that conversation can be handled and still not resolved.

```
resolved = COUNT conversations WHERE resolved_at IS NOT NULL
```

## Resolution rate

Resolution rate is resolved divided by handled, for the same organization and the same period.
It is not resolved divided by every conversation that was created, and it is not an average of each agent's resolution rate.

```
resolution_rate = round(resolved / handled * 1000) / 10
```

When handled is 0, the rate is 0.
On the agent table, each row uses that agent's own resolved and handled. The org KPI does not average those row percents.

## Transferred

Transferred counts conversations that have `transferred_at` set.
A consult that was cancelled before the other agent accepted does not set this timestamp, so it is not a transfer.

```
transferred = COUNT conversations WHERE transferred_at IS NOT NULL
```

Dashboard use: the transfer KPI. It is a count, not a percent of handled, unless a later view divides it explicitly.

## First-response count

This is how many conversations received a first reply, which is `first_response_at` being set.
A conversation the bot or agent never answered is excluded from every SLA and first-response average.

```
first_response_count = COUNT conversations WHERE first_response_at IS NOT NULL
```

## First-reply SLA rate

The product SLA is 60 seconds from assignment to the first reply, not from the moment the customer arrived.
A conversation is inside SLA only when both timestamps exist and the gap is 60 seconds or less.

```
within_sla = COUNT conversations
  WHERE first_response_at IS NOT NULL
    AND assigned_at IS NOT NULL
    AND EXTRACT(EPOCH FROM (first_response_at - assigned_at)) <= 60

sla_rate = round(within_sla / first_response_count * 1000) / 10
```

If nobody has a first reply, the dashboard shows an em dash, not 0%.
The caption is "{within_sla} of {first_response_count} first replies". Missed SLA is `first_response_count - within_sla`.

SLA is also split by channel and by handler. Handler is `AI` when the conversation was still on the bot, and `Agent` when a person was assigned.
Each slice uses the same 60-second rule on its own first replies. Do not add the slice rates together.

## Average first response

Average first response is the mean number of seconds from `assigned_at` to `first_response_at`.
Rows missing either timestamp are left out of both the sum and the count. The result is rounded to a whole second. If no row qualifies, the value is null.

```
avg_first_response_seconds = round(AVG(
  EXTRACT(EPOCH FROM (first_response_at - assigned_at))
))
```

Do not average the per-channel averages. Recompute the average from the underlying timestamps.

## Average handle time

Average handle time is the mean number of seconds from `assigned_at` to the end of the conversation.
The end is `resolved_at` when it exists, otherwise `ended_at`. A conversation with no assignment, or with neither end timestamp, is excluded.

```
avg_handle_seconds = round(AVG(
  EXTRACT(EPOCH FROM (COALESCE(resolved_at, ended_at) - assigned_at))
))
```

The dashboard prints this as a duration (`45s`, `12m`, `1h 57m`), not as a raw second count, except in CSV where the column is seconds.
Agent rows may show the same value in minutes (`avg_handle_seconds / 60`, one decimal). That display must not be averaged again to rebuild the org AHT.

## Total in period

Total is every conversation whose reporting timestamp falls in the window, including ones still open.
Handled is the finished subset of that population. Total is not shown as the main Handled card.

```
total = COUNT conversations in the period
```

---

## Dashboard charts

These use the same conversation set as the KPIs. They do not use a second definition of "handled".

### Daily handled

Each day is the count of handled conversations whose reporting timestamp falls on that UTC day inside the selected range.
Days with no handled conversations are still drawn as zero so the axis does not skip a date.

```
daily_handled[day] = COUNT handled conversations on that day
```

### Daily average handle time

Each point is the average handle seconds of the handled conversations on that day, using the same AHT filter as the KPI.
A day with no qualifying conversations is 0 on the chart, while the org KPI stays null when the whole period has none.

### Average daily handled

This is the org handled count divided by the number of days in the chart that had at least one handled conversation.
It is not divided by calendar days that were empty, so a quiet weekend does not shrink the average.

```
avg_daily_handled = round(handled / count(days where daily_handled > 0))
```

### Volume by channel, AI versus support agent

Split handled conversations by `channel`, then by who handled them.
AI is a conversation that finished while it was bot-handled. Support agent is a conversation that finished with a person assigned.
The two series for one channel must add up to that channel's handled count. Do not plot offers or waiting items here.

### Resolution count

The resolved card is the `resolved` count, not the resolution rate.
The rate card next to it is `resolution_rate` from the formula above.

---

## Live monitoring (not the same as Reports)

Monitoring is a snapshot of what is open now. It is not filtered by the report period.

| Metric | Meaning | Calculation |
|--------|---------|-------------|
| Waiting | Customers not yet with a person | Conversations in `queued` or waiting for an offer, not `resolved` or `closed` |
| Active | Customers with a person now | Conversations assigned and not ended |
| Bot active | Customers still with the bot | `status = bot_active` or `bot_active = true` and not handed off |
| Ready agents | People who can take a new offer | `agent_presence.presence_state = ready` |
| Logged-in agents | People in a signed-in presence | Presence in `ready`, `not_ready`, `busy`, `break`, `away`, or `after_contact_work`. `offline` is not logged in |
| SLA at risk / breached | Open items against the due clock | Compared with `first_response_due_at` or `resolution_due_at`, not the 60-second report SLA |
| Offers ringing | Offers not yet accepted or rejected | Open assignment rows still in offered state |

A monitoring waiting count and a Reports handled count must not be added. One is open work. The other is finished work in a period.

---

## Analytics incidents and forecasts

An incident is a missed-contact spike for one channel and queue, not a change to the roster.
The missed-contact rate for that window is missed contacts divided by the contacts that should have been handled in the same window. It does not delete queue members.

A forecast expected volume is the predicted contact count for an hour. Required agents for a recommendation uses that count times a default handle time, divided by the seconds in the staffing window.
That recommendation is text for a supervisor. It does not write `queue_members`.

```
required_agents = ceil(expected_contacts * default_aht_seconds / window_seconds)
```

Peak hour is the clock hour with the highest expected or historical contact count in the chart.
Contributing-factor share is that factor's weight divided by the sum of weights for the incident, shown as a percent. Shares for one incident should add to 100.

---

## Presence time on the agent report

Ready, busy, not-ready, and break hours come from `ccass.agent_presence_history`, not from conversation handle time.
Each history row contributes the seconds between `started_at` and `ended_at` (or now, if the state is still open) that overlap the report window, grouped by `new_state`.

Present days, on a multi-day report, are distinct dates on which that agent had any logged-in presence.
Ready hours on a single-day report are the ready seconds divided by 3600. Do not mix present days and ready hours in one column without the sub-day flag the export already uses.

## What not to do

Do not count messages as conversations.
Do not start the SLA clock at `created_at` or `queued_at`. This system starts it at `assigned_at`.
Do not treat `Regular` shift membership as "on shift now". Live eligibility still requires the business-hours window for that `shift_type` to be open.
Do not average agent SLA percents to get the organization SLA. Recompute within-SLA count divided by first-response count for the whole organization.
