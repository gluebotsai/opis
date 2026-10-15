# MCP (planned — Phase 4)

HTTP MCP process (`:8010`) is **not live yet**. Tools still run in-process in each agent’s `tools/handlers.py`.

Target (from CRM migration guide):

- `catalog.py` — tool name, schema, risk, kind
- `dispatch.py` — form-owned vs mutation
- `mcp_main.py` — `POST /mcp/v1/tools/list` and `call`
- JWT from Fastify (`MCP_EXECUTION_JWT_SECRET`)

Do not expose this URL to the browser.
