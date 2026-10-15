# dashboard-live-ops

Live send pipeline and recent failures — read-only ops reporting.

## When to use
User asks what is sending **now**, queue/batch status, pending vs sent, or **why** a send failed (web push, email, etc.).

## Tools (call before answering)
1. **GET_OPS_FEED** — preferred for “what’s live / failing / trending now” (active_sends + recent_failures + activity_series).
2. **GET_CAMPAIGN_LIVE_STATUS** — when a campaign id is known or after LIST_MONITOR_CAMPAIGNS.
3. **GET_RECENT_SEND_FAILURES** — when they ask why messages failed; pass campaign_id/channel when known.
4. **LIST_MONITOR_CAMPAIGNS** — when you need the campaign id first (bucket=live or all).

## Rules
- Quote **as_of**, **queued_batches**, **sending_batches**, and per-channel pending/sent/failed from tool JSON only.
- Do not use **query_analytics** / portfolio for in-flight pipeline questions.
- Do not invent skip_fail_reason text — use **GET_RECENT_SEND_FAILURES** rows.
- If live status is empty but campaign is scheduled, say batches may not be due yet (scheduled_for).

## Completion
Successful live status or failures tool with ok=true.
