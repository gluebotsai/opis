# SQL developer agent (experiment)

DQL-only analytics agent: YAML semantic layer, vector-less catalog RAG, certified KPIs, then iterative table fetch. Query craft is adapted from [icartsh sql-expert](https://github.com/icartsh/icartsh_plugin/tree/9c678bd28e5bb3efa77c14f5ea45fe82bc27dd7d/icartsh-plugin/skills/sql-expert) with DDL/DML removed.

This folder is isolated from production NLP. Graduate later into `apps/nlp` skill packs + analytics MCP.

## Multi-agent

```
you → sql_supervisor (MiniMax, route_to_agent) → sql_developer (MiniMax + catalog tools) → answer
```

The supervisor does not keyword-match. It calls `route_to_agent` when the question needs catalog analytics. Greetings can be answered by the router. The CLI prints a live **AGENT STATUS** board while that happens.

## Layout

```
catalog/                        metrics, glossary, joins, gold examples, table cards
skill.yaml                      procedural skill (sql-developer)
agents/sql_supervisor/agent.md  L1 router prompt
agents/sql_developer/agent.md   L3 specialist prompt
scripts/ask.py                  interactive CLI tester
scripts/ui.py                   sample tester UI (logs + warehouse data)
src/sql_agent/                  catalog tools, planner, MiniMax, orchestrator, CLI, UI server
tests/                          spelling, joins, DQL, agent + orchestrator
```

## Try it

Sample UI (ask, live logs, plan SQL, warehouse preview):

```bash
cd experiments/sql-agent
./scripts/ui.py
```

Open `http://127.0.0.1:8765`. Period is a UI control (last 7 days or last month). The executor still owns tenant and timestamps.

CLI:

```bash
cd experiments/sql-agent
./scripts/ask.py
```

It hops to the NLP venv on its own. Type a question at `you>`, wait for the agent status and answer, then type the next one. Ctrl+C or `quit` to stop.

The MiniMax agents read `TOGETHER_*` / `CHAT_OPENAI_*` from the repo `.env` files (same gateway as NLP). They omit GLM `extra_body` so the gateway keeps `worktual-minimax`. `./scripts/ask.py` sets `SQL_AGENT_LIVE=1`. The executor owns tenant (`organization_id`) and the 7-day period: model timestamps are rewritten, fact tables are scoped, and the user-visible answer is grounded on warehouse preview.

## Paths

| Trust | When |
|---|---|
| `certified` | Catalog metric wins |
| `generated` | Gold NL→SQL example wins (metric miss / explore) |
| `review` | Retrieval pack only — LLM must write SQL from table cards |

The executor always wraps SQL as preview (`LIMIT 50`) plus `__total_matched_rows` for the full inner set.

## Tools (MCP-shaped)

`search_catalog`, `get_metric`, `get_table_details`, `get_join_path`, `plan_query`, `sql_analytics`

See `src/sql_agent/tools.py`. Watch the handoff with `python scripts/ask.py`. Specialist-only debug: `python -m sql_agent.agent ask "…"`.
