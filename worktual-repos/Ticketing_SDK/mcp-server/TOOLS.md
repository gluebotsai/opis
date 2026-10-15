# Worktual Ticketing — MCP server and tools

FastMCP process at `mcp-server/server.py` registers every tool from
`shared/ticketing_tool_catalog.json`. Express remains RBAC and mutation
authority. This process does not write SQL.

Canonical catalog: [`../shared/ticketing_tool_catalog.json`](../shared/ticketing_tool_catalog.json)
(schema_version **1.0**, namespace **ticketing.v1**).

Catalog entries: **84**. Unique tool names: **83**.
Duplicate name(s) in the JSON (same definition): `list_ticket_recommendations`.

Super / Domain MAS controls (`route_to_domain`, `delegate_to_executor`,
`navigate`, `patch_*_draft`, and similar) are **not** MCP tools.

## Server

| Field | Value |
|---|---|
| Process | `mcp-server/server.py` (FastMCP) |
| Server name | Worktual Ticketing |
| Instructions | Worktual ticketing tools. Mutations go through Express with org RBAC. Pass coworker actor headers (internal) or an org API key (external). |
| Default bind | `127.0.0.1:8020` (`MCP_HOST` / `MCP_PORT`) |
| Express | `EXPRESS_BASE_URL` default `http://127.0.0.1:3000` |
| Rate limit | 120 calls / 60s (`MCP_RATE_LIMIT_MAX` / `MCP_RATE_LIMIT_WINDOW_SEC`) |

### URLs

| Use | URL |
|---|---|
| **MCP protocol** (Cursor / Claude Desktop) | **`http://127.0.0.1:8020/mcp`** |
| Health | `GET http://127.0.0.1:8020/health` |
| Internal invoke (`TOOLS_TRANSPORT=mcp`) | `POST http://127.0.0.1:8020/invoke` body `{"name":"list_tickets","arguments":{...}}` |
| Agents config | `MCP_SERVER_URL=http://127.0.0.1:8020` |

Second HTTP surface (FastAPI in `ai-agents`, default **`:8012`**, not FastMCP):

- `GET http://127.0.0.1:8012/mcp/v1/tools/list` (JWT)
- `POST http://127.0.0.1:8012/mcp/v1/tools/call`

That list can include local MAS tools plus catalog tools. Standalone MCP is **`:8020/mcp`**.

### Run locally

```bash
cd mcp-server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export EXPRESS_BASE_URL=http://127.0.0.1:3000
export COWORKER_TASKS_SECRET=worktual-tasks-dev-secret
python server.py
```

### Environment

| Variable | Default | Notes |
|---|---|---|
| `MCP_HOST` | `127.0.0.1` | Public binds (`0.0.0.0`) refused unless `MCP_ALLOW_PUBLIC_BIND=1` |
| `MCP_PORT` | `8020` | Bind port |
| `MCP_TRANSPORT` | `http` | Legacy `streamable-http` maps to `http` |
| `EXPRESS_BASE_URL` | `http://127.0.0.1:3000` | Express API |
| `COWORKER_TASKS_SECRET` | dev secret | Must match Express; required on internal actor calls |
| `MCP_RATE_LIMIT_MAX` | `120` | Max tool calls per window (`0` disables) |
| `MCP_RATE_LIMIT_WINDOW_SEC` | `60` | Sliding window seconds |

### Auth

**Internal (ai-agents)** — all of:

- `X-Coworker-Tasks-Key` (must match `COWORKER_TASKS_SECRET`)
- `X-Coworker-Actor-Id`
- `X-Coworker-Org-Id`
- optional role/name

Bare actor id/org without the tasks key is rejected.

**External** — org API key (`Authorization: Bearer wt_live_…` or `X-Api-Key`).
MCP resolves an Active **agent** (not admin) via Express `GET /api/mcp/session`.

### Hardening

- Audit log `ticketing.mcp.audit` (tool, actor, org, key id — no secrets).
- Per-caller rate limit on MCP tools and `/invoke`.
- Bind defaults to loopback; public bind requires explicit opt-in.

### Cursor / Claude Desktop

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

See also [`README.md`](README.md).

## Tool index

