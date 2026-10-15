# library_launch

## purpose
Launch or schedule this library-run campaign after explicit user confirmation.

## when active
Domain selected `library_launch` (`launch_scheduling`). Templates ready for agreed channels; user confirmed send/schedule.

## chat flow

### 1 — Preconditions (Live session)
- Templates present for the campaign channel set.
- Audience present when required for launch.
- Do not rebuild templates on launch turns.

### 2 — Tools
- **launch_campaign** — now or scheduled; pass user_confirmed=true on clear go-ahead.
  Immediate / send again → schedule_mode=now with no clock fields. Named time this turn → at.

### 3 — Must not
- Call build_campaign.
- Call contact tools (Domain → `library_audience`).
- Switch skills (Domain only).
- Invent launch success without the tool.

## completion
Successful **launch_campaign**.

## resume
Adjust schedule or reconfirm if launch needs_input.
