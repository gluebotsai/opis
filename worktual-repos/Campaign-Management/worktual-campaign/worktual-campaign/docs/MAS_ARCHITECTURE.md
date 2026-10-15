# Campaign MAS Architecture — production enabled

Additive Super → Domain → Executor under `agents/app/mas/`.

## Production default

`MAS_ENABLED_DOMAINS=all` (config + agents `.env` + deploy examples).

Set `MAS_ENABLED_DOMAINS=` (empty) to force legacy-only rollback.

## Three entry types

| Type | When | Flow |
|------|------|------|
| **Chat MAS** | SPA modules with conversational chat | Super → Domain (LLM) → Executor |
| **Hub MAS** | Hub A2A skills and unknown intent fallback | Super → Domain → Executor |
| **Direct executor** | Cron / workers only | `CRON_BINDINGS` → executor (no Super/Domain LLM) |

Sticky SPA follow-ups skip Super: Domain → Executor only.

Template library inline edit and template coach are **not chat modules** — separate
product flows (planned; not part of chat MAS). See `runtime/bindings.py` for Hub and cron targets.

## Routing model (chat + hub)

| Entry | Flow |
|-------|------|
| SPA interactive (first turn) | Super → Domain (LLM) → Executor |
| SPA sticky follow-up | Domain → Executor (skip Super) |
| Hub A2A (known or unknown intent) | Super → Domain → Executor |
| Cron / worker events | Direct executor via `CRON_BINDINGS` (no Super/Domain LLM) |

Hub bindings (`HUB_BINDINGS`) set `preferred_domain` / `preferred_executor` hints; Super still orchestrates.

## Create-campaign native path

Create-campaign executors always use bounded native loops (same handlers as legacy).
`MAS_CREATE_CAMPAIGN_NATIVE` is retained in config for documentation; native loops are always on.

## Audience native path

Contacts/Audience is **always** full MAS (`Super → Domain → Executor`) regardless of
`MAS_ENABLED_DOMAINS`. Executors always use bounded native CRM loops (no legacy
coordinator fallback). Hub `create_contact` routes through Super (same chain as SPA).

`MAS_AUDIENCE_NATIVE` is retained in config for documentation; native loops are always on.

Shared runtime context (`mas/runtime/context.py`) is injected into Super, Domain,
and Executor prompts (draft panel, sticky domain, recent steps).

## Optimization native path

Optimization executors (monitoring, analytics, recovery) always use bounded native loops.
`MAS_OPTIMIZATION_NATIVE` is retained in config for documentation; native loops are always on.

## Content native path

Content executors always use bounded native loops: channel template generation via
`channel_content`, WhatsApp approved/rejected via extracted executor turns, plus
template_coach. Domain LLM picker: `llm_pick_content_executor`.
Image work routes to the **Image domain** (not Content).

## Image native path

Image domain executors (`image_generate`, `image_refine`, `image_attach`) always use
bounded native loops via `run_image_executor_turn`. **ENHANCE_IMAGE_PROMPT** (visual
director + negatives + safety) must run before **GENERATE_IMAGE** / **REFINE_IMAGE**.
Raw user chat never reaches the Gemini image API. Domain LLM picker:
`llm_pick_image_executor`. Creation domain may `request_domain_handoff` → image when
the user needs campaign art during template/campaign work.

`MAS_IMAGE_NATIVE` defaults to true. Missing `GEMINI_API_KEY` fails generation unless `GEMINI_IMAGE_ALLOW_DEV_STUB=true`. Phase 2 compose has no stock/static hero fallback — only Gemini rebuild URLs or empty assets with attach warnings.

## Forms native path

Forms executors (form_theme, form_fields, form_design) always use bounded native loops via
`run_forms_executor_turn` with per-executor tool subsets. Domain LLM picker:
`llm_pick_forms_executor`. Specialist single-shot path remains when native is disabled in tests.

## Product coverage (chat MAS)

