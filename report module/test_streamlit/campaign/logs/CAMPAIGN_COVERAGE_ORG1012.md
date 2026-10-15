# Campaign coverage — org 1012 / admin 1054

Generated from live Postgres `worktual_bigint` and certified `run_kpi` (same SQL the Streamlit pack executes).

| | |
|---|---|
| Organization | **1012** |
| Branch | **1004** (`Default`) — only Campaign workspace for this org |
| User | **1054** (Accounts `setup_users.organization_id = 1012`) |
| Role | **admin** → `scope=org` (all branch campaigns) |
| Windows | last **1 / 7 / 30** days (UTC rolling `[now-N, now)`) |

**Verdict: not 100% correct.** Scalars for Dashboard T1 **match** independently written Postgres. Many **allowed dimensions** are advertised on the KPI card but the SQL expressions are not valid on that grain, so `run_kpi` errors. Streamlit NL was started separately (`test_streamlit/campaign/logs/nl_live.md`).

## Independent logic vs Postgres (last 7 days UTC)

Window used in the matrix run: **`[2026-09-26, 2026-10-03)`**.

| Check | `run_kpi` | Hand SQL on `campaign.*` | Result |
|---|---|---|---|
| `campaigns_ran` (live/completed/cancelled, drop PPC-only) | **345** | **345** | MATCH |
| `messages_delivered` (outcome `sent`) | **333** | **333** | MATCH |
| All saved campaigns (draft+scheduled+live+…) | no certified KPI | **1075** | Inventory ≠ ran. “How many campaigns are there?” must **not** use `campaigns_ran`. |

## Certified matrix (`run_kpi` × all allowed dimensions × 1d/7d/30d)

- **810** executions
- **675 OK** (83%)
- **135 FAIL** (17%)

### Fail class A — grouping column does not exist on that grain (~90 of 135)

Postgres (surfaced as `REPLAN` / “That grouping is not available on this warehouse”):

| KPI grain | Allowed dim that breaks | Why |
|---|---|---|
| Campaign count (`campaigns_ran/sent/failed`) | `channel` | `dimensions.yml` uses `channel` but `campaigns` has no channel column (channels live on `campaign_channels`) |
| Recipient KPIs | `campaign` | expr is `campaign_name`; join alias is `campaigns.name` |
| Recipient KPIs | `outcome` | outcome is a CASE, not a selected/aliased column in those templates |
| Rates / A/B / bounce | `campaign` | same `campaign_name` miss |
| `event_submissions` | `event` | expr `public_id` not valid on that FROM |
| `library_ops` | `channel` | library view column is `primary_channel`, not `channel` |
| `mailbox_send_ready` | even **no** dimension | template still emits a bad GROUP BY / column |
| `live_send_pressure` | `batch_status` | `status AS batch_status` is ambiguous (batch vs campaign status) |

These fail **on all three windows** (1/7/30d) because they are SQL shape bugs, not empty data.

### Fail class B — ambiguous time column

`pending_recipients` (time_kind timestamptz on `created_at`): join of `r` + `campaigns` + batches. Unqualified `created_at` in `{{time_sql}}` → `column reference "created_at" is ambiguous`. **All dims and all three windows fail** except where grouping already failed first.

### What did work

Scalars and dims whose expr matches the FROM (examples): `status` / `source_channel` / `created_by` / `day` / `week` / `month` on campaign KPIs; `channel` on recipient KPIs that already select `b.channel AS channel`; CDP `city`/`country`; most T3 config counts.

Empty windows (1d with no launches) still **OK** with 0 rows or 0 counts — that is correct, not a logic fail.

## Streamlit NL (same pack as the campaign app)

Identity `1012 / 1004 / 1054`. **46** questions (T1–T2 stems × 1/7/30d + 3 dimension asks + inventory). Trace: `test_streamlit/campaign/logs/nl_live.md`.

**Correct KPI + SQL OK:** campaigns ran/sent/failed, email open rate, click rate, monitor preview, messages delivered (incl. by channel), CDP contact count, campaigns ran **by status**.

**Wrong KPI (logic/meaning):**
- “Delivered **by channel**” 7d/30d → `messages_delivered` (still grouped, but not `delivered_by_channel`)
- “Delivery **trend by day**” → `messages_delivered` with a day slice (not `delivery_trend`)
- “How many messages were **sent**” → `messages_delivered` (T2.2 vs T2.5)
- “How many campaigns **are there**” → `campaigns_ran` = **1051**, while Postgres inventory is **1075** saved rows

**KPI id right, execution failed:** `unique_opens` (all three windows); `email_cap_health` 1d and 30d (Domain added a channel breakdown the template cannot group); `notifications_unread` planned but no rows in the turn.

7d `campaigns_ran` NL **347** vs hand SQL **345** — rolling UTC window moved between the two runs (~20 min). Not a formula bug.

## Not 100% until

1. Dimension SQL matches grain (join `campaign_channels` for campaign-by-channel; use `campaigns.name`; alias delivery CASE as `outcome`; qualify `r.created_at` / `b.status`).
2. Drop dims from `allowed_dimensions` when the template cannot group them.
3. Certified `campaigns_total` or free SQL on `rpt.campaigns` for inventory.
4. NL examples: inventory ≠ ran; sent volume ≠ delivered; trend KPI vs grouped delivered.
