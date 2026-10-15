# Staff tool payloads

Input and success output for the 14 coworker tools on the MCP bridge.

```http
POST http://127.0.0.1:8020/mcp/v1/tools/call
Authorization: Bearer <MCP access token>
Content-Type: application/json
```

```json
{ "name": "<tool>", "arguments": { } }
```

A success is `{ "success": true, "payload": { } }`. A failure is `{ "success": false, "error_code": "BAD_INPUT", "message": "...", "retryable": false }`.

`ticket_number`, `queue_id`, `article_id`, `priority_id`, and `status_id` must already have been returned by a list or get for this organization. The ids below are shapes, not live rows.

---

## verify_ticket_customer

One of `customerEmail` or `customerPhone` is required. `contact` may be sent instead of those two.

```json
{ "customerEmail": "ada@example.com" }
```

Found:

```json
{
  "success": true,
  "payload": {
    "exists": true,
    "customerId": "CDP-…",
    "customerName": "Ada Lovelace",
    "customerEmail": "ada@example.com",
    "customerPhone": "",
    "customerDirectoryStatus": "verified",
    "next_step": "issue"
  }
}
```

Not on file: `exists` is false, `customer_not_found` is true, `next_step` is `"stop"`. Several matches: `ambiguous` is true, `matches` is a list, `next_step` is `"clarify_customer"`.

## create_ticket

The customer must already be on file. The tool requires `customerName` or `subject`. In practice the ticket also needs description, channel, priority, queue, and assignee.

```json
{
  "customerName": "Ada Lovelace",
  "customerEmail": "ada@example.com",
  "customerId": "CDP-…",
  "subject": "VPN down",
  "description": "Cannot connect since this morning.",
  "channel": "Email",
  "priority": "high",
  "queue": "Bug Solvers",
  "assigneeId": "123"
}
```

```json
{
  "success": true,
  "payload": {
    "id": "#1042",
    "subject": "VPN down",
    "description": "Cannot connect since this morning.",
    "customerId": "CDP-…",
    "customerName": "Ada Lovelace",
    "customerEmail": "ada@example.com",
    "channel": "Email",
    "assignee": "Agent Name",
    "assigneeId": "123",
    "queue": "Bug Solvers",
    "priority": "high",
    "status": "Open",
    "createdAt": "2026-10-01T10:00:00.000Z"
  }
}
```

`id` is the ticket number, such as `#1042`.

## escalate_ticket

`ticket_number` is required. Person fields are optional. A resolver cannot call this.

```json
{
  "ticket_number": "#1042",
  "assignee": "Resolver Name",
  "assignee_id": "456",
  "agent": "Agent Name",
  "agent_id": "123",
  "rationale": "Needs L2"
}
```

```json
{
  "success": true,
  "payload": {
    "ticket": {
      "id": "#1042",
      "status": "Open",
      "assignee": "Agent Name",
      "resolver": "Resolver Name"
    },
    "assignee": "Agent Name",
    "agent": "Agent Name",
    "resolver": "Resolver Name",
    "rationale": "Needs L2",
    "from": "Previous Agent"
  }
}
```

## add_ticket_note

`ticket_number` and `text` are required. The stored note is always internal.

```json
{
  "ticket_number": "#1042",
  "text": "Called the customer. Waiting on logs.",
  "visibility": "internal"
}
```

```json
{
  "success": true,
  "payload": {
    "id": "1502",
    "author": "Agent Name",
    "authorId": "123",
    "text": "Called the customer. Waiting on logs.",
    "at": "2026-10-01T10:05:00.000Z",
    "visibility": "internal",
    "pinned": false,
    "customerNotified": false
  }
}
```

## create_queue

Admin. At least one member is required. `members` are staff display names. `member_ids` are numeric staff ids from `list_agents`.

```json
{
  "name": "Billing",
  "description": "Invoices and refunds",
  "members": ["Ashika A"]
}
```

```json
{
  "success": true,
  "payload": {
    "id": "42",
    "queueName": "Billing",
    "description": "Invoices and refunds",
    "members": ["Ashika A"],
    "memberIds": ["123"],
    "openTickets": 0
  }
}
```

## update_queue

Admin. `queue_id` is the id from `list_queues` or `create_queue`. `add_members: true` adds people and keeps the current roster. Without it, `members` replaces the roster.

```json
{
  "queue_id": "42",
  "description": "Invoices, refunds, and credits",
  "members": ["Priya Moorthy"],
  "add_members": true
}
```

Success `payload` is the same queue object, with the updated description and roster.

## create_kb_article

Not a resolver. Title at least 2 characters. Content at least 10. Status becomes Published.

```json
{
  "title": "Reset VPN",
  "content": "Open the VPN client and choose Reconnect.",
  "category": "Network"
}
```

```json
{
  "success": true,
  "payload": {
    "id": "KB-…",
    "title": "Reset VPN",
    "content": "Open the VPN client and choose Reconnect.",
    "category": "Network",
    "author": "Agent Name",
    "status": "Published",
    "views": 0
  }
}
```

## draft_kb_article

Same arguments as create. Success `payload.status` is `"Draft"`.

## update_kb_article

`article_id` is the `KB-…` id from create, draft, or `list_kb`. Send only the fields that change.

```json
{
  "article_id": "KB-…",
  "title": "Reset VPN",
  "content": "Updated steps."
}
```

Success `payload` is the article with those fields updated.

## publish_kb_article

```json
{ "article_id": "KB-…" }
```

Success `payload` is the article with `"status": "Published"`.

## create_priority

Admin. `display_name` and `resolution_hours` are required. Hours must be greater than 0. A fraction is stored as at least 1 hour.

```json
{ "display_name": "P1", "resolution_hours": 4 }
```

```json
{
  "success": true,
  "payload": {
    "id": "7",
    "priority": "p1",
    "displayName": "P1",
    "resolutionHours": 4,
    "firstResponseHours": 1,
    "isSystem": false,
    "sortOrder": 100,
    "active": true
  }
}
```

## update_priority

Admin. `priority_id` comes from `list_priorities`.

```json
{ "priority_id": "7", "displayName": "P1", "resolutionHours": 2, "active": true }
```

Success `payload` is that same priority object after the change.

## create_status

Admin.

```json
{ "display_name": "Waiting on customer" }
```

```json
{
  "success": true,
  "payload": {
    "id": "3",
    "status": "waiting_on_customer",
    "displayName": "Waiting on customer",
    "isSystem": false,
    "isTerminal": false,
    "sortOrder": 100,
    "active": true
  }
}
```

## update_status

Admin. `status_id` comes from `list_statuses`.

```json
{ "status_id": "3", "displayName": "Waiting on customer", "active": true }
```

Success `payload` is that same status object after the change.
