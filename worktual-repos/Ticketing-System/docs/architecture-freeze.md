# Architecture freeze — Hybrid LangGraph + Workflow Manager

**Status: FROZEN** — do not reopen ownership without an explicit architecture change.  
Workflow *policies* (thresholds, side-quest rules, entity scoring) remain configurable.

## Graph

```text
React → Express Gateway → LangGraph
  prepare
  → workflow_manager   # state-first continue / park / resume / last_entity
  → commands (shim)    # new mutations / nav only; gradually drain
  → cheap intent → policy → agent router
  → General | Ticket | Teams | Customer | Knowledge
  → domain tools → shared HTTP → Express APIs → PostgreSQL
```

## Frozen principles

1. **Express owns all mutations** — no SQL writes from LangGraph/agents.
2. **LangGraph owns orchestration** — conversation + workflow state, routing, tool selection, reply generation — not persistence.
3. **Workflow Manager is state-first** — `current_workflow`, `current_step`, `workflow_data`, `last_entity`, `parked_drafts`. Never restart create because the user said “add members”.
4. **LLM owns language** — NLU, ambiguity, phrasing. Not RBAC, validation, workflow state, or mutations.
5. **Express owns business rules** — RBAC, validation, audit, transactions.
6. **Domain tools hide HTTP** — agents call `create_ticket()` / `update_queue()`, never raw paths.
7. **One response contract** — `{ reply, ui_actions, data, agent }` (+ `request_id` / schema).
8. **Dashboard is independent** — React → Express → Postgres only.
9. **Chat ↔ form parity** — same Express APIs (except intentional security exclusions).
10. **Interrupted workflows resume** — park / continue; do not re-ask collected fields.

## Code map

| Piece | Path |
|-------|------|
| State contract | `ai-agents/app/workflow_state.py`, `app/state.py` |
| Workflow Manager | `ai-agents/app/agents/workflow_manager.py` |
| Graph | `ai-agents/app/graph.py` |
| Commands shim | `ai-agents/app/agents/commands.py` |
| Option 2 plan | `.cursor/plans/hybrid_langgraph_option_2_e4e69909.plan.md` |

## Migration (in progress)

- [x] Workflow fields + Workflow Manager node before intent
- [x] Teams create → `last_entity` → add members without restart
- [x] Escalate → semantic NLU + Workflow Manager continue / park / cancel + `refresh_tickets`
- [ ] Drain remaining mutate heuristics from commands into tools + Workflow Manager
- [ ] Full chat ↔ form parity + role/module E2E

### Commands shim audit (drain one path at a time)

| Area | File / symbol | Class | Target owner | Status |
|------|----------------|-------|--------------|--------|
| Graph entry | `commands.py` → `command_node` | Shim router | Keep until drained | Active |
| Resolve | `chat_commands.py` → `resolve_chat_command` | Mixed nav + mutate | WM + specialists | Active |
| Active workflow | `workflow_manager.py` → `resolve_active_workflow` | State-first continue | WM | Preferred |
| Create ticket | `start_create_ticket_flow`, `_continue_ticket_draft` | Guided mutate | WM + `create_ticket` tool | Partial |
| Escalate | `_build_escalate`, `continue_escalate_draft` | Guided mutate | WM + `escalate_ticket` | Partial |
| Reassign | `_build_reassign`, `continue_reassign_draft` | Guided mutate | WM + `update_ticket` | Partial |
| Teams | `catalog_commands.py`, `start_create_team_flow` | Guided mutate | WM + queue tools | Partial |
| Customers / catalog | `catalog_commands.py` | Guided mutate | WM + admin tools | Partial |
| Nav / filters | `ui_actions.py`, `_module_nav_fallback` | Deterministic UI | Keep in shim | OK |
| Side-quest filters | `commands.py` SIDE_QUEST + `_fallback` | Deterministic UI | Keep in shim | OK |

**Rule:** migrate one heuristic at a time — add regression test for old path, move to WM/tool, confirm test passes on new path. Do not bulk-delete the shim.

### Resume / restart investigation (before PostgresSaver)

Durable `conversation_context` (Postgres) is authoritative for park/resume across process restarts; `InMemorySaver` is a within-process optimization only.

**Step 0 (do before hunting hydrate bugs):** correlate user resume-failure timestamps with ai-agents process restart/deploy events.

```bash
# Example: align incident time (UTC) with container/pod restart
kubectl logs deploy/ai-agents --since=24h | rg -i 'started|shutdown|uvicorn'
# Or local: journalctl / platform deploy history for :8012
```

If restarts correlate → fix durable save path or swap PostgresSaver. If not → focus WM hydrate / commands shim / client draft overwrite.
