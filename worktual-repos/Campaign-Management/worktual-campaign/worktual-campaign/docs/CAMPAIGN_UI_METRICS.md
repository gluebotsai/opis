# Campaign UI metrics — Dashboard and Contact (customer)

What the product **shows on screen** today. Formulas match the Dashboard / contact panels in the frontend (`DashboardOverviewPanel`, `DashboardCampaignMonitoringPreview`, `ContactCampaignActivityPanel`).

Period filters on Dashboard (Today, Last 7 days, custom, …) apply to campaign **launch date** in the campaign timezone (default Asia/Kolkata).

---

## 1. Dashboard Overview

Surface: Dashboard → Overview right panel (`DashboardOverviewPanel`).

### Top KPI cards (5)

| UI label | What the big number is | Hint under the card |
|----------|------------------------|---------------------|
| **Campaigns ran** | Count of campaigns that ran in the period (`live` + `completed` + `cancelled`) | `{live} live · {completed} completed · {period}` |
| **Sent** | Count of **campaigns** that had at least one delivery (not message volume) | `{N} messages delivered · {period}` |
| **Failed** | Count of **campaigns** that had at least one send failure | `{N} message failures · {period}` |
| **Open rate** | Unique email opens ÷ email delivered (shown as %) | `{opens} unique email of {delivered} delivered` |
| **Click rate** | Unique clicks ÷ delivered on click-tracked channels (shown as %) | `{clicks} unique email of {delivered} delivered` |

Notes:

- **Sent** / **Failed** headline numbers are **campaign counts**. Message volumes only appear in the hints.
- Open rate is **email only** (open pixel). Click rate uses channels that track clicks (email; app/web push when present).
- Rates use **unique** openers/clickers over **delivered** (stubs and bounces are not delivered).

### Delivered by channel (cards)

One card per channel that had volume in the period:

| UI label | Meaning |
|----------|---------|
| Channel name + **N campaigns** | How many ran campaigns used that channel |
| **Delivered** | Messages delivered on that channel |
| **+ N stub** | Demo/stub sends (not real inbox delivery), if any |
| **Opens** | Unique opens — only when the channel tracks opens (email) |

### Delivery trend (chart)

Area chart over days in the period:

| Series | Meaning |
|--------|---------|
| **Delivered** | Messages delivered (all messaging channels) |
| **Opens (email)** | Unique email opens |
| **Clicks (email)** | Unique email clicks |

### Campaign monitoring preview (list, max 5)

Each row (not for **scheduled** tab):

| UI label | Meaning |
|----------|---------|
| **Targeted** | Audience / selected size for that campaign |
| **Delivered** | Messages delivered |
| **Opened** | Unique opens (— if channel does not track opens) |
| **Clicked** | Unique clicks (— if not tracked) |
| **Audience** | `audienceCount` (same idea as targeted) |

Plus status chip, channels, and launch/schedule time.

### Events tracking preview (if shown)

| Shown | Meaning |
|-------|---------|
| Submissions · opens · fields | Form/event counters on opportunity events |

---

## 2. Contact (customer) detail

Surface: Audience / Contacts → open a person → **Campaign performance** panel (`ContactCampaignActivityPanel`).

### Campaign performance KPIs (3)

| UI label | Meaning |
|----------|---------|
| **Delivered** | How many times this contact was successfully sent (prefer email `sent`; otherwise sum across channels) |
| **Open rate** | Opens ÷ delivered for this contact (shown as %) |
| **Click rate** | Clicks ÷ delivered for this contact (shown as %) |

Notes:

- Prefer **email** channel stats when present; otherwise roll up all channels.
- Opens/clicks can fall back to `campaign_contact_engagement` (`email_open_count` / `email_click_count`) when channel stats are thin.
- If `email_unsubscribed` is true, a warning shows: future email may be suppressed.

### Campaign received (list)

Not rate cards — a history list of campaigns this contact was sent on:

| Shown per row | Meaning |
|---------------|---------|
| Campaign name | Link/title of the campaign |
| Relative time | When last sent (e.g. `2h`, `Now`) |
| Channel chips | Channels that actually sent to this contact |
| Outcome | Sent / Failed / Skipped / Pending / Not sent |

---

## 3. Related: one campaign (monitoring detail)

Not the contact page, but the other place operators see deep metrics — campaign monitor / detail (`CampaignMonitorDetailPage`, `CampaignMonitorPerformance`).

### Per messaging channel (KPI pills)

| UI label | Channels |
|----------|----------|
| **Selected** | All |
| **Sent** | All |
| **Failed** | All |
| **Opened** | Email |
| **Clicked** | Email (and click-tracked push/web where wired) |

Detail line can also show: Bounced, Unique opens/clicks with %, **CTOR**, Stub, Pending, live sends, Paused.

### Email A/B (when enabled)

| Shown | Meaning |
|-------|---------|
| Split % A / B / holdout | Traffic split |
| Open rate / Click rate bars | Variant A vs B |
| Sent · Opens · Clicks per variant | Counts + % |
| Holdout sent | Remainder after winner |

### PPC channel (when present)

Impressions, clicks, CTR, spend, CPC, conversions, CPA, daily budget.

### Audience totals (overview pane)

`selected · sent · stub · missed` (failed + skipped + not_sent + pending).

---

## Quick map

| Place | Metrics shown |
|-------|----------------|
| **Dashboard Overview** | Campaigns ran, Sent (campaigns), Failed (campaigns), Open rate, Click rate; per-channel Delivered/Opens; trend Delivered/Opens/Clicks |
| **Dashboard campaign preview** | Targeted, Delivered, Opened, Clicked, Audience |
| **Contact (customer)** | Delivered, Open rate, Click rate; list of campaigns received; unsub warning |
| **Campaign detail** | Selected/Sent/Failed/Opened/Clicked per channel; A/B; audience sent/stub/missed |

---

## Related docs

| Doc | Use |
|-----|-----|
| [`CAMPAIGN_METRICS_SQL_AGENT.md`](./CAMPAIGN_METRICS_SQL_AGENT.md) | Formulas, dimensions, SQL agent responsibilities |
| [`CAMPAIGN_DB_ONTOLOGY.md`](./CAMPAIGN_DB_ONTOLOGY.md) | Tables behind these numbers (`campaign_send_recipients`, `campaign_contact_engagement`, …) |
