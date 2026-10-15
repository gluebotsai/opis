# CRM reporting: issues, causes, fixes, and the term registry

This note is for the system that plans questions, runs warehouse metrics, and writes the answer. It does not depend on a particular folder layout.

A CRM **lead** is a person whose CDP profile type is lead. The physical column is `cdp.customer_profile.contact_type`. There is no column named `customer_type`. The table name is `customer_profile` (singular). The CRM row lives on `crm.contact_profiles` and joins CDP with `cdp.cdp_id = contact_profiles.account_contact_id` and the same organization.

---

## How a question should run

1. The planner reads the question and chooses the metric (or a list), the object, and any **term** from the registry below.
2. The planner does **not** write SQL for a certified metric.
3. Code looks up the term and fills only slots that metric already allows: time window, row cap, polarity, status.
4. A list (no certified metric) may be written as a query, but only by copying the term’s example. Dates still come from code, not from the model.
5. The answer is sentences (and a table when there are groups or rows). It is never the plan, never a card label, and never raw result dumps.

The planner must not be a keyword scanner. New wording is a new registry row plus one example, not a new rule that matches the sentence.

```text
Question
  → planner picks metric + term
  → registry says what that term means
  → code applies the slot
  → facts
  → short answer that names the window, the sample, or the source field
```

If two terms both fit, ask which one. Do not guess in code.

---

## 1. Leads counted people who are not leads

**What users saw.** “How many leads?” was larger than the CRM lead list. A sales user who owns one lead was told 10.

**Why.** The count used every active CRM contact. It did not require `contact_type = lead`. For a sales user it also included contacts on channel companies, not only rows that user owns. Prospects, customers, and people with no type were included.

**Fix.**

- Every lead count, lead status mix, unassigned-lead count, and lead-source conversion uses active CRM contacts **and** `contact_type = lead`.
- A sales user’s leads are rows they **own** (`owner_user_id` = that user), not every contact in a channel company.
- A list of leads uses the same type filter. A list of “contacts” or “people” does not.
- Graph walks must not treat prospects as leads. If the graph has no type, the number comes from the warehouse count only.
- “How many contacts” is not the lead count.

---

## 2. Region questions fail or show the wrong geography

**What users saw.** Asking for leads by region failed, or the answer used deal location / city instead of the person’s region.

**Why.** `region` is on `cdp.customer_profile`. The reporting contact row never exposed it, so the query was rejected or sent to territory performance. Territory performance is **deal amount by company-location city**. That is not the person’s CDP region.

**Fix.**

- Put `region` on the contact row from the existing CDP join.
- “Leads by region” / “count of leads per region” is the lead count grouped by `region`. Still only `contact_type = lead`.
- “Leads in &lt;a region&gt;” is two results with the **same** region match: the total, then the list (name, company, region, lead status, owner). Match with a contains-style compare so `TN` and `Tamil Nadu` can both hit. Cap the list (50) and say if it is capped.
- Empty region is “Unassigned”. Values such as `disabled` or `invited` are shown as stored. Do not hide them.
- Do not answer person-region from deal city.

---

## 3. Remaining leads show 0 when they should show 1

**What users saw.** 20 leads total, 19 need follow-up, and the answer said **0** remaining. The correct remaining is **1**.

**Why.** Remaining was counted as the follow-up set, or as the overlap of “remaining” and “needs follow-up”. Those two groups were not a split of the same 20. There is also no warehouse column named `needs_followup`. A filter on a column that is not on the contact row cannot be trusted. The model then reported 0.

**Fix.**

- Remaining and follow-up are a **split** of one lead set:

```text
remaining = total − follow-up
20 − 19 = 1
```

- Same population on all three numbers: active leads (`contact_type = lead`). If the CRM screen also drops converted and disqualified, drop them on **all three**, or the numbers will not add up.
- Derive one true/false “needs follow-up” on the contact row. Confirm it against the screen that showed 19 before shipping. Likely inputs: assignment follow-up stage on the contact (`admin_notified`, `owner_notified`, `owner_reminded`, `acted`, empty) and open contact tasks. Every lead in the population is either follow-up or remaining. No third bucket. No overlap.
- Follow-up count = needs follow-up is true.
- Remaining count = needs follow-up is false.
- Never put the follow-up filter on the remaining metric. That is exactly how 19 follow-ups become 0 remaining.
- If the two SQL counts disagree with subtraction, trust `total − follow-up` and say all three numbers from those facts. The answer model must not subtract on its own.

