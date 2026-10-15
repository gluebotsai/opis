# Create-campaign workflow

**Agent:** `agents/app/agents/create_campaign/agent.py`  
**Prompts:** `prompts.py` (`build_system_prompt`, `hub_system_prompt`)  
**Tools:** `CORE_TOOLS` (intake) / `HUB_TOOLS` (hub home)

## Hub vs intake

| Mode | Session | Tools | Job |
|------|---------|-------|-----|
| Hub | `hub_mode` or hub session id | `OPEN_HUB_DESTINATION`, … | Guide; open recommendations / templates / drafts / clone / create space |
| Intake | UUID draft session | 5 core tools | Strategist journey (below) |

## Preferred strategist journey

Acceptances (strategy, templates, launch) are **chat intent only** — e.g. looks good, proceed, yes, that works. No separate UI confirm.

1. **Idea** — take volunteered idea; else ask; if none, suggest from Context (segments / industry / recommendations).
2. **Names** — suggest 3; user picks, invents, or rejects → new 3. Save via `update_campaign_meta`.
3. **Strategy** — full proposal (who, when, segments, channels, location/age if filterable). On chat accept → `strategy_accepted=true` + `strategy_summary`.
4. **Audience + channels** — `select_audience` / `set_channels`. If WhatsApp → ask retry 0|1|2|3 → `whatsapp_retry`.
5. **Templates** — only after `strategy_accepted`. `build_campaign`; full regen if user dislikes entire card. Finalize via chat → `templates_finalized`.
6. **Pre-launch summary** — goal, objective, total audience, channel notes, chosen templates; warn if not viewed/finalized.
7. **Launch** — `launch_campaign(confirmed=true)` after chat accept of summary.

If the user dumps later-step details early, save with tools and continue the earliest open stage.

**Planned template delegation:** `build_campaign` will delegate generation and
regeneration to `template_generation_director`; create-campaign remains the
user-facing strategist and resumes after templates are returned. See
[`template-generation.md`](./template-generation.md). This does not move launch,
schedule, or template-edit ownership into the Director.

## Core tools

| Tool | Collect / map | Call when |
|------|---------------|-----------|
| `update_campaign_meta` | name, goal, objective; also strategy_summary, strategy_accepted, whatsapp_retry, templates_finalized | Idea/names; chat accept of strategy/templates/retry |
| `select_audience` | emails, phones, names, city, company, segments | Who receives it; report availability; disambiguate names |
| `set_channels` | email \| whatsapp \| web \| push | Channel choices from strategy or user |
| `build_campaign` | mode create\|regenerate, user_confirmed | After strategy accept; regenerate = full style+content change |
| `launch_campaign` | confirmed, schedule | After summary chat accept |

## Dynamic Context fields

- Campaign name/goal/objective
- `strategy_accepted`, `strategy_summary`, `whatsapp_retry`, `templates_finalized`
- `audience.matched_count`, sample
- `channels`, `template_count`
- `launch_questions_asked`, `launch_confirmed`
- `org_context` channels + filterable fields
- `audience_segmentation` live counts

## Reply rules

- Never show `change_summary` or legacy tool names in chat.
- Never claim launched unless Context / tool says `launch_confirmed`.
- Strategy and pre-launch summary may be longer than 1–3 sentences.
- Web push = browser notification, not email inbox.
