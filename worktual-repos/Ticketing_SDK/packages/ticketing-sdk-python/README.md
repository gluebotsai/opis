# worktual-ticketing

Headless Python client for a partner server. It calls the same Express routes as `@worktual/ticketing`. Widgets stay in `@worktual/ticketing-ui`.

The org API key (`wt_live_…`) stays on the server. Browser code receives only the session token from `auth.create_session`.

```python
from worktual_ticketing import create_ticketing_client

client = create_ticketing_client(
    base_url="https://rebuild-ticketing-api.worktual.com",
    partner_api_key="wt_live_…",
    locale="es",
)

session = client.auth.create_session(actor={"email": "jane@partner.com"}, locale="es")

turn = client.ai.turn(
    session_token=session.session_token,
    message="Clasifica el ticket",
    focused_ticket_id="#128",
    locale="es",
)
if turn.status == "confirmation_required":
    client.ai.confirm(
        session_token=session.session_token,
        confirm_tool={"name": turn.tool_proposals[0].name, "args": turn.tool_proposals[0].args},
    )

card = client.ai.tasks.summarize(session_token=session.session_token, ticket_number="#128")
created = client.ai.stream(session_token=session.session_token, message="VPN is down", sdk_task="ticket.create")
load = client.ai.tasks.workload(session_token=session.session_token)
staff = client.auth.login(email="jane@partner.com", password="secret")
inbox = client.inbox.list(session_token=staff.session_token)
metrics = client.ai.tasks.ask_metrics(session_token=session.session_token, message="How many open tickets?")
listed = client.ai.proposals.list(session_token=session.session_token, ticket_number="#128")
usage = client.usage.summary(from_="2026-10-01T00:00:00.000Z")
```

`ai.stream` reads the same SSE stream as the TypeScript client. `on_progress` receives each progress event. `sdk_task="ticket.create"` is billed as `ai.tasks.createTicket`. `auth.login` and `auth.portal` do not send the org API key.

`from_` is the `from` query parameter. `summary.by_skill` is the billing breakdown by Skill. `summary.quota` is the active cap. `usage.events` returns `partner_id`, `agent_turns`, and `confirm_required`. `debug=True` on `ai.turn` adds `trace`. `ask_metrics`, `ask_why`, and `list_tickets` take a question and do not accept SQL. Counts and rows are copied from the tool payload. When Context Layer or the knowledge graph URL is unset, `status` is `temporarily_unavailable` and `reply` is the unavailable sentence.

`TicketingAuthError` means the call never left the process. `TicketingApiError` carries `status`, `body`, and `code`. A refused turn sets `result.code` and replaces `reply` with the sentence for the turn locale.
