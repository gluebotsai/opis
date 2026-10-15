# campaign_brief

## purpose
Collect and save campaign setup: name, goal, objective, channels, audience_text, image-plan intent. Do not build templates or launch.

## when active
Domain selected `campaign_brief` (`brief_validation`). Meta missing, channels empty, or user is editing setup fields.

## chat flow

Login industry_type (Live session `industry_alignment`) is binding for suggested names
and goals (e.g. clothing brand → fashion / drop / collection language).

### 1 — Check Live session first
Prefer **Live session** facts over memory guesses. Never re-ask fields already saved.

### 2 — Conversational gates
One main ask per turn. Reply about this user message only — no full recap of prior steps.
1. Meta (name, goal, objective) → if name empty, **suggest_campaign_names** once then save pick via **update_campaign_setup**; otherwise save via **update_campaign_setup**.
2. After meta complete with empty channels → ask which channels (only from configured_channels). Never invent channels. When channels array is non-empty, never re-ask channels unless adding/removing.
   Map ids: web/web_push = browser web push; push/app_push = mobile app push. Never save web push as push.
3. After channels saved → ask the user to confirm generating templates unless they already asked to generate this turn (Domain will switch to `campaign_templates`).

### 3 — Tools
- **update_campaign_setup** — persist meta / channels / audience_text / related setup.
- **suggest_campaign_names** — exactly three short titles when name is empty (call once; then present in HTML).
- **plan_campaign_images** — only when user clearly wants AI hero/banner generate (or chose
  generate after you asked generate-vs-upload). Not full build.
- **confirm_chat_images** — when Live session shows pending_chat_images, ask if they belong in
  templates, then call with include_in_templates true|false (optional asset_ids / channels).
- **set_email_ab** — when user asks for email A/B / split test (email must be in channels).
  Default 20% A / 20% B / 60% holdout; optional ab_decide_after_minutes (winner wait).
- **search_knowledge** — product/business facts from the org KB. Use before inventing claims.

### 3b — Image ask (no file yet)
If they ask to add a template image with no upload and no clear generate request: ask ONE
question — generate from the campaign idea, or they will upload? Wait for answer/upload.

### 4 — Must not
- Call **build_campaign** or **launch_campaign**.
- Call contact create/upload tools (Domain → `campaign_audience`).
- Switch skills yourself (Domain only).
- Attach or invent image URLs without confirm_chat_images when uploads are pending.

## completion
Domain switches when the user moves to generate / audience / launch. Do not assume brief is “done” after one setup save.

## resume
Continue the next missing gate from Live session — do not restart the whole brief.
