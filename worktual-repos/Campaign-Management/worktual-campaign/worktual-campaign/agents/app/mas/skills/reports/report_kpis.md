# report_kpis

## purpose
Answer dashboard KPI / metrics questions (open rate, click rate, delivery, sent volume, period totals). Read-only.

## when active
Domain selected `report_kpis`. User asks for rates, volumes, or “how are we doing” metrics — not a named campaign deep-dive or ontology graph.

## KPI glossary (Dashboard parity — mandatory)
Use **exact field names** from tool results (`dashboard_parity` / `portfolio_totals` / `query_analytics`).

| User wording | Field to cite |
|--------------|---------------|
| Past tab / campaigns in past / all-time completed | **past_all_time** (`campaign_status_counts` or `monitoring_tab_counts`) |
| launched / ran / went live (campaign count) | **campaigns_ran** (always name Overview period) |
| sent (campaign count on Dashboard) | **campaigns_with_send** |
| failed (campaign count on Dashboard) | **campaigns_with_failure** |
| message volume / deliveries | **sent** or **messages_sent** |
| message failures (volume) | **failed** or **messages_failed** |
| per-channel campaign count | **channel_rollup[].campaigns** (ran + channel selected) |
| open / click rate | **open_rate_display**, **click_rate_display** (email engagement) |

- **Do not** answer “how many campaigns ran” with **sent** or message counts.
- **Do not** mention draft/scheduled/in-view totals unless the user explicitly asks for status breakdown (**live_count**, **draft_count**, etc.).

## chat flow

### 1 — Check memory first
Read dashboard period / relative window from session and recent chat. **`dashboard_snapshot` is context only** — still call **GET_PORTFOLIO_PERFORMANCE** before stating KPIs.

### 2 — GET_PORTFOLIO_PERFORMANCE (required for period performance)
Call with **`mode=launch`**. Period alignment:
- Presets: **`relative`** from `dashboard_period` (today → today, weekly → last_7_days, monthly → last_month).
- **Custom calendar** (e.g. 1 Sep–27 Sep): **`from_date` + `to_date`** only — do **not** send `relative`.
- **All**: omit relative and dates for launch KPIs; pass **`activity_from_date` / `activity_to_date`** when in session for chart parity.
- Omit **`channels`** unless the user asked to filter channels.

Cite **`portfolio_totals`** only (same JSON as Overview). **sent** = message deliveries; **campaigns_with_send** = campaign count (Overview “Delivered” hint).

### 3 — query_analytics (secondary)
Use only when SSOT tool is unavailable or user asks ontology/semantic-only metrics. Pass **`metrics`** explicitly. **Do not** use `monitoring_tab_counts` for “last week performance”.

**LIST_MONITOR_CAMPAIGNS** with `bucket=all` + matching `relative` returns **totals_all_matched** from the API.

Use **ask_semantic_layer** only if campaign_sql and list tools miss.

Never invent rates or counts without a tool result.

### 3 — Answer
Speak percentages and volumes as returned. Do not rescale rates.

### 4 — Follow-up
- Named list / channel list / campaign audience → Domain switches to `report_campaigns` (LIST_MONITOR_CAMPAIGNS — not query_analytics alone).
- Past tab count / how many in past → stay on **query_analytics** (`past_all_time`), not portfolio period totals.
- Historical graph / “have we run X before” narrative analytics → `report_ontology` (ask_ontology).
- Stop/pause → Domain hands off to monitoring recovery (not this skill).

## tools (this skill — schemas passed separately)
- **query_analytics** — KPI / report metrics.
- **ask_semantic_layer** — low-level semantic KPI fallback.
- **ROUTE_TO_MODULE** — clear cross-module action only.

## completion
Successful KPI answer (or clear empty/no-data) from a metrics tool.

## must not
- Call ask_ontology, LIST_MONITOR_CAMPAIGNS, GET_CAMPAIGN_*, LIST_EVENTS, or STOP_*.
- Invent metrics.
- Switch skills (Domain only).

## resume
Continue with the same period/metrics thread unless the user changes topic.
