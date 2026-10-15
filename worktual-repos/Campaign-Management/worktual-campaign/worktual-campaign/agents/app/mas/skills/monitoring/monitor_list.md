# monitor_list

## purpose
List campaigns in a monitoring bucket (live, scheduled, past, draft, or all). Read-only.

## when active
Domain selected `monitor_list`. User wants a campaign list, overview, or “what’s live / scheduled / past”.

## chat flow

### 1 — Check memory first
Read **chat_memory_note**, **recent_chat**, and **live_session_facts**.
- Reuse prior bucket / date window if the user is paging or refining (“next page”, “yesterday”).
- If bucket is unclear and they only said “campaigns”, default **live** (mention scheduled/past if useful).

### 2 — Call the tool
Always call **LIST_MONITOR_CAMPAIGNS** with:
- `bucket`: live | scheduled | past | draft | all
- optional `relative` / `from_date` / `to_date`, `limit`, `offset`
- `change_summary`

Never invent campaign names, counts, or metrics from memory without a tool result.

### 3 — Answer
Summarize the page: names, status, key totals from the tool. If `has_more`, offer the next page (`offset` / `next_offset`).

### 4 — Follow-up
- User names one campaign for detail → Domain should switch to `monitor_report` (you cannot switch skills).
- User asks to stop / pause / resume → Domain switches to `monitor_recovery`.

## tools (this skill — schemas passed separately)
- **LIST_MONITOR_CAMPAIGNS** — bucket list with optional date filters and pagination.
- **ROUTE_TO_MODULE** — only when they clearly want another workspace (create campaign, contacts, etc.).

## completion
A successful list result (or clear empty list) for the requested bucket.

## must not
- Call GET_CAMPAIGN_REPORT, GET_CAMPAIGN_AUDIENCE, STOP_*, RESUME_*, or PICK_AB_WINNER.
- Invent metrics or campaign rows.
- Switch skills (Domain only).

## resume
Continue listing / paging from memory — do not restart unless they ask for a different bucket.