---

## 4. “Not high” and “not good” hit the positive metric

**What users saw.** “Not high” was answered as high-probability deals. “Not good” had no stable meaning.

**Why.** The planner only has examples of the positive case (high = open deals in the late stage, stage weight at least 0.75). The word “high” wins. “Not good” is not a column.

**Fix.** Use the registry (section 8). “Not high” is the complement: open deals with stage weight **below** 0.75. “Not good” is not one filter — ask whether they mean lost, stalled, or flagged. Do not run the high-probability metric for a negated question.

---

## 5. “Recent” was treated as a date that then became all time; “latest” was not a sample

**What users saw.** “Recent” did not mean a clear window. It was either rejected or rewritten to all time or a calendar month. “Latest” was not “the newest few rows”, and the answer did not say the list was incomplete.

**Agreed meaning.**

| Word | Meaning | What to return | What to say |
|---|---|---|---|
| Recent, with no duration | Time window: **last 1 hour** | The metric for that window | “This is the count for the **last 1 hour**.” |
| Latest, with no number | The **10** newest rows by created time | A list, not a full count | “These are the **10 most recently created** …, not the full set.” |
| Both (“latest in the last hour”) | Window **and** cap | Last 1 hour, then 10 rows | Say both. |

- Recent is not “limit 10”. Latest is not “last 1 hour”. Top / biggest is **largest amount**, not newest.
- If they already said “last 7 days” or “latest 20”, use **their** window or number. Do not replace it with the default.
- If they said only “recent” or “latest”, answer with the default **first**, then ask: do you want a specific period, or a specific number of latest records?
- Do not ask that follow-up when they already chose.
- Do not return an empty clarification instead of the default answer.
- Last hour may legitimately be 0. Say 0 for that hour. Do not widen the window until rows appear.
- Code binds the clock for “last 1 hour”. The model must not invent timestamps. “Recent” must not be rewritten to all time.

---

## 6. Lead source is unclear or the wrong field

**What users saw.** Source labels such as `cdp_ingest` with no explanation, or a mix-up with how the person was acquired in CDP.

**Why.** CRM source is `crm.contact_profiles.lead_source` (already linked onto the contact). CDP acquisition channel is a **different** column (`acquisition_channel`). On real data many leads are CRM source `cdp_ingest` while the CDP channel is `web`, `shopify`, or similar. The answer never said which field it used.

**Fix.**

- Lead source breakdown and conversion use **CRM `lead_source` only**.
- The answer says it is the CRM lead source, not the CDP acquisition channel.
- Empty source is “Unknown source”.
- Do not rename `cdp_ingest` into a marketing channel.
- Do not add acquisition channel unless product asks for it as a second breakdown.

---

## 7. The answer shows “card: None”

**What users saw.** A line like `card: None` or a blob of plan JSON (`kpi: null`) instead of a sentence.

**Why.** “No certified metric” on a **list** is a valid plan. That flag was printed to the user. Some UIs also expect a trailing card tag (`kpi`, `bar`, `table`, or `none`) and default to none, then show that tag. A failed number-check can also replace the answer with raw facts.

**Fix.**

- The user-facing answer is prose and, when needed, one table.
- It must not contain a plan, a `kpi` field, or any `card:` line.
- CRM does not use a card tag. Do not add one.
- If the draft answer is JSON or contains `card:`, drop that and keep the sentences. If nothing is left, write the answer again from the facts.
- Do not show internal result labels as the answer.

---

## 8. Term registry

### Why it exists

Many metrics need the same kinds of wording: recent, latest, not high, mine, contacted, stale. Putting that in each metric, or matching words in code, breaks as soon as a new phrase appears. A registry is one list of those operators.

It is helpful because:

- New phrases are new rows, not new question-matching code.
- The planner only **chooses a term id**. It does not invent the filter.
- Code applies one allowed slot, so a certified metric cannot gain a surprise WHERE.
- The answer text is specified on the row (“last 1 hour”, “10 most recently created, not the full set”), so the user is not left guessing whether they saw everything.
- The same term works on deals, leads, quotes, and invoices when the slot fits that object.

### How to use it

