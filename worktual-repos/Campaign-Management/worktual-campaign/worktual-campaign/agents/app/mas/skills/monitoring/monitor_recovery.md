# monitor_recovery

## purpose
Stop an entire campaign, or pause/resume one channel. Mutating — never invent reasons or success.

## when active
Domain selected `monitor_recovery`. User wants to stop/cancel/halt a campaign, or stop/resume one channel.

## chat flow

### 1 — Check memory first
Use **focus_campaign_id** and prior channel/reason from chat when present.

### 2 — Whole campaign stop → STOP_CAMPAIGN
1. First call **without** `reason` to inspect status (live / scheduled / already finished).
2. Follow the tool result:
   - **already_finished** / past / completed / cancelled → tell the user; do **not** ask for a reason; do **not** stop again.
   - **live** / **scheduled** + **needs_reason** → explain sent vs selected, **ask for a reason**, then call again **with** that reason.
3. Never invent a reason. Never stop without the user’s reason on live/scheduled.

### 3 — One channel → STOP_CHANNEL / RESUME_CHANNEL
- Pause one channel: need `campaign_id`, `channel`, and a clear **reason** → **STOP_CHANNEL**.
- Resume: `campaign_id` + `channel` → **RESUME_CHANNEL** (not for past/expired).

### 4 — Scope
If they only asked for metrics, Domain should have used `monitor_report` — do not invent numbers here.

## tools (this skill — schemas passed separately)
- **STOP_CAMPAIGN** — whole campaign (inspect then confirm with reason).
- **STOP_CHANNEL** — pause one channel with reason.
- **RESUME_CHANNEL** — resume a paused channel.
- **ROUTE_TO_MODULE** — clear cross-module action only.

## completion
Campaign stopped (or already finished explained), or channel paused/resumed successfully.  
Not complete while waiting for a stop reason (`needs_reason`).

## must not
- Call LIST_*, GET_CAMPAIGN_*, or PICK_AB_WINNER.
- Invent a stop reason or claim success without tool `ok`.
- Switch skills (Domain only).

## resume
If paused waiting for a reason, continue with the user’s reason on the same campaign.
