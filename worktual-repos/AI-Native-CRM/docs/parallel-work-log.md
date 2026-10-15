# Parallel work log (B2B ↔ B2C split)

While B2B (this copy) and B2C (teammate's copy) are developed in parallel on
separate local databases, **log every entry below the moment it happens** —
not retroactively at merge time. This file is the merge input, not a nice-to-have.

New to this split? Start with [`docs/b2c-handoff.md`](b2c-handoff.md) for
local setup steps before reading further.

## Split baseline (day zero)

| Item | Value |
|---|---|
| Base commit | `3d4e5b4dee2fb6d4d34afe7fd79a57bc57c15f2f` (2026-08-15) |
| Last migration at split | `20260814220000_agent_step_events` |
| `ai-service` test baseline | **450 passed**, 0 failed (`pytest`, Python 3.9 venv, `fastmcp` excluded — optional) |
| DB at split | Teammate's local Postgres seeded from a dump of `worktual_bigint` (`crm` + `cdp` + `accounts` schemas) taken on this date |

Re-run the `ai-service` test suite after every merge and compare against 450
passed as the pass/fail floor — a merge that drops below this without an
explained, intentional reason means something broke.

## How to use this file

Add a row **the same day** you do one of these things. Don't wait for merge day.

- New Prisma migration (either of you)
- Edit to any file on the [high-touch list](#high-touch-files-coordinate-before-editing)
- New shared contract touched (event in `crm-platform-events.ts`, new MCP tool in `ai-service/app/mcp/catalog.py`, new module id in `modules.ts`)

## Migrations log

| Date | Who | Migration folder | Tables/schema touched | Applied to shared DB? |
|---|---|---|---|---|
| 2026-08-15 | — | `20260814220000_agent_step_events` (baseline) | `crm.agent_step_events` | Yes (already live) |
| 2026-08-17 | local | `20260817140000_product_stock_on_hand` | `products.stock_on_hand` | Applied via `prisma db execute` (IF NOT EXISTS) |
| 2026-08-17 | local | `20260817150000_product_url` | `products.product_url` | Applied via `prisma db execute` (IF NOT EXISTS) |
| 2026-08-17 | local | `20260817160000_products_to_inventory_schema` | Move `products` → `inventory.products`; `crm.products` view | Applied via `prisma db execute` |
| 2026-08-17 | local | `20260817170000_drop_crm_products_view` | Drop `crm.products` view; Prisma multi-schema | Applied via `prisma db execute` |
| 2026-08-18 | local | `20260818150000_contact_profile_created_by` | `crm.contact_profiles.created_by_user_id` | Applied via `prisma db execute` (IF NOT EXISTS) |
| 2026-10-01 | local | `20261001105000_voice_conversations` | `crm.voice_conversations` | Applied via `prisma db execute` (IF NOT EXISTS) |
| 2026-10-01 | local | `20261001170000_call_transcripts` | `crm.call_transcript_sessions`, `crm.call_transcript_chunks` | Applied via `prisma db execute` (IF NOT EXISTS) |

## Shared / high-touch file edits log

| Date | Who | File | What changed | Why |
|---|---|---|---|---|
| 2026-08-19 | local | `crm_agent.py`, `coworker_shared.py`, `crm_tools.py` | LLM classify create-walk intent before slot-fill | Mid-create “see activity” was stuffed into deal title |

## `schema.prisma` model changes log

Track this separately from the migrations log — one migration can touch
several models, and you need to know *which model* to spot the merge conflict
before you even open the file.

| Date | Who | Model(s) | Field(s) added/changed | Notes |
|---|---|---|---|---|
| 2026-08-17 | local | `Product` | `stockOnHand Int?` (`stock_on_hand`) | Optional warehouse units; null = not tracked |
| 2026-08-17 | local | `Product` | `@@schema("inventory")`; drop crm view | Access inventory.products only |
| 2026-08-18 | local | `ContactProfile` | `createdByUserId BigInt?` (`created_by_user_id`) | Sales-rep list: owner OR creator |
| 2026-10-01 | local | `VoiceConversation` | new `crm.voice_conversations` | One row per inbound or outbound SIP call; no live writes yet |
| 2026-10-01 | local | `CallTranscriptSession`, `CallTranscriptChunk` | new `crm.call_transcript_sessions`, `crm.call_transcript_chunks` | Live phone transcript for the connected browser SIP call |

## High-touch files (coordinate before editing)

Ping the other person before editing these — both of you are likely to touch
them, and conflicts here can be silent (no git conflict marker, but broken
invariant):

- `prisma/schema.prisma`
- `backend/src/config/modules.ts`
- `frontend/src/config/modules.ts`
- `backend/src/lib/contact-company-motion.ts`
- `ai-service/app/agents/crm_agent.py`
- `ai-service/app/agents/crm_tools.py`
- `ai-service/app/agents/coworker_shared.py`
- `ai-service/app/agents/llm_result.py`

See [`docs/merge-validation-checklist.md`](merge-validation-checklist.md) for
the step-by-step process to combine schema/migrations safely at merge time.
