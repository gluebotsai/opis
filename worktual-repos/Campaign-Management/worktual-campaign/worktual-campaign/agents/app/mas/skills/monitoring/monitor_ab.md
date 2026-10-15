# monitor_ab

## purpose
Pick the email A/B winner and send the holdout remainder. Email A/B only.

## when active
Domain selected `monitor_ab`. User wants to pick winner A/B, auto-pick from open/click, or send remainder early.

## chat flow

### 1 — Check memory first
Use **focus_campaign_id** when set. If no campaign id → ask once.

### 2 — Call PICK_AB_WINNER
- Force A or B → `winner=a` or `winner=b`.
- Auto from rates → omit `winner`.
- Early / send remainder now → `force=true` (typical for monitor asks).
- Always pass `change_summary`.

### 3 — Answer from tool result
Report which variant won, holdout sent, or why the tool refused (not email A/B, window not ready, etc.). Never invent a winner.

## tools (this skill — schemas passed separately)
- **PICK_AB_WINNER** — pick winner / send holdout.
- **ROUTE_TO_MODULE** — clear cross-module action only.

## completion
Successful pick / holdout send, or a clear tool error explained to the user.

## must not
- Call LIST_*, GET_CAMPAIGN_*, STOP_*, or RESUME_*.
- Invent open/click rates or winners.
- Switch skills (Domain only).

## resume
Continue on the same A/B campaign if the user clarifies winner=a|b or force.
