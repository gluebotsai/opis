# External tool calls

Use `docs/external_tools.py`. Every call is external: an org API key plus business fields. Do not send a session, organization id, or actor id.

```python
from docs.external_tools import ExternalTools

tools = ExternalTools(api_key="wt_live_…")  # or set EXTERNAL_API_KEY
result = tools.create_ticket(
    customer_name="<name from verify_ticket_customer>",
    customer_id="<id from verify_ticket_customer>",
    description="<issue the user typed>",
)
```

HTTP shape for every function:

```http
POST http://127.0.0.1:8020/invoke
Authorization: Bearer wt_live_…
Content-Type: application/json

{"name":"<tool>","arguments":{}}
```

`MCP_BASE_URL` overrides the host. Default is `http://127.0.0.1:8020`.

## Where the API key comes from

An admin creates an organization key once. The raw value starts with `wt_live_` and is shown only at creation. The database stores `sha256` of that value in `ticketing.org_api_keys.key_hash`. The caller keeps the raw key and sends it as `Authorization: Bearer`.

The server loads the organization from that key and picks one Active agent in that org. That is why queue, priority, and status writes return 403 on this path. Ticket, note, and knowledge-article calls run as that agent.

## Where each value comes from

| Value | Where to get it |
|---|---|
| API key | Created once for the org. Not in the tool arguments. |
| `customer_id`, `customer_name`, `customer_email`, `customer_phone` | `verify_ticket_customer` result for the email or phone the user typed. Directory row in `cdp.customer_profile`. |
| `description` / note `text` / article `title`, `content`, `category` | Text the user typed. |
| `ticket_number` | `create_ticket` result, or a ticket already stored for this org in `ticketing.tickets.ticket_number`. |
| `assignee_id`, `agent_id`, `member_ids` | `list_agents`. Use `id` from that response. Those rows are `ticketing.agents` in this org. |
| `queue_id` | `list_queues`. Use the numeric team id. Table `ticketing.agent_queues`. |
| `article_id` | `list_kb`, `get_kb`, or the create/draft response. `ticketing.kb_articles.id` or `external_id` (`KB-…`). |
| `priority_id` | `list_priorities`. Numeric `ticketing.sla_policies.id`. |
| `status_id` | `list_statuses`. Numeric `ticketing.ticket_statuses.id`. |

Do not invent ids. If the lookup returns no row, do not call the write.

## Payloads

### verify_ticket_customer

Pass one of email, phone, or a single contact string.

```json
{
  "name": "verify_ticket_customer",
  "arguments": { "customerEmail": "<email the user typed>" }
}
```

Phone instead: `{ "customerPhone": "<phone the user typed>" }`.

Use the returned customer id on `create_ticket`. This tool does not insert a row.

The current MCP catalog entry for this name has no Express route. `POST /invoke` can fail until that route is wired. The arguments above are still the external payload.

### create_ticket

`customer_id` and `customer_name` come from `verify_ticket_customer`. `description` is the issue the user typed.

```json
{
  "name": "create_ticket",
  "arguments": {
    "customerName": "<name from verify>",
    "customerId": "<id from verify>",
    "customerEmail": "<email from verify>",
    "description": "<issue the user typed>"
  }
}
```

Writes `ticketing.tickets` for the key's organization. The new `ticket_number` is in the response. Use that number for escalate and notes.

### escalate_ticket

`ticket_number` from `create_ticket` or from an existing ticket in this org. `assignee_id` and `agent_id` from `list_agents`. `rationale` is text the user typed. All of the person fields are optional.

```json
{
  "name": "escalate_ticket",
  "arguments": {
    "ticket_number": "<ticket_number>",
    "assignee_id": "<id from list_agents>",
    "rationale": "<text the user typed>"
  }
}
```

Updates that ticket's assignee and resolver. A resolver login cannot escalate. This external key is an agent, so the call is allowed when the ticket is in the key's organization.

### add_ticket_note

```json
{
  "name": "add_ticket_note",
  "arguments": {
    "ticket_number": "<ticket_number>",
    "text": "<note the user typed>",
    "visibility": "internal"
  }
}
```

`ticket_number` is the same value as above. Writes `ticketing.ticket_notes`. The stored visibility is internal.

### create_kb_article

```json
{
  "name": "create_kb_article",
  "arguments": {
    "title": "<title the user typed>",
    "content": "<body, at least 10 characters>",
    "category": "<category the user typed>"
  }
}
```

Writes `ticketing.kb_articles` with status Published. Keep `id` or `external_id` from the response for update and publish.

### draft_kb_article

Same arguments as create. Status stored is Draft.

```json
{
  "name": "draft_kb_article",
  "arguments": {
    "title": "<title>",
    "content": "<body, at least 10 characters>",
    "category": "<category>"
  }
}
```

### update_kb_article

`article_id` from `list_kb`, `get_kb`, or the create/draft response. Pass at least one field to change.

```json
{
  "name": "update_kb_article",
  "arguments": {
    "article_id": "<kb id or KB-…>",
    "title": "<new title>"
  }
}
```

### publish_kb_article

`article_id` from the draft response or `list_kb`.

```json
{
  "name": "publish_kb_article",
  "arguments": {
    "article_id": "<kb id or KB-…>",
    "status": "Published"
  }
}
```

`docs/external_tools.py` always sends `status: Published` for this function.

### create_queue

External API keys are agents. This call is rejected with 403. It needs an admin. Payload if you have an admin path later:

`name` and `description` are text the user typed. `member_ids` are `id` values from `list_agents`.

```json
{
  "name": "create_queue",
  "arguments": {
    "name": "<team name>",
    "description": "<description>",
    "member_ids": ["<agents.id>"]
  }
}
```

Would write `ticketing.agent_queues` and `ticketing.agent_queue_members`.

### update_queue

Also 403 for this external key. `queue_id` comes from `list_queues`. `add_members: true` appends; omit it to replace the roster.

```json
{
  "name": "update_queue",
  "arguments": {
    "queue_id": "<agent_queues.id>",
    "add_members": true,
    "member_ids": ["<agents.id from list_agents>"]
  }
}
```

### create_priority

403 for this external key. `display_name` is the label the user typed. `resolution_hours` must be greater than 0.

```json
{
  "name": "create_priority",
  "arguments": { "display_name": "<label>", "resolution_hours": 8 }
}
```

Would write `ticketing.sla_policies`.

### update_priority

403 for this external key. `priority_id` from `list_priorities`.

```json
{
  "name": "update_priority",
  "arguments": {
    "priority_id": "<sla_policies.id>",
    "displayName": "<label>",
    "resolutionHours": 4,
    "active": true
  }
}
```

### create_status

403 for this external key.

```json
{
  "name": "create_status",
  "arguments": { "display_name": "<label>" }
}
```

Would write `ticketing.ticket_statuses`.

### update_status

403 for this external key. `status_id` from `list_statuses`.

```json
{
  "name": "update_status",
  "arguments": {
    "status_id": "<ticket_statuses.id>",
    "displayName": "<label>",
    "active": false
  }
}
```

## Calls that succeed with wt_live_

`verify_ticket_customer` (once Express is mapped), `create_ticket`, `escalate_ticket`, `add_ticket_note`, `create_kb_article`, `draft_kb_article`, `update_kb_article`, `publish_kb_article`, plus the lookups `list_agents`, `list_queues`, `list_kb`, `get_kb`, `list_priorities`, `list_statuses`.

## Calls the external key cannot complete

`create_queue`, `update_queue`, `create_priority`, `update_priority`, `create_status`, `update_status`.
