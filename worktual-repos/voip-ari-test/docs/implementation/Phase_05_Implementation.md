# Phase 5 Implementation Summary: REST API Gateway & Authentication

## Overview
Phase 5 implemented the public API Gateway (`apps/api`) providing multi-tenant security (`X-API-Key` guard), RESTful call control, agent management, and call queue management with Swagger OpenAPI auto-documentation.

---

## 1. Directory Structure Implemented
```text
apps/api/
├── package.json
├── tsconfig.json
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── auth/
│   │   └── guards/
│   │       └── api-key.guard.ts
│   ├── calls/
│   │   └── calls.controller.ts
│   ├── agents/
│   │   └── agents.controller.ts
│   └── queues/
│       └── queues.controller.ts
```

---

## 2. API Controllers & Security Implemented

### A. Authentication Guard (`api-key.guard.ts`)
- Validates the `X-API-Key` HTTP header against the `Tenant` table in PostgreSQL.
- Attaches authenticated `tenant` entity to incoming requests.

### B. Calls Controller (`calls.controller.ts`)
- `POST /api/v1/calls`: Creates `CallHistory` record and dispatches `ORIGINATE` command over Redis Pub/Sub.
- `POST /api/v1/calls/:id/hangup`: Dispatches `HANGUP` command.
- `POST /api/v1/calls/:id/hold`: Dispatches `HOLD` command (MOH).
- `POST /api/v1/calls/:id/resume`: Dispatches `RESUME` command.
- `POST /api/v1/calls/:id/transfer`: Initiates Blind/Attended channel transfer.

### C. Agents Controller (`agents.controller.ts`)
- `GET /api/v1/agents`: Lists all agents for tenant.
- `POST /api/v1/agents`: Creates a new agent and optional SIP extension.
- `PUT /api/v1/agents/:id/status`: Updates agent status (`AVAILABLE`, `BUSY`, `ON_BREAK`, `OFFLINE`).

### D. Queues Controller (`queues.controller.ts`)
- `GET /api/v1/queues`: Lists queues and assigned members.
- `POST /api/v1/queues`: Creates call queue with ACD routing strategy (`ringall`, `random`).
- `POST /api/v1/queues/:id/members`: Assigns agent to queue with penalty weighting.

### E. Swagger OpenAPI UI (`main.ts`)
- Runs on port `3000`.
- Interactive Swagger documentation at `http://localhost:3000/api/docs`.