| Domain | Modules / entry | Status |
|--------|-----------------|--------|
| audience | contacts, Hub create_contact | MAS on + Super for SPA and Hub |
| creation | create_campaign, recommendations, Hub on_demand | MAS on + Super for SPA and Hub |
| content | WA approved/rejected (chat modules) | MAS on + native loops |
| image | via Super / Creation handoff | MAS on + enhance→generate gate |
| optimization | monitoring, reports, events_report | MAS on + native loops |
| forms | forms | MAS on + native loops |
| Super home | module=`mas` | LLM route |

## Hub skills (Hub MAS)

| Hub skill | Domain | Executor |
|-----------|--------|----------|
| create_contact / contacts_create | audience | contact |
| on_demand_send / on_demand | creation | launch_scheduling |
| campaign_report / monitoring_report | optimization | monitoring |
| stop_channel / resume_channel / stop_campaign | optimization | recovery |

On-demand send is **Hub-only** (not an SPA chat module).

## Cron (direct executor)

Workers call `mas_invoke` with `entry=cron` and `cron_event` — no Super/Domain LLM.
Bindings in `agents/app/mas/runtime/bindings.py` (`CRON_BINDINGS`), e.g.:

- `template_compliance_scan` → content_verification
- `email_ab_auto_winner` → recovery
- `send_time_optimizer` → launch_scheduling

## Restart

After changing the flag, restart the agents process (`get_settings` is cached).

## SPA / Hub smoke checklist

- [ ] Contacts create/update/search + Hub create_contact
- [ ] Create campaign brief + optional Content hop for templates
- [ ] Recommendations
- [ ] Monitoring list/report/pause
- [ ] Reports / events
- [ ] Forms theme/fields/design
- [ ] WhatsApp approved / rejected
- [ ] Optional: `module=mas` Super routing
- [ ] Hub on_demand_send → launch_scheduling

## Final gate (WP5)

Run the full offline gate before release:

```bash
cd agents
PYTHONPATH=. .venv/bin/python3.14 scripts/qa_all_mas.py
PYTHONPATH=. .venv/bin/python3.14 scripts/verify_routing_handoff.py --mas-only
PYTHONPATH=. .venv/bin/python3.14 scripts/verify_routing_handoff.py   # MAS + legacy routing
```

Env flags (all default `true`; set `false` per domain for rollback):

| Variable | Purpose |
|----------|---------|
| `MAS_ENABLED_DOMAINS` | `all` or comma domain ids; empty = legacy-only |
| `MAS_CREATE_CAMPAIGN_NATIVE` | Bounded creation executors |
| `MAS_AUDIENCE_NATIVE` | Bounded CRM executors |
| `MAS_OPTIMIZATION_NATIVE` | monitoring / analytics / recovery |
| `MAS_CONTENT_NATIVE` | channels / WA / coach |
| `MAS_FORMS_NATIVE` | theme / fields / design |

## Tests

```bash
cd agents && PYTHONPATH=. pytest tests/test_mas_*.py tests/test_hub_super_agent.py -q
PYTHONPATH=. python scripts/qa_all_mas.py
PYTHONPATH=. python scripts/qa_audience_mas.py --mock   # offline wiring + panel tools
PYTHONPATH=. python scripts/qa_create_campaign_mas.py
PYTHONPATH=. python scripts/qa_optimization_mas.py       # optimization Super chain
PYTHONPATH=. python scripts/qa_content_mas.py             # content Super chain
PYTHONPATH=. python scripts/qa_forms_mas.py               # forms Super chain
PYTHONPATH=. python scripts/qa_audience_mas.py          # includes live LLM turn when reachable
```

## Deferred

- MCP HTTP tool gateway (`agents/app/mcp/` — in-process tools today)
- Template library / template coach as a unified non-chat executor entry (separate plan)

Skills: domain `module_skills` + `app/mas/skills/` harness (contacts, create, library_run, monitoring, reports) — active at runtime.
