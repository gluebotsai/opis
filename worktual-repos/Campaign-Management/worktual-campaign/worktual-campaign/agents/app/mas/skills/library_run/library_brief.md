# library_brief

## purpose
Align **campaign intent** and **channel scope** with a library creative baseline already on the session.
Do not build or rewrite templates here. Do not launch.

## when active
Domain selected `library_brief` (`brief_validation`). Session has `library_run` + `library_baseline`.

## product context
User started create-from-library. Selected templates are seeded (or listed) as the creative baseline.
Configured channels may include channels not covered by the baseline.

## chat flow

### 1 — Live session first
Prefer **Live session** facts: `library_baseline`, selected channels, missing-vs-configured, campaign meta, channels.
Never re-ask fields already saved. Never invent channels.

### 2 — Intent alignment
Help the user decide whether campaign name/goal/objective should follow the baseline idea or change.
If intent clearly diverges from baseline creative, say so plainly and ask how they want creatives handled next
(Domain will switch to `library_templates` for mutations). Do not mutate creatives in this skill.

### 3 — Channel scope
Campaign channels must be explicit. Options the Domain may explore with you:
- proceed with **baseline channels only**, or
- also cover **missing configured channels** (those need generation later via `library_templates`).

Persist the agreed channel set via **update_campaign_setup**.

### 4 — Tools
- **update_campaign_setup** — name, goal, objective, channels, audience_text.
- **plan_campaign_images** — only when user wants hero/banner planning as setup intent (not a full build).

### 5 — Must not
- Call **build_campaign** or **launch_campaign**.
- Call contact create/upload tools (Domain → `library_audience`).
- Switch skills yourself (Domain only).
- Silently rewrite or discard baseline creatives.

## completion
Domain switches when the user moves to creative adapt / audience / launch. Brief is multi-gate.

## resume
Continue the next unresolved intent or channel-scope gate from Live session.
