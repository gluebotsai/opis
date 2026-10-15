# CRM iframe — live UI modules

Reference for **what Campaign actually renders today** when embedded in CRM (`?embed=1`). Campaign hides its own sidebar in embed mode; CRM owns Marketing chrome and tab labels.

For iframe URLs, auth, and `postMessage`, see [CRM_IFRAME_SETUP.md](CRM_IFRAME_SETUP.md).

---

## CRM modules ↔ iframe paths

| CRM Marketing module (typical) | Campaign iframe path |
|--------------------------------|----------------------|
| **Create campaign** (hub) | `/campaigns/create?embed=1` |
| **Create campaign** (draft chat) | `/campaigns/create/{draftUuid}?embed=1` |
| **Drafts** | `/campaigns/create?tool=drafts&embed=1` |
| **Dashboard** | `/dashboard?embed=1` |

Use **`worktual:campaign-navigate`** for tab switches instead of reloading the iframe when possible.

---

## 1. Create campaign

**Component:** `CreateCampaignHubWorkspace` (hub) → `CreateCampaignChatWorkspace` (draft).

### 1a. Hub (default)

**URL:** `/campaigns/create?embed=1`

| Area | Live UI |
|------|---------|
| Hero | **Your AI Campaign Co-worker** |
| Hub chat | Thread after messages with the hub agent |
| Composer | Text area, **Create campaign** pill, **Send** |
| Shortcut chips | **Recommendations**, **Templates**, **WhatsApp approvals**, **Drafts** (all four render in embed — no embed filter today) |
| Errors | Red banner on hub socket/auth failure |

**Chip behavior (live routes):**

- **Recommendations** → `/campaigns/create/recommendations` (full recommendations workspace)
- **Templates** → same page, `?tool=templates` (embedded template library + **Back**)
- **WhatsApp approvals** → WhatsApp approvals workspace route
- **Drafts** → same page, `?tool=drafts` (draft list — same as Drafts module below)

### 1b. Draft chat (in progress campaign)

**URL:** `/campaigns/create/{draftId}?embed=1`

| Area | Live UI |
|------|---------|
| Layout | Split: co-worker **chat** (left) + **Campaign overview** (right) |
| Chat | User/assistant bubbles, **template cards** in thread, generation progress, “Connecting to co-worker…” when agents socket is down |
| Composer | Text, **+** → **Upload image**, **Upload contact CSV**, **Voice** (mic) |
| Chat header | Draft name, **restart chat** |
| Overview | **Campaign setup** progress %; **Configured channels** (Email, WhatsApp, Web Push, App Push — SMS/PPC are parked); **Fields (in order):** Campaign name, Goal, Objective, Audience, Channels, Templates, Launch |
| Templates | Opening a card can navigate to template edit (nested create flow) |

### Not on the create hub (hidden / legacy elsewhere)

- **On-demand manual create** — not linked from the co-worker hub; lives under monitoring (`/campaigns?tab=on-demand`, `/campaigns/create/on-demand`).
- **Old B2C manual landing** — not wired to `/campaigns/create`.
- **SMS / PPC** — parked in channel UI; not offered on create overview chips.

### Product note (CRM scope)

If CRM Marketing should expose only **Create campaign + Drafts**, the hub still shows **Recommendations**, **Templates**, and **WhatsApp approvals** until embed-specific hiding is implemented.

---

## 2. Drafts

**URL:** `/campaigns/create?tool=drafts&embed=1`  
**Same panel** as the **Drafts** chip on the create hub.

| Area | Live UI |
|------|---------|
| Header | **Drafts (count)**, **Filter** (All / Live / Scheduled / Completed / In progress), **Back** (returns to hub) |
| List row | Name, status tag, snippet, time, **Pin**, **Delete** (delete blocked for live/scheduled) |
| Pagination | Previous / Next when needed |
| Open | Row → `/campaigns/create/{draftId}?embed=1` |

---

## 3. Dashboard

**URL:** `/dashboard?embed=1`  
**Component:** `DashboardWorkspace` — split **co-worker chat** (left) + **Overview** panel (right).

### 3a. Default — Overview (right panel)

| Area | Live UI |
|------|---------|
| Period | **Dashboard period menu** (Today, Last week, Last month, All, custom date range) |
| Summary line | Campaigns ran in period + KPI scope hint |
| Sample data | **Sample data** chip when overview uses synthetic data |
| Live sends | Green **Live sends** block when active batch sends exist |
| Needs attention | Config blocked links (when config UI is enabled and channels critical), paused channel alerts |
| KPI cards | **Campaigns ran**, **Delivered**, **Failures**, **Open rate**, **Click rate** |
| Hub on-demand | **Hub on-demand** card → opens in-dashboard **Campaign monitoring** on on-demand tab |
| By channel | **Delivered by channel** cards (delivered / opens where tracked) |
| Chart | **Delivery trend** area chart (delivered, email opens, clicks by day, IST) |
| Campaign preview | **Campaign monitoring** preview list (up to 5 rows, metrics, **View all →**) |

### 3b. Co-worker chat (left panel)

| Area | Live UI |
|------|---------|
| Title | **Your Worktual co-worker** |
| Chat | Analytics Q&A; optional **AnalyticsVisual** charts in replies; suggestion chips |
| Composer | **Ask about campaigns…** |
| Actions | **Restart chat**, stop generation while busy |
| Handoff | “Earlier in …” when arriving from another module |

### 3c. In-dashboard drill-downs (same iframe, no CRM tab required)

From Overview actions, the right panel switches view ( **Back** returns to Overview):

| Right panel title | Trigger | Live UI |
|-------------------|---------|---------|
| **Campaign monitoring** | Preview row, **View all →**, **Hub on-demand** card | Full `ReportsCampaignMonitoringPane` (tabs: live, scheduled, past, on-demand, personalised CRM when present) |
| **Events tracking** | Co-worker / agent navigation (no Events preview card on Overview today) | `EventsTrackingPane` |

Expand/minimize on the copilot split adjusts column width (desktop).

### Dashboard — not primary CRM embed scope

These are **live in the Dashboard module** but are secondary surfaces opened from Overview (not separate CRM tabs unless you add them):

- Full campaign monitoring list and detail panes
- On-demand monitor tab (reachable from **Hub on-demand** card)
- Events tracking in-pane

**Configuration** module is hidden from Campaign sidebar (`CONFIGURATION_UI_HIDDEN`); dashboard may still link to `/configuration/...` from “Needs attention” when critical config rows exist.

---

## Standalone app modules (not in typical CRM iframe)

If CRM only loads the three paths above, users do **not** see Campaign sidebar entries for **Audience**, **Events**, **Campaign monitoring** (standalone `/campaigns`), **Reports**, **Configuration**, etc. Those routes still exist if CRM navigates to them explicitly.

---

## Related docs

- [CRM_IFRAME_SETUP.md](CRM_IFRAME_SETUP.md) — embed protocol and ops
- [CRM_CAMPAIGN_INTEGRATION.md](CRM_CAMPAIGN_INTEGRATION.md) — integration overview
