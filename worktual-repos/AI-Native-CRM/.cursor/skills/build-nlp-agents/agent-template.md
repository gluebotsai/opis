# agent.md template

Create one file per agent at `agents/<name>/agent.md`.

```markdown
# <agent_name>

## role
<!-- Who the agent is in the system -->

## goal
<!-- Single primary outcome this agent owns -->

## instructions
<!-- Stepwise behavior for normal turns -->

## context
<!-- Static domain context the agent must know -->

## skills
<!-- Skill pack IDs this agent may load -->
-

## guardrails
<!-- Hard behavioral limits; safety; what never to do -->

## input/output contract
### input
<!-- Expected user/runtime fields -->

### output
<!-- Response shape, citations, structured fields, SSE expectations -->

## allowed MCP servers
<!-- Exact MCP server names this agent may list/call -->
-

## handoff targets
<!-- Agents this agent may route_to; include when to hand off -->
-

## memory policy
### working
<!-- What slots to collect; when to clear -->

### short-term
<!-- Session window / summarization policy -->

### long-term
<!-- What to retrieve/store in Postgres; relevance rules -->

### preferences
<!-- Which prefs matter; soft vs hard -->

## approval policy
<!-- Actions that need human approval before tool execution -->

## evaluation criteria
<!-- How to judge a good turn: grounded, tool use, tone, completion -->
```

## Composition rules

- Keep each section short and operational.
- Put executable capability in MCP tools, not in essay prompts.
- Handoff targets must match registered specialist agent names.
- `allowed MCP servers` is an allowlist; runtime still discovers tool schemas via MCP client.
