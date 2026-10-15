# Ticketing MCP server (FastMCP)
#
# Wraps Express domain APIs for:
#   1. External MCP clients (Cursor / Claude Desktop / partners)
#   2. Internal ai-agents (TOOLS_TRANSPORT=mcp → POST /invoke)
#
# Built with [FastMCP](https://gofastmcp.com). Express remains RBAC + mutation
# authority. This process never writes SQL.

## Run locally

```bash
cd mcp-server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export EXPRESS_BASE_URL=http://127.0.0.1:3000
export COWORKER_TASKS_SECRET=worktual-tasks-dev-secret
python server.py
```

Default: FastMCP HTTP transport on `http://127.0.0.1:8020` (localhost only).

- Health: `GET /health`
- Agent invoke: `POST /invoke` with `{"name":"list_tickets","arguments":{...}}`
- MCP endpoint: `http://127.0.0.1:8020/mcp`

### Env

| Variable | Default | Notes |
|----------|---------|--------|
| `MCP_HOST` | `127.0.0.1` | Public binds (`0.0.0.0`) refused unless `MCP_ALLOW_PUBLIC_BIND=1` |
| `MCP_PORT` | `8020` | Bind port |
| `MCP_TRANSPORT` | `http` | Legacy `streamable-http` maps to `http` |
| `EXPRESS_BASE_URL` | `http://127.0.0.1:3000` | Express API |
| `COWORKER_TASKS_SECRET` | dev secret | Must match Express; required on internal actor calls |
| `MCP_RATE_LIMIT_MAX` | `120` | Max tool calls per window (`0` disables) |
| `MCP_RATE_LIMIT_WINDOW_SEC` | `60` | Sliding window seconds |

## Auth (hardened)

**Internal agents** — all of:

- `X-Coworker-Tasks-Key` (must match `COWORKER_TASKS_SECRET`; not optional)
- `X-Coworker-Actor-Id`
- `X-Coworker-Org-Id`
- optional role/name

Bare actor id/org **without** the tasks key is rejected (prevents open impersonation if MCP is reachable).

**External** — org API key (`Authorization: Bearer wt_live_…` or `X-Api-Key`).
MCP resolves an Active **agent** (not admin) via Express `GET /api/mcp/session`.

## Hardening

- Tool calls are audit-logged (`ticketing.mcp.audit`) with tool, actor, org, key id — no secrets.
- Per-caller rate limit on MCP tools and `/invoke`.
- Bind defaults to loopback; public bind requires explicit opt-in.

## Cursor / Claude Desktop (example)

```json
{
  "mcpServers": {
    "worktual-ticketing": {
      "url": "http://127.0.0.1:8020/mcp",
      "headers": {
        "Authorization": "Bearer wt_live_YOUR_ORG_KEY"
      }
    }
  }
}
```

Tool catalog: [`../shared/ticketing_tool_catalog.json`](../shared/ticketing_tool_catalog.json).
