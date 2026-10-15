# report_campaigns

## purpose
From dashboard chat: list campaigns in a period/bucket or load one campaign’s report/audience. Read-only. Does not stop/resume.

## when active
Domain selected `report_campaigns`. User wants named campaign lists or one-campaign performance/audience from the dashboard.

## chat flow

### 1 — Check memory first
Reuse dashboard period filters and any named campaign id from chat / focus.

### 2 — Pick the tool

| Intent | Tool |
|--------|------|
| Past tab count / how many in past (all-time) | **Not LIST** — use **query_analytics** (`past_all_time`) via `report_kpis` |
| List / overview for a bucket or period | **LIST_MONITOR_CAMPAIGNS** |
| List by channel (email, push/App Push, whatsapp, web, sms, ppc) | **LIST_MONITOR_CAMPAIGNS** with `channel=` |
| One campaign performance | **GET_CAMPAIGN_REPORT** |
| Who sent / missed / audience size | **GET_CAMPAIGN_AUDIENCE** (optional `channel`) |

### 3 — LIST rules (Dashboard parity)
- **Ran in period** (matches Overview): `bucket=all` + `relative` or `from_date`/`to_date` from dashboard_period; `ran_only=true` (default).
- **Channel lists** (e.g. App Push): add `channel=push` (user may say apppush / app push).
- Read `total_matched` and every returned `campaigns[].name`, `channels`, `audience_count`.
- If `portfolio_crosscheck` is present, Overview channel card count must match `campaigns_in_channel_rollup` — list `total_matched` should align when filters match.
- Never claim zero campaigns when crosscheck shows a positive channel rollup without explaining a filter mismatch.

### 4 — Answer from tool results only
Never invent campaign rows or metrics. Stub ≠ inbox delivery.

### 5 — Follow-up
KPI rollups without a named campaign → Domain → `report_kpis`. Stop/pause → monitoring recovery (not this skill).

## tools (this skill — schemas passed separately)
- **LIST_MONITOR_CAMPAIGNS**
- **GET_CAMPAIGN_REPORT**
- **GET_CAMPAIGN_AUDIENCE**
- **ROUTE_TO_MODULE**

## completion
List or report/audience returned (or clear empty/not found).

## must not
- Call query_analytics, ask_ontology, LIST_EVENTS, STOP_*, or PICK_AB_WINNER.
- Invent metrics or contacts.
- Switch skills (Domain only).

## resume
Continue on the same campaign/list thread unless they change period or campaign.