1. Keep the registry as data: id, phrases people say, one slot, what code binds, whether it applies to a certified metric or a free list (or both), the sentence to say, and whether to ask a follow-up.
2. Give the planner a short list of ids and one-line meanings (built from that data). Teach with a few full plan examples. Do not paste the whole catalog of metrics into the planner.
3. The planner returns the metric **and** the term id (or the user’s own window / count when they were specific).
4. Code loads that id:
   - **Time** → bind the window (last 1 hour, and so on).
   - **Limit** → list only, newest first, cap 10 unless they asked for another number. Do not cap a count metric.
   - **Polarity** → only if that metric declares high vs not-high. Flip the existing stage-weight test. Do not let the model write the comparison.
   - **Status** → only statuses already allowed (new, contacted, qualified, qualifying, disqualified, converted).
5. On a free list, show **that term’s one example** (the hour filter with bound start/end, or `newest 10`). The query follows the example. Code still supplies the timestamps.
6. Unknown term → do not attach a filter. Ask the planner to pick a known id.
7. Two meanings → ask the user. Do not pick in code.
8. After the answer, ask for a period or a latest count **only** when the row says so and the user did not already specify.

Wrong uses:

- Code scans the question and attaches a filter with no planner choice.
- The model writes filter SQL for a certified metric from the registry.
- One bag of SQL fragments for every term (recent is time, latest is a cap, not-high is a comparison).

### What to put in the registry

**Time**

- `recent` → last 1 hour. Say the window. Ask for a specific period or a latest count only if they did not already give one.
- Named windows the clock already understands (today, last 7 days, last 30 days, this month) stay as the user’s words. They are not “recent”.
- `overdue` → due time already passed (overdue money, open tasks). Not “recent”.

**Sample vs full set**

- `latest` / `newest` → list, created time descending, 10 rows. Say it is not the full set. Ask the follow-up only if they gave no number.
- `top` / `biggest` → largest open deals by amount. Not newest.
- `list` / `show` → rows. `how many` → the count metric, not a list.

**Polarity**

- `high` / `hot` → open deals with stage weight **at least** 0.75 (late stage).
- `not_high` / `cold` / `early` → open deals with stage weight **below** 0.75. Not the high metric.
- `not_good` → do not bind a filter. Ask: lost, stalled, or flagged.
- `good` / `won` → won count or won amount. `bad` / `lost` → lost count, lost amount, or lost reasons. “Not won” is not “lost”.

**Open and closed**

- `open` / `active` / `pipeline` → open deals.
- `closed` → won and lost together only when they asked for closed. Otherwise keep won and lost apart.

**Money**

- Won / booked → won deal amount.
- Paid / collected → paid invoices.
- Outstanding / AR → unpaid invoices.
- Overdue → unpaid and past due.
- Pipeline → open deal amount.
- Bare “revenue”: sales roles → booked; finance → collected; admin → both, labeled, **never added**.
- Do not store a second copy of this policy. Point the revenue term at that rule.

**Who**

- `lead` → `contact_type = lead` only.
- `prospect`, `customer`, `contact` → that type. Not the lead count.
- `unassigned` / `unowned` → no owner. Only when they said unassigned.
- `my` / `mine` → that user’s own rows.

**Lead status**

- `new`, `contacted`, `qualified`, `disqualified`, `converted` → filter the lead count by that status.
- Contacted status is not a logged call. Logged calls are activity volume.

**Health**

- `stale` / `untouched` / `no activity` → days since last touch.
- `old` / `aging` → one average, or age bands. If they did not say which, ask.
- `stuck` / `stall` → the aging number **and** a graph explanation. There is no `stuck` column.

**Size**

- `large` / `small` → existing deal size bands. Do not invent a cutoff in the prompt.

**Rate vs volume**

- `rate` / `percent` → win rate, quote acceptance, or attach rate, matching the object.
- `how many` on that object → the count, not the rate.

**Refuse, do not substitute**

These are not in the warehouse. Say so. Do not map them to a neighbour metric: quota attainment, stage conversion history, won reason, time in stage, campaign attribution, email open rate, sequence compliance.

**Do not put these in the registry**

- A person’s name, a region value (“TN”), a company name. Those are filters on the chosen metric, not operators.
- Why / compare / explain. That is a graph task plus the number, not a WHERE clause.

### Adding a term later

One meaning. One slot: time, limit, polarity, status, scope, or “ask the user”. One example plan. One sentence the answer must say. If a second metric could match, the row says to ask, not to guess.