1. [`get_ticket`](#get_ticket)
2. [`list_tickets`](#list_tickets)
3. [`get_ticket_progress`](#get_ticket_progress)
4. [`list_ticket_notes`](#list_ticket_notes)
5. [`get_triage_stats`](#get_triage_stats)
6. [`get_dashboard_chart`](#get_dashboard_chart)
7. [`list_activities`](#list_activities)
8. [`create_ticket`](#create_ticket)
9. [`enrich_ticket`](#enrich_ticket)
10. [`verify_ticket_customer`](#verify_ticket_customer)
11. [`update_ticket`](#update_ticket)
12. [`escalate_ticket`](#escalate_ticket)
13. [`auto_assign_ticket`](#auto_assign_ticket)
14. [`add_ticket_note`](#add_ticket_note)
15. [`list_queues`](#list_queues)
16. [`create_queue`](#create_queue)
17. [`update_queue`](#update_queue)
18. [`delete_queue`](#delete_queue)
19. [`resolve_ticket_person`](#resolve_ticket_person)
20. [`list_kb`](#list_kb)
21. [`search_kb`](#search_kb)
22. [`list_kb_categories`](#list_kb_categories)
23. [`manage_kb_category`](#manage_kb_category)
24. [`export_kb`](#export_kb)
25. [`import_kb_articles`](#import_kb_articles)
26. [`get_kb`](#get_kb)
27. [`update_kb_article`](#update_kb_article)
28. [`publish_kb_article`](#publish_kb_article)
29. [`create_kb_article`](#create_kb_article)
30. [`draft_kb_article`](#draft_kb_article)
31. [`list_customers`](#list_customers)
32. [`get_customer_360`](#get_customer_360)
33. [`import_customers`](#import_customers)
34. [`create_customer`](#create_customer)
35. [`list_macros`](#list_macros)
36. [`create_macro`](#create_macro)
37. [`update_macro`](#update_macro)
38. [`delete_macro`](#delete_macro)
39. [`list_agents`](#list_agents)
40. [`list_priorities`](#list_priorities)
41. [`create_priority`](#create_priority)
42. [`update_priority`](#update_priority)
43. [`delete_priority`](#delete_priority)
44. [`list_statuses`](#list_statuses)
45. [`create_status`](#create_status)
46. [`update_status`](#update_status)
47. [`delete_status`](#delete_status)
48. [`get_metrics`](#get_metrics)
49. [`list_ticket_recommendations`](#list_ticket_recommendations)
50. [`get_analytics`](#get_analytics)
51. [`export_analytics`](#export_analytics)
52. [`get_csat_reports`](#get_csat_reports)
53. [`list_audit`](#list_audit)
54. [`list_escalation_directory`](#list_escalation_directory)
55. [`list_widgets`](#list_widgets)
56. [`create_widget`](#create_widget)
57. [`update_widget`](#update_widget)
58. [`list_integration_keys`](#list_integration_keys)
59. [`create_integration_key`](#create_integration_key)
60. [`revoke_integration_key`](#revoke_integration_key)
61. [`list_automation_rules`](#list_automation_rules)
62. [`create_automation_rule`](#create_automation_rule)
63. [`update_automation_rule`](#update_automation_rule)
64. [`delete_automation_rule`](#delete_automation_rule)
65. [`get_org_preferences`](#get_org_preferences)
66. [`get_user_preferences`](#get_user_preferences)
67. [`update_user_preference`](#update_user_preference)
68. [`verify_hard_preferences`](#verify_hard_preferences)
69. [`store_long_term_memory`](#store_long_term_memory)
70. [`search_long_term_memory`](#search_long_term_memory)
71. [`update_org_preferences`](#update_org_preferences)
72. [`list_notifications`](#list_notifications)
73. [`send_staff_notification`](#send_staff_notification)
74. [`mark_all_notifications_read`](#mark_all_notifications_read)
75. [`mark_notification_read`](#mark_notification_read)
76. [`clear_notifications`](#clear_notifications)
77. [`portal_list_tickets`](#portal_list_tickets)
78. [`get_customer_order`](#get_customer_order)
79. [`portal_create_ticket`](#portal_create_ticket)
80. [`ask_semantic_layer`](#ask_semantic_layer)
81. [`ask_sql_layer`](#ask_sql_layer)
82. [`ask_knowledge_graph`](#ask_knowledge_graph)
83. [`ask_hub`](#ask_hub)

## Tools

### `get_ticket`

Get one ticket by ticket_number (e.g. 12345 or #12345).

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/tickets/{ticket_number}`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "ticket_number": {
      "type": "string"
    }
  },
  "required": [
    "ticket_number"
  ]
}
```

### `list_tickets`

List or search tickets using structured, actor-scoped filters.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/tickets`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "scope": {
      "type": "string",
      "enum": [
        "default",
        "assignee",
        "team",
        "org",
        "search",
        "created",
        "unassigned"
      ]
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100,
      "description": "Page size. Default 12 for chat lists."
    },
    "offset": {
      "type": "integer",
      "minimum": 0,
      "description": "Skip this many rows for the next page."
    },
    "created_by": {
      "type": "string",
      "enum": [
        "SELF"
      ]
    },
    "assigned_to": {
      "type": "string"
    },
    "status": {
      "type": "string"
    },
    "priority": {
      "type": "string"
    },
    "channel": {
      "type": "string"
    },
    "query": {
      "type": "string",
      "maxLength": 200
    },
    "queue": {
      "type": "string"
    },
    "customer": {
      "type": "string"
    },
    "due": {
      "type": "string",
      "enum": [
        "today",
        "overdue"
      ]
    },
    "created_range": {
      "type": "string",
      "description": "Created-at window. Presets: today, yesterday, this_week, last_week, this_month, last_month, last_24h, last_7d, last_30d. Aliases like past_month map to last_30d. Or ISO YYYY-MM-DD or YYYY-MM-DD/YYYY-MM-DD from trusted now."
    },
    "updated_range": {
      "type": "string",
      "description": "Updated-at window. Same presets/aliases/ISO windows as created_range."
    },
    "sort": {
      "type": "string",
      "enum": [
        "latest",
        "oldest",
        "priority",
        "due"
      ]
    }
  }
}
```

### `get_ticket_progress`

Get ticket progress stepper and status history.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/tickets/{ticket_number}/progress`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "ticket_number": {
      "type": "string"
    }
  },
  "required": [
    "ticket_number"
  ]
}
```

### `list_ticket_notes`

List recent notes for one ticket.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/tickets/{ticket_number}/notes`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "ticket_number": {
      "type": "string"
    }
  },
  "required": [
    "ticket_number"
  ]
}
```

### `get_triage_stats`

Agent/admin triage cards: created by me, reassigned out, open on my teams.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/agent/triage-stats`

**Input schema**

```json
{
  "type": "object",
  "properties": {}
}
```

### `get_dashboard_chart`

Dashboard workload chart series for a time range.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/dashboard/chart`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "chart_range": {
      "type": "string",
      "enum": [
        "24hours",
        "7days",
        "30days"
      ]
    }
  }
}
```

### `list_activities`

Recent Home dashboard activity rows.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/activities`

**Input schema**

```json
{
  "type": "object",
  "properties": {}
}
```

### `create_ticket`

Create a ticket (customerName and/or subject required).

- **Auth:** `actor_or_api_key`
- **Express:** `POST /api/tickets`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "customerName": {
      "type": "string"
    },
    "customerId": {
      "type": "string"
    },
    "customerEmail": {
      "type": "string"
    },
    "customerPhone": {
      "type": "string"
    },
    "subject": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "channel": {
      "type": "string"
    },
    "priority": {
      "type": "string"
    },
    "status": {
      "type": "string"
    },
    "queue": {
      "type": "string"
    },
    "category": {
      "type": "string"
    },
    "skill": {
      "type": "string"
    },
    "assigneeId": {
      "type": "string"
    },
    "resolverId": {
      "type": "string"
    },
    "queueId": {
      "type": "string"
    },
    "orderId": {
      "type": "string"
    },
    "productId": {
      "type": "string"
    },
    "references": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": { "type": "string" },
          "id": { "type": "string" }
        }
      }
    }
  }
}
```

### `enrich_ticket`

Preview authoritative ticket triage and assignment before confirmation.

- **Auth:** `actor_or_api_key`
- **Express:** `POST /api/tickets/enrich`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "customerName": {
      "type": "string"
    },
    "customerEmail": {
      "type": "string"
    },
    "customerPhone": {
      "type": "string"
    },
    "issue": {
      "type": "string"
    }
  },
  "required": [
    "customerName",
    "issue"
  ]
}
```

### `verify_ticket_customer`

Check CDP/directory for email or phone during create-ticket before collecting the issue.

- **Auth:** `actor_or_api_key`
- **Express:** —

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "customerName": {
      "type": "string"
    },
    "customerEmail": {
      "type": "string"
    },
    "customerPhone": {
      "type": "string"
    },
    "contact": {
      "type": "string"
    }
  }
}
```

### `update_ticket`

Update ticket fields (status, priority, assignee, subject, …).

- **Auth:** `actor_or_api_key`
- **Express:** `PUT /api/tickets/{ticket_number}`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "ticket_number": {
      "type": "string"
    },
    "status": {
      "type": "string"
    },
    "priority": {
      "type": "string"
    },
    "assignee": {
      "type": "string"
    },
    "resolver": {
      "type": "string"
    },
    "subject": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "queue": {
      "type": "string"
    },
    "category": {
      "type": "string"
    },
    "ai_summary": {
      "type": "string"
    }
  },
  "required": [
    "ticket_number"
  ]
}
```

### `escalate_ticket`

Escalate a ticket; optional assignee/agent/rationale.

- **Auth:** `actor_or_api_key`
- **Express:** `POST /api/tickets/{ticket_number}/escalate`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "ticket_number": {
      "type": "string"
    },
    "assignee": {
      "type": "string"
    },
    "assignee_id": {
      "type": "string"
    },
    "agent": {
      "type": "string"
    },
    "agent_id": {
      "type": "string"
    },
    "rationale": {
      "type": "string"
    }
  },
  "required": [
    "ticket_number"
  ]
}
```

### `auto_assign_ticket`

Auto-assign a ticket via backend routing. Never invent the assignee.

- **Auth:** `actor_or_api_key`
- **Express:** `POST /api/tickets/{ticket_number}/auto-assign`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "ticket_number": {
      "type": "string"
    }
  },
  "required": [
    "ticket_number"
  ]
}
```

### `add_ticket_note`

Add a note to a ticket by ticket_number.

- **Auth:** `actor_or_api_key`
- **Express:** `POST /api/tickets/{ticket_number}/notes`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "ticket_number": {
      "type": "string"
    },
    "text": {
      "type": "string"
    },
    "visibility": {
      "type": "string",
      "enum": [
        "internal",
        "public"
      ]
    },
    "send_customer_email": {
      "type": "boolean"
    }
  },
  "required": [
    "ticket_number",
    "text"
  ]
}
```

### `list_queues`

List teams/queues for the org.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/queues`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string"
    }
  }
}
```

### `create_queue`

Create a queue/team by name.

- **Auth:** `actor_or_api_key`
- **Express:** `POST /api/queues`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "members": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "member_ids": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "name"
  ]
}
```

### `update_queue`

Update a queue/team (name, description, members). For adding people to an existing team, pass only the new staff in members/member_ids and set add_members=true so existing members are kept. Without add_members, members/member_ids replace the full roster.

- **Auth:** `actor_or_api_key`
- **Express:** `PATCH /api/queues/{queue_id}`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "queue_id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "members": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "member_ids": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "add_members": {
      "type": "boolean",
      "description": "When true, merge members/member_ids into the existing team roster instead of replacing it."
    }
  },
  "required": [
    "queue_id"
  ]
}
```

### `delete_queue`

Delete a queue/team by id.

- **Auth:** `actor_or_api_key`
- **Express:** `DELETE /api/queues/{queue_id}`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "queue_id": {
      "type": "string"
    }
  },
  "required": [
    "queue_id"
  ]
}
```

### `resolve_ticket_person`

List and rank live staff for ticket reassignment or escalation.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/agents`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "response": {
      "type": "string"
    },
    "ticket_number": {
      "type": "string"
    },
    "target_role": {
      "type": "string",
      "enum": [
        "agent",
        "resolver",
        "admin"
      ]
    },
    "user_query": {
      "type": "string"
    },
    "proceed": {
      "type": "integer",
      "minimum": 0,
      "maximum": 1
    }
  }
}
```

### `list_kb`

List knowledge base articles.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/kb`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string"
    },
    "category": {
      "type": "string"
    },
    "status": {
      "type": "string"
    }
  }
}
```

### `search_kb`

Retrieve the single best published knowledge article for how-to or troubleshooting. Uses the Meilisearch index. Quote the TOOL RESULT only. Use list_kb or get_kb to browse or open an article.

- **Auth:** `actor_or_api_key`
- **Express:** `POST /api/internal/kb/search`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string"
    }
  },
  "required": [
    "query"
  ]
}
```

### `list_kb_categories`

List category labels derived from live knowledge articles.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/kb`

**Input schema**

```json
{
  "type": "object",
  "properties": {}
}
```

### `manage_kb_category`

Validate and stage a knowledge category label, or list categories.

- **Auth:** `actor_or_api_key`
- **Express:** —

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "maxLength": 64
    },
    "mode": {
      "type": "string",
      "enum": [
        "add",
        "list"
      ]
    }
  },
  "required": [
    "name"
  ]
}
```

### `export_kb`

Export live knowledge articles as JSON, CSV, Markdown, text, PDF, or Word.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/kb`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "fmt": {
      "type": "string",
      "enum": [
        "json",
        "csv",
        "md",
        "txt",
        "pdf",
        "doc"
      ]
    },
    "category": {
      "type": "string"
    }
  }
}
```

### `import_kb_articles`

Import knowledge articles from a JSON array.

- **Auth:** `actor_or_api_key`
- **Express:** `POST /api/kb`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "articles_json": {
      "type": "string"
    }
  },
  "required": [
    "articles_json"
  ]
}
```

### `get_kb`

Get one knowledge article by id.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/kb/{article_id}`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "article_id": {
      "type": "string"
    }
  },
  "required": [
    "article_id"
  ]
}
```

### `update_kb_article`

Update a KB article (title, content, category, status).

- **Auth:** `actor_or_api_key`
- **Express:** `PATCH /api/kb/{article_id}`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "article_id": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "content": {
      "type": "string"
    },
    "category": {
      "type": "string"
    },
    "status": {
      "type": "string"
    }
  },
  "required": [
    "article_id"
  ]
}
```

### `publish_kb_article`

Publish a KB article by id.

- **Auth:** `actor_or_api_key`
- **Express:** `PATCH /api/kb/{article_id}`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "article_id": {
      "type": "string"
    }
  },
  "required": [
    "article_id"
  ]
}
```

### `create_kb_article`

Create and publish a KB article with title, content, category.

- **Auth:** `actor_or_api_key`
- **Express:** `POST /api/kb`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "content": {
      "type": "string"
    },
    "category": {
      "type": "string"
    },
    "author": {
      "type": "string"
    }
  },
  "required": [
    "title",
    "content",
    "category"
  ]
}
```

### `draft_kb_article`

Save a KB article as a staff-only draft with title, content, category.

- **Auth:** `actor_or_api_key`
- **Express:** `POST /api/kb`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "content": {
      "type": "string"
    },
    "category": {
      "type": "string"
    },
    "author": {
      "type": "string"
    }
  },
  "required": [
    "title",
    "content",
    "category"
  ]
}
```

### `list_customers`

List customers in the directory.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/customers`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string"
    },
    "status": {
      "type": "string"
    },
    "exact_email": {
      "type": "string"
    },
    "exact_phone": {
      "type": "string"
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "offset": {
      "type": "integer",
      "minimum": 0
    }
  }
}
```

### `get_customer_360`

Get customer ticket history and counts by email.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/customers/360`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "email": {
      "type": "string"
    }
  },
  "required": [
    "email"
  ]
}
```

### `import_customers`

Import customers from CSV text. Do not invent rows.

- **Auth:** `actor_or_api_key`
- **Express:** `POST /api/customers/import`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "csv_text": {
      "type": "string"
    }
  },
  "required": [
    "csv_text"
  ]
}
```

### `create_customer`

Create a customer in the directory (admin). Same body as Customers form.

- **Auth:** `actor_or_api_key`
- **Express:** `POST /api/customers`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "email": {
      "type": "string"
    },
    "phone": {
      "type": "string"
    },
    "accountName": {
      "type": "string"
    }
  },
  "required": [
    "name"
  ]
}
```

### `list_macros`

List macros. Optional q searches title/body in SQL.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/macros`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "q": {
      "type": "string"
    }
  }
}
```

### `create_macro`

Create a macro with title and body.

- **Auth:** `actor_or_api_key`
- **Express:** `POST /api/macros`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "body": {
      "type": "string"
    }
  },
  "required": [
    "title",
    "body"
  ]
}
```

### `update_macro`

Patch a macro title and/or body.

- **Auth:** `actor_or_api_key`
- **Express:** `PATCH /api/macros/{macro_id}`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "macro_id": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "body": {
      "type": "string"
    }
  },
  "required": [
    "macro_id"
  ]
}
```

### `delete_macro`

Delete a macro by id.

- **Auth:** `actor_or_api_key`
- **Express:** `DELETE /api/macros/{macro_id}`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "macro_id": {
      "type": "string"
    }
  },
  "required": [
    "macro_id"
  ]
}
```

### `list_agents`

List assignable staff for the org.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/agents`

**Input schema**

```json
{
  "type": "object",
  "properties": {}
}
```

### `list_priorities`

List priority catalog entries.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/priorities`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "include_inactive": {
      "type": "boolean"
    }
  }
}
```

### `create_priority`

Create a priority (admin): display name + resolution hours (whole hours; sub-hour values store as 1h minimum). On user affirmation call with confirmed=true.

- **Auth:** `actor_or_api_key`
- **Express:** `POST /api/priorities`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "display_name": {
      "type": "string"
    },
    "displayName": {
      "type": "string"
    },
    "resolution_hours": {
      "type": "number"
    },
    "resolutionHours": {
      "type": "number"
    },
    "hours": {
      "type": "number"
    },
    "confirmed": {
      "type": "boolean"
    }
  }
}
```

### `update_priority`

Patch priority display name, SLA hours, or active flag (admin).

- **Auth:** `actor_or_api_key`
- **Express:** `PATCH /api/priorities/{priority_id}`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "priority_id": {
      "type": "string"
    },
    "displayName": {
      "type": "string"
    },
    "resolutionHours": {
      "type": "number"
    },
    "active": {
      "type": "boolean"
    }
  },
  "required": [
    "priority_id"
  ]
}
```

### `delete_priority`

Delete one or more priorities in a single call (admin). Pass priority_ids with every numeric id from list_priorities they asked to remove. For one row, priority_id is enough. Never call this tool more than once this turn.

- **Auth:** `actor_or_api_key`
- **Express:** `DELETE /api/priorities/{priority_id}`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "priority_id": {
      "type": "string"
    },
    "priority_ids": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}
```

### `list_statuses`

List ticket status catalog entries.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/statuses`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "include_inactive": {
      "type": "boolean"
    }
  }
}
```

### `create_status`

Create a ticket status (admin).

- **Auth:** `actor_or_api_key`
- **Express:** `POST /api/statuses`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "display_name": {
      "type": "string"
    }
  },
  "required": [
    "display_name"
  ]
}
```

### `update_status`

Patch status display name or active flag (admin).

- **Auth:** `actor_or_api_key`
- **Express:** `PATCH /api/statuses/{status_id}`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "status_id": {
      "type": "string"
    },
    "displayName": {
      "type": "string"
    },
    "active": {
      "type": "boolean"
    }
  },
  "required": [
    "status_id"
  ]
}
```

### `delete_status`

Delete one or more statuses in a single call (admin). Pass status_ids with every numeric id from list_statuses they asked to remove. For one row, status_id is enough. Never call this tool more than once this turn.

- **Auth:** `actor_or_api_key`
- **Express:** `DELETE /api/statuses/{status_id}`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "status_id": {
      "type": "string"
    },
    "status_ids": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}
```

### `get_metrics`

Structured Home dashboard snapshot only (scope=org|self). NOT for natural-language 'how many open tickets' questions — those MUST use ask_semantic_layer.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/metrics`

**Input schema**

```json
{
  "type": "object",
  "properties": {}
}
```

### `list_ticket_recommendations`

List proactive ticket recommendations for the actor, optionally for one ticket.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/proactive/recommendations`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "ticket_number": {
      "type": "string"
    }
  }
}
```

### `get_analytics`

Structured analytics snapshot for 24hours, 7days, or 30days. NOT for NL how-many/CSAT/SLA questions — use ask_semantic_layer. NOT for why/drivers — use ask_knowledge_graph.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/analytics`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "range": {
      "type": "string",
      "enum": [
        "24hours",
        "7days",
        "30days"
      ]
    }
  }
}
```

### `export_analytics`

Prepare analytics CSV download href. Never dump CSV into chat.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/analytics/export`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "range": {
      "type": "string",
      "enum": [
        "24hours",
        "7days",
        "30days"
      ]
    }
  }
}
```

### `get_csat_reports`

Get CSAT reports for 7days, 30days, or 90days.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/csat-reports`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "range": {
      "type": "string",
      "enum": [
        "7days",
        "30days",
        "90days"
      ]
    }
  }
}
```

### `list_audit`

List immutable audit events with optional action, actor, ticket, range filters.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/audit`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "limit": {
      "type": "integer"
    },
    "action": {
      "type": "string"
    },
    "actor": {
      "type": "string"
    },
    "ticket": {
      "type": "string"
    },
    "range": {
      "type": "string"
    }
  }
}
```

### `list_escalation_directory`

Read-only escalation directory (teams, members, skills).

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/escalation-directory`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "q": {
      "type": "string"
    },
    "skill": {
      "type": "string"
    }
  }
}
```

### `list_widgets`

List integration widgets.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/integration/widgets`

**Input schema**

```json
{
  "type": "object",
  "properties": {}
}
```

### `create_widget`

Create an integration widget.

- **Auth:** `actor_or_api_key`
- **Express:** `POST /api/integration/widgets`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "buttonLabel": {
      "type": "string"
    },
    "allowedOrigins": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "name"
  ]
}
```

### `update_widget`

Update an integration widget.

- **Auth:** `actor`
- **Express:** `PATCH /api/integration/widgets/{widget_id}`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "widget_id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "button_label": {
      "type": "string"
    },
    "enabled": {
      "type": "boolean"
    },
    "allowed_origins": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "widget_id"
  ]
}
```

### `list_integration_keys`

List integration API keys metadata only (masked prefix, never secrets).

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/integration/keys`

**Input schema**

```json
{
  "type": "object",
  "properties": {}
}
```

### `create_integration_key`

Create an integration API key and return its secret once.

- **Auth:** `actor`
- **Express:** `POST /api/integration/keys`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    }
  },
  "required": [
    "name"
  ]
}
```

### `revoke_integration_key`

Revoke an integration API key.

- **Auth:** `actor`
- **Express:** `DELETE /api/integration/keys/{key_id}`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "key_id": {
      "type": "string"
    }
  },
  "required": [
    "key_id"
  ]
}
```

### `list_automation_rules`

List automation rules.

- **Auth:** `actor`
- **Express:** `GET /api/automation/rules`

**Input schema**

```json
{
  "type": "object",
  "properties": {}
}
```

### `create_automation_rule`

Create an automation rule.

- **Auth:** `actor`
- **Express:** `POST /api/automation/rules`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "event": {
      "type": "string",
      "enum": [
        "ticket.created",
        "ticket.updated"
      ]
    },
    "conditions": {
      "type": "object"
    },
    "actions": {
      "type": "object"
    },
    "priority": {
      "type": "integer"
    },
    "enabled": {
      "type": "boolean"
    }
  },
  "required": [
    "name",
    "event"
  ]
}
```

### `update_automation_rule`

Update an automation rule.

- **Auth:** `actor`
- **Express:** `PATCH /api/automation/rules/{rule_id}`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "rule_id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "event": {
      "type": "string",
      "enum": [
        "ticket.created",
        "ticket.updated"
      ]
    },
    "conditions": {
      "type": "object"
    },
    "actions": {
      "type": "object"
    },
    "priority": {
      "type": "integer"
    },
    "enabled": {
      "type": "boolean"
    }
  },
  "required": [
    "rule_id"
  ]
}
```

### `delete_automation_rule`

Delete an automation rule.

- **Auth:** `actor`
- **Express:** `DELETE /api/automation/rules/{rule_id}`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "rule_id": {
      "type": "string"
    }
  },
  "required": [
    "rule_id"
  ]
}
```

### `get_org_preferences`

Get org preferences.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/org-preferences`

**Input schema**

```json
{
  "type": "object",
  "properties": {}
}
```

### `get_user_preferences`

Get the actor soft/hard preference scratchpad from Postgres.

- **Auth:** `actor`
- **Express:** —

**Input schema**

```json
{
  "type": "object",
  "properties": {}
}
```

### `update_user_preference`

Upsert one user preference. soft injects into prompts; hard is enforced by verify_hard_preferences.

- **Auth:** `actor`
- **Express:** —

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "key": {
      "type": "string"
    },
    "value": {},
    "kind": {
      "type": "string",
      "enum": [
        "soft",
        "hard"
      ]
    }
  },
  "required": [
    "key",
    "kind"
  ]
}
```

### `verify_hard_preferences`

Check a proposed tool action against hard preferences (allow|block|approval_required).

- **Auth:** `actor`
- **Express:** —

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "tool_name": {
      "type": "string"
    },
    "arguments": {
      "type": "object"
    },
    "channel": {
      "type": "string"
    }
  },
  "required": [
    "tool_name"
  ]
}
```

### `store_long_term_memory`

Store a durable cross-session memory fact for the actor.

- **Auth:** `actor`
- **Express:** —

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "content": {
      "type": "string"
    },
    "kind": {
      "type": "string"
    },
    "conversation_id": {
      "type": "string"
    }
  },
  "required": [
    "content"
  ]
}
```

### `search_long_term_memory`

Search tenant/user-scoped long-term memory; returns a bounded result set.

- **Auth:** `actor`
- **Express:** —

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string"
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 20
    }
  },
  "required": [
    "query"
  ]
}
```

### `update_org_preferences`

Update non-secret org preferences. Send only changed fields.

- **Auth:** `actor_or_api_key`
- **Express:** `PUT /api/org-preferences`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "ticket_prefix": {
      "type": "string"
    },
    "portal_label": {
      "type": "string"
    },
    "display_timezone": {
      "type": "string"
    },
    "portal_auth_mode": {
      "type": "string",
      "enum": [
        "password",
        "otp"
      ]
    },
    "business_type": {
      "type": "string",
      "enum": [
        "b2b",
        "b2c"
      ]
    }
  }
}
```

### `list_notifications`

List notifications for the actor.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/notifications`

**Input schema**

```json
{
  "type": "object",
  "properties": {}
}
```

### `send_staff_notification`

Send a grounded notification to one or more staff users.

- **Auth:** `actor`
- **Express:** `POST /api/notifications/send`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "user_id": {
      "type": "string"
    },
    "user_ids": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "title": {
      "type": "string"
    },
    "message": {
      "type": "string"
    },
    "kind": {
      "type": "string"
    },
    "ticket_uuid": {
      "type": "string"
    },
    "customer_name": {
      "type": "string"
    }
  },
  "required": [
    "title",
    "message"
  ]
}
```

### `mark_all_notifications_read`

Mark all notifications read.

- **Auth:** `actor_or_api_key`
- **Express:** `POST /api/notifications/read-all`

**Input schema**

```json
{
  "type": "object",
  "properties": {}
}
```

### `mark_notification_read`

Mark one notification read.

- **Auth:** `actor_or_api_key`
- **Express:** `PATCH /api/notifications/{notification_id}/read`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "notification_id": {
      "type": "string"
    }
  },
  "required": [
    "notification_id"
  ]
}
```

### `clear_notifications`

Clear all notifications for the current actor.

- **Auth:** `actor`
- **Express:** `DELETE /api/notifications`

**Input schema**

```json
{
  "type": "object",
  "properties": {}
}
```

### `portal_list_tickets`

List the signed-in support-portal customer's tickets.

- **Auth:** `portal_customer`
- **Express:** `GET /api/internal/portal/tickets`

**Input schema**

```json
{
  "type": "object",
  "properties": {}
}
```

### `get_customer_order`

Look up one order for this organization and this customer only (cdp.orders). Use after they gave an order id for a purchase-related ticket. Never invent an order.

- **Auth:** `actor_or_api_key`
- **Express:** `GET /api/internal/orders`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "order_id": {
      "type": "string"
    },
    "customer_id": {
      "type": "string"
    }
  },
  "required": [
    "order_id"
  ]
}
```

### `portal_create_ticket`

File a ticket for the signed-in support-portal customer (issue or description required).

- **Auth:** `portal_customer`
- **Express:** `POST /api/internal/portal/tickets`

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "issue": {
      "type": "string"
    },
    "subject": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "orderId": {
      "type": "string"
    },
    "productId": {
      "type": "string"
    },
    "references": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": { "type": "string" },
          "id": { "type": "string" }
        }
      }
    }
  }
}
```

### `ask_semantic_layer`

Certified KPI numbers via POST /v1/semantic/query. Read every slice metric and dimension, then pass the best-fit metrics[] ids — never the user sentence and never a weakly related first row. Optional group_by only for a requested break-down, filters [{dimension, op, value|values}], order_by, time only if they named a window, limit, dataScope org|mine. Runtime fills organizationId, userId, product, agent. Values only — not why. Combined value+why: also call ask_knowledge_graph.

- **Auth:** `actor_or_api_key`
- **Express:** —

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "metrics": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "minItems": 1
    },
    "group_by": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "filters": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "dimension": {
            "type": "string"
          },
          "op": {
            "type": "string"
          },
          "value": {},
          "values": {
            "type": "array"
          }
        },
        "required": [
          "dimension"
        ]
      }
    },
    "time": {
      "type": "object",
      "properties": {
        "period": {
          "type": "string"
        },
        "start": {
          "type": "string"
        },
        "end": {
          "type": "string"
        },
        "grain": {
          "type": "string"
        }
      }
    },
    "limit": {
      "type": "integer"
    },
    "dataScope": {
      "type": "string",
      "enum": [
        "org",
        "mine"
      ]
    },
    "order_by": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "metrics"
  ]
}
```

### `ask_sql_layer`

List/search ticket rows via POST /v1/sql/query. Required instruction (one English sentence). Recommended entityHint wt:Ticket. Optional filters [{dimension, op, value|values}] and limit. Runtime fills organizationId, userId, originProduct, originAgent. No SQL, no table names, no empty args. Success with rows=[] is zero tickets — do not also call list_tickets. list_tickets only if this tool fails. Not for how-many/CSAT/SLA %.

- **Auth:** `actor_or_api_key`
- **Express:** —

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "instruction": {
      "type": "string"
    },
    "entityHint": {
      "type": "string"
    },
    "entity_hint": {
      "type": "string"
    },
    "filters": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "dimension": {
            "type": "string"
          },
          "op": {
            "type": "string"
          },
          "value": {},
          "values": {
            "type": "array"
          }
        },
        "required": [
          "dimension"
        ]
      }
    },
    "limit": {
      "type": "integer"
    }
  },
  "required": [
    "instruction"
  ]
}
```

### `ask_knowledge_graph`

Why/analyse/drivers narrative via the knowledge graph. Use for why metrics moved or what is causing issues. NOT for exact KPI numbers alone — call ask_semantic_layer for values. Combined value+why: call ask_semantic_layer then this.

- **Auth:** `actor_or_api_key`
- **Express:** —

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string"
    },
    "organization_id": {
      "type": "string"
    },
    "session_id": {
      "type": "string"
    }
  },
  "required": [
    "query"
  ]
}
```

### `ask_hub`

Send leftover/out-of-product asks to Worktual Hub A2A (campaign, marketing, CCaaS, CVM). Requires focused customer cdp_id.

- **Auth:** `actor_or_api_key`
- **Express:** —

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string"
    },
    "cdp_id": {
      "type": "string"
    },
    "organization_id": {
      "type": "string"
    },
    "channel": {
      "type": "string",
      "enum": [
        "chat",
        "email"
      ]
    }
  },
  "required": [
    "query"
  ]
}
```
