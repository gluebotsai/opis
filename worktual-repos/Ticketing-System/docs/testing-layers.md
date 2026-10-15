# Testing Layers — Worktual Ticketing (LangGraph + Express)

Priority: **#1 Workflow Manager** and **#2 auth boundary** first. **#4 regression** runs forever. Remaining layers grow per module as it ships.

## How to run

```bash
cd ai-agents

# Priority + always-on (default CI)
.venv/bin/python -m pytest \
  tests/test_layer1_workflow_manager.py \
  tests/test_layer2_auth_boundary.py \
  tests/test_layer4_regression_transcripts.py \
  tests/test_layer5_contracts.py \
  tests/test_layer6_security.py \
  -q

# Full layered suite (no live DB)
.venv/bin/python -m pytest \
  tests/test_layer1_workflow_manager.py \
  tests/test_layer2_auth_boundary.py \
  tests/test_layer3_e2e_chat.py \
  tests/test_layer4_regression_transcripts.py \
  tests/test_layer5_contracts.py \
  tests/test_layer6_security.py \
  tests/test_layer7_load_budgets.py \
  tests/test_layer8_chaos.py \
  -q

# By marker
.venv/bin/python -m pytest -m "auth_boundary or regression" -q

# Live Express + Postgres (when available)
RUN_INTEGRATION=1 .venv/bin/python -m pytest -m integration -q

# Write-path integration (PRs touching tools/schemas/prompts)
npm run test:integration
```

## Phase 3 — resume failures vs restarts (step 0)

Before debugging hydrate/merge logic for “parked draft lost” or “workflow restarted”:

1. Collect incident timestamps (user report + `request_id` from chat response).
2. Check ai-agents deploy/restart/autoscale logs for the same window.
3. If correlated → durable context save gap or mid-turn crash (not WM logic alone).
4. If not correlated → WM hydrate, commands shim, or client `ticket_draft` overwrite.

Automated proof that restart + durable context works (no live DB): `tests/test_draft_memory.py` (`test_process_cache_restart_hydrates_*`).

**PostgresSaver** is deferred separately; durable `conversation_context` already covers most cross-restart resume when saves succeed.

## Integration CI policy

| Trigger | Required test |
|---------|----------------|
| Every PR (default) | Layer 1–2, 4–6 unit tests (`npm run test:layers`) |
| PR touches `tools/registry.py`, `workflow_schemas.py`, specialist prompts, or ticket/queue write tools | Also run `RUN_INTEGRATION=1` against staging Express + Postgres |
| PR touches `rbac.py` or `ui-frontend/src/rbac.ts` | `tests/test_rbac_live_scope.py` (includes FE/BE diff) |

Gate: `RUN_INTEGRATION=1`. No `.github` workflow yet — run manually or wire in CI when staging is available.

## No static chat / no fake business data

| Rule | Enforcement |
|------|-------------|
| User bubbles from LLM only | `test_rbac_live_scope.py::test_no_hardcoded_user_chat_bubbles_in_agent_app` |
| Counts/lists from tools/DB | Layer 1 WM tests; product rules in `.cursor/rules/` |
| `fallback` / seeds → phrase LLM hints only | `CoworkerChatPanel` paints `assistantText`; empty reply → `llmOnlyReply`, not seed text |

## Layer map

| # | Layer | What it proves | Location |
|---|--------|----------------|----------|
| 1 | Unit — Workflow Manager | Decision tree: continue / park / resume / interrupt / last_entity / cancel (no LLM) | `tests/test_layer1_workflow_manager.py` |
| 2 | Auth boundary | Graph may route to mutate tool; Express `FORBIDDEN` still wins — no fake success | `tests/test_layer2_auth_boundary.py` |
| 3 | E2E chat | Happy path, cancel, side-quest→resume, entity coreference (`add members` via `last_entity`) | `tests/test_layer3_e2e_chat.py` |
| 4 | Regression | Fixed labeled transcripts in `fixtures/regression_transcripts.json` | `tests/test_layer4_regression_transcripts.py` |
| 5 | Contracts | `tool_ok`/`tool_err`, Response Formatter envelope, tool registry allowlists | `tests/test_layer5_contracts.py` |
| 6 | Security | Role × mutation matrix; prompt-injection; AST: agents have no `app.db` writes | `tests/test_layer6_security.py` |
| 7 | Load | WM latency budget; lean greeting budget; concurrent org isolation | `tests/test_layer7_load_budgets.py` |
| 8 | Chaos | `TIMEOUT` / `RETRYABLE` mid-workflow → draft kept, no `done` invent | `tests/test_layer8_chaos.py` |
| 9 | Migration | v1 parked draft still hydrates under current workflow contract | `test_layer3_e2e_chat.py` (`@pytest.mark.migration`) |

## Integration (live) — enable when CI has services

- Tool → Express → Postgres round-trip
- Park / kill process / reload / resume from DB (not only checkpointer)
- Auth boundary against real Express RBAC

Gate: `RUN_INTEGRATION=1`.

## Honest status (do not claim “everything fine” without live DB)

| Claim | Reality |
|-------|---------|
| Unit tests with mocked `list_queues` | Prove **routing / matching logic** only |
| Fixture names like `nlp` in tests | Test data only — **not** product seed / hardcoded teams |
| Production “which team?” | Must list **`availableTeams` from Express → Postgres** for that org |
| Unknown typed name | Say not found + offer **live** team names only — never invent samples |
| Live Tool→Express→Postgres | Still requires `RUN_INTEGRATION=1` |

**Product rule:** never invent team names in chat. Only Context.availableTeams / Context.teamName from DB.

