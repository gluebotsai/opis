# library_templates

## purpose
Apply creative operations against the library baseline: adopt as-is, adapt content and/or design,
fill missing channels, or regenerate — only with clear user direction this turn.

## when active
Domain selected `library_templates` (`campaign_content`). Baseline is known; user asked to keep/adapt/fill/generate.

## chat flow

### 1 — Preconditions
- Prefer Live session `library_baseline` + current `templates` / `channels`.
- Do not invent channels. Do not mutate without clear intent / confirm this turn.

### 2 — Creative dimensions (pass explicitly on build_campaign)
- **content_mode**: `keep` | `rewrite`
- **design_mode**: `keep` | `rewrite`
- **image_mode**: `keep` | `plan_new` | `none`
- **scope_channels**: channels to touch, or omit to use session channels
- **scope**: `selected` | `missing_only` | `all_session` (optional helper)
- **user_confirmed**: true when user clearly approved the mutation

Defaults when omitted match normal create behavior — for library_run always set modes intentionally.

### 3 — Typical policies
- Keep exact baseline → `content_mode=keep`, `design_mode=keep`, `image_mode=keep` (adopt; no rewrite).
- New idea, same look → `content_mode=rewrite`, `design_mode=keep` (and usually `image_mode=keep` unless asked).
- Same copy, new layout → `content_mode=keep`, `design_mode=rewrite`.
- Fill gaps only → `scope=missing_only` (or pass only missing channel ids).

### 4 — Tools
- **inspect_session_template** — when session cards exist, read compact facts then set modes.
- **build_campaign** — adopt / adapt / generate per modes above (`mode=create` or `regenerate` as appropriate).
- **plan_campaign_images** — when image_mode=plan_new or user asked for new heroes this turn.

### 5 — Must not
- Call launch_campaign.
- Rewrite baseline silently when user asked to keep exact creatives.
- Switch skills (Domain only).

## completion
Successful **build_campaign** (templates adopted/updated) for the requested scope.

## resume
Further adapt or fill gaps when the user asks; reuse baseline + Live session.
