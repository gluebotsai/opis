# Hub Super Agent (A2A)

Autonomous router for hub tasks. **No human-in-the-loop** and **no clarification
questions** back to the hub.

## Sub-agents (separate files)

| Skill | File | Job |
|-------|------|-----|
| `on_demand` | `app/hub_super/sub_agents/on_demand_agent.py` | Create campaign + launch automatically |
| `contacts` | `app/hub_super/sub_agents/contacts_agent.py` | Create contact from hub fields |
| `monitoring` | `app/hub_super/sub_agents/monitoring_agent.py` | Campaign report / stop / resume |

Execution is **sequential only** (no parallel skill groups).

## Endpoints

- `POST /ai/v1/hub/tasks` — run a hub task
- `GET /.well-known/agent.json` — skill catalog for hub discovery

## Example intents

- `on_demand_send` → `[on_demand]`
- `create_contact` → `[contacts]`
- `campaign_report` / `stop_channel` / `resume_channel` → `[monitoring]`
- `create_contact_and_send` → `[contacts, on_demand]` (multi-task)

## Request shape

```json
{
  "intent": "create_contact_and_send",
  "token": "<jwt>",
  "organization_id": "1001",
  "payload": {
    "first_name": "Ada",
    "email": "ada@example.com",
    "request_text": "Email Ada about the CRM product"
  }
}
```

Missing required fields → `status: failed` with structured `errors[]`.
Never `needs_clarification`.
