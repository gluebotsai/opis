# monitor_report

## purpose
Load one campaign’s performance report and/or audience sent/missed details. Read-only.

## when active
Domain selected `monitor_report`. User wants status, opens/clicks, PPC, who received, or who missed for a campaign.

## chat flow

### 1 — Check memory first
Read **focus_campaign_id**, chat memory, and recent turns.
- Prefer `focus_campaign_id` when set.
- If no campaign id/name is known → ask once for which campaign. Do not invent an id.

### 2 — Pick the right tool

| User intent | Tool |
|-------------|------|
| Performance, channels, opens/clicks, PPC, A/B status | **GET_CAMPAIGN_REPORT** |
| Who was selected / sent / stub / missed | **GET_CAMPAIGN_AUDIENCE** |

You may call report first, then audience if they ask who received.

### 3 — Answer from tool results only
- Speak rates with `%` as returned (do not rescale).
- Stub ≠ inbox delivery — say so when stub > 0.
- Email A/B: report A vs B; do not pick a winner here (Domain → `monitor_ab`).

### 4 — Follow-up
Refine channel filter on audience; or answer follow-up questions from the same report if data is already in the last tool result.

## tools (this skill — schemas passed separately)
- **GET_CAMPAIGN_REPORT** — one campaign totals + channels.
- **GET_CAMPAIGN_AUDIENCE** — selected / sent / stub / missed contacts.
- **ROUTE_TO_MODULE** — clear cross-module action only.

## completion
Report and/or audience returned, or user told campaign not found.

## must not
- Call LIST_MONITOR_CAMPAIGNS, STOP_*, RESUME_*, or PICK_AB_WINNER.
- Invent metrics or contact names.
- Switch skills (Domain only).

## resume
Continue on the same campaign from memory unless they name a different one.
