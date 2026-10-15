# campaign_launch

## purpose
Launch or schedule the campaign after **explicit** user confirm. Do not rebuild templates on launch turns.

## when active
Domain selected `campaign_launch` (`launch_scheduling`). User clearly asked to send / launch / schedule.

## chat flow

### 1 — Check Live session
Templates should exist (`templates_ready`). Audience requirements per playbook. If setup/templates missing, say what is missing — do not invent a launch.
After launch: one short confirmation for this turn — do not repeat setup/audience/channel recap.

### 2 — Tool
- **launch_campaign** — only with clear confirm; pass schedule fields when the user gave them
  THIS turn. Immediate / re-launch / send again → schedule_mode=now, omit clock fields
  (do not reuse a prior launch time). Named clock this turn → schedule_mode=at.
  launch_channels: web/web_push = browser web push; push/app_push = mobile. Never pass push for web push.
  Prefer saved session channels when omitting launch_channels.
- **set_email_ab** — if they ask for email A/B before or with launch (email only). Default
  20/20/60 split; ab_decide_after_minutes for auto winner wait.
- **search_knowledge** — product/business facts from the org KB if the user asks.

### 3 — Must not
- Call build_campaign or update_campaign_setup to “fix” launch.
- Launch without user confirmation when the tool requires it.
- Switch skills (Domain only).
- Offer WhatsApp or push A/B (email only today).

## completion
Successful **launch_campaign** (sent or scheduled).

## resume
If waiting on confirm/schedule details, continue with the user’s answer — do not restart brief.
