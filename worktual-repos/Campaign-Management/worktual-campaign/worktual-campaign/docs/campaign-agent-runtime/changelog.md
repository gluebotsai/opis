# Changelog — campaign agent runtime

Update this file whenever tools, prompts, transport, or turn flow change.

## 2026-08-26 — Template Generation Director design guide

- Added the planned `template_generation_director` boundary, contracts, tool
  policy, semantic design grammar, validation gates, and rollout sequence.
- Added the planned `template_regulatory_advisor` and editable, versioned
  content-policy knowledge model.
- Documented shared generation entry points for create-campaign and on-demand.
- Deferred external web research and all time/launch rules from the first
  template-generation implementation.

## 2026-08-21 — Jun30 prompt + pure tool loop (no regex intent)

- Ported `CAMPAIGN_MANAGEMENT_STRATEGIST_PROMPT` from jun30 into
  `create_campaign/jun30_strategist_prompt.py` (tool names mapped to this runtime).
- Create-campaign `run_coordinator`: **tool_calls → run tools; else LLM content → user**.
  Removed remint, sanitize-as-intent, pick/guard reply rewrites, cue recoveries.
- `validate_campaign_details` always allows (LLM owns person-vs-title).
- Audience filter path always uses LLM specialist (no `try_identity_plan` regex short-circuit).

## 2026-08-21 — LLM-owned intent + shared clarify + process progress

- Shared prompt blocks (`app/shared_prompts.py`) auto-injected into every
  `sectioned_system_prompt` (clarify-before-act, tool rules, base guardrails).
- Progress: `app/progress_status.py` static/random labels from process sites.
- Auth stays JWT + tenantId (no domainId).

## 2026-08-20 — Template cards stay put + progress + launch finalize

- Pin template cards with `afterMessageId` so later “launch” turns do not move them.
- Preserve local chat when cards are pinned (avoid session_ready reordering).
- Fix `ui_event` emit to keep `type` so `template_progress` reaches the FE during build.
- Context/prompt: templates EXIST means not missing; launch intent auto-sets `templates_finalized`.

## 2026-08-20 — Audience: all contacts + LLM follow-ups

- “all contacts” / everyone → replace with empty filters (clears prior email/segment).
- Removed canned “Found N contact(s)…” as authoritative chat; create LLM replies + asks next step (channels).
- Tool returns matched/missing facts for multi email/phone; empty org → ask upload in Context/open-steps.
- Audience specialist prompt documents all / segment / named people.

## 2026-08-20 — Prompt-first create-campaign + intake guard fix

- Slimmed create-campaign `_INSTRUCTIONS` to ~30 lines (journey + tools; detail stays in Context open-steps).
- Softened person-vs-title Guardrails: clarify in chat; save clear idea picks via tools.
- `intake_guard`: removed broad “any person token blocks any title” rule; dropped `customer` person-cue; added loyalty/rewards/reminder topic words.
- Regression tests for Loyalty Rewards Reminder after an engagement ask.

## 2026-08-20 — Hub clear + optimistic create handoff

- On route to create draft (`create_space` / `open_draft`): clear hub chat, rotate `hub-*` session, ignore late hub socket events.
- Handoff carries full hub transcript via `writeChatHandoff`; create draft UI shows a light seed + last user ask while the create agent processes.

## 2026-08-20 — Overview UI: empty checklist at start

- Removed “New campaign” title and “Up next” panel from `CampaignGuidedPreview`.
- Fields list starts empty (label only); green tick + value only when actually filled.
- Placeholder draft name “New campaign” no longer counts as a filled campaign name.

## 2026-08-20 — Remove tool-nudge leak + ordered field ticks

- Removed create-campaign `after_no_tools` nudge that caused chat replies about
  “use appropriate tools / restore from context”.
- Sanitize similar meta replies before showing in chat.
- Campaign overview UI: ordered fields (name → goal → objective → audience → …)
  with green ticks as each is filled; progress bar; Up next highlights current field.

## 2026-08-20 — Strategist journey (chat accept)

- Create-campaign Instructions rewritten: idea → 3 names → full strategy → audience/channels
  (+ WhatsApp retry 0–3) → templates → pre-launch summary → launch.
- Strategy / template / launch acceptance is **chat intent only** (looks good / proceed / yes).
- `update_campaign_meta` persists `strategy_summary`, `strategy_accepted`, `whatsapp_retry`,
  `templates_finalized`; exposed in session Context.
- Dynamic open-steps Context gates templates until strategy_accepted.
- Workflow doc `workflow/create-campaign.md` updated.

## 2026-08-20 — P0/P1/P2 kickoff

- Added `docs/campaign-agent-runtime/` pack (README, topology, folder-map, prompt-contract, workflows, changelog).
- Added shared `agents/app/prompt_sections.py` (6-section builder) and `agents/app/memory.py` facade.
- Create-campaign prompts rewritten to Role/Goal/Instructions/Context/Output/Guardrails with **dynamic Context** (open-steps appendix from session).
- Create-campaign coordinator is `agent.py`; `graph.py` is a compatibility shim.
- Removed happy-path regex tool injection in create-campaign (channel/template affirm, resume-hint regex, meta infer / bare-affirmative short-circuit).
- All module prompts migrated to sectioned builders with dynamic Context; coordinators live in `agent.py` (graph shims retained).
- Template coach prompt converted to 6-section format.
- Added CI tests: `test_forbidden_framework_dependencies.py`, `test_prompt_sections.py`.
- Linked pack from `CAMPAIGN_MICROSERVICE.md`; MCP folder stub for Phase 4.
- Target topology documented: Fastify Socket.IO + HTTP agents + MCP (P3–P5 still planned).
