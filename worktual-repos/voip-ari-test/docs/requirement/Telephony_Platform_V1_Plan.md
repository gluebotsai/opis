# Telephony Platform V1 -- Development Plan

## Goal

Build a reusable multi-tenant telephony platform that exposes REST APIs,
WebSockets, Webhooks, and SDKs for CRM, Contact Center, and future
products.

------------------------------------------------------------------------

# Phase 1 -- Foundation

-   [ ] Create monorepo structure
-   [ ] Configure Docker Compose
-   [ ] PostgreSQL
-   [ ] Redis
-   [ ] API Gateway
-   [ ] Authentication (JWT/API Keys)
-   [ ] Multi-tenant support
-   [ ] Environment configuration
-   [ ] Logging
-   [ ] Health endpoints

Deliverable: - Platform skeleton running locally.

------------------------------------------------------------------------

# Phase 2 -- Database

## Tables

-   [ ] tenants
-   [ ] users
-   [ ] agents
-   [ ] sip_extensions
-   [ ] phone_numbers
-   [ ] queues
-   [ ] queue_members
-   [ ] active_calls
-   [ ] call_history
-   [ ] recordings
-   [ ] webhooks
-   [ ] audit_logs

Deliverable: - Initial migrations and seed data.

------------------------------------------------------------------------

# Phase 3 -- Asterisk Integration

-   [ ] Install Asterisk
-   [ ] Configure PJSIP
-   [ ] Create extensions (1001,1002)
-   [ ] Enable ARI
-   [ ] Enable AMI
-   [ ] Test Linphone registration
-   [ ] Test extension-to-extension calls
-   [ ] Receive ARI events

Deliverable: - Linphone calls through Asterisk.

------------------------------------------------------------------------

# Phase 4 -- Core Services

## Call Service

-   [ ] Originate
-   [ ] Answer
-   [ ] Hangup
-   [ ] Hold
-   [ ] Resume
-   [ ] Mute
-   [ ] Transfer
-   [ ] Conference

## Agent Service

-   [ ] Login
-   [ ] Logout
-   [ ] Presence
-   [ ] Status

## Queue Service

-   [ ] Create queue
-   [ ] Add agents
-   [ ] Routing
-   [ ] Queue metrics

## Number Service

-   [ ] DID management
-   [ ] Caller ID mapping

## Recording Service

-   [ ] Start/Stop recording
-   [ ] Metadata
-   [ ] Storage

Deliverable: - Core telephony APIs.

------------------------------------------------------------------------

# Phase 5 -- APIs

## REST

-   [ ] POST /calls
-   [ ] POST /calls/{id}/hangup
-   [ ] POST /calls/{id}/transfer
-   [ ] POST /calls/{id}/hold
-   [ ] POST /calls/{id}/mute
-   [ ] CRUD for agents
-   [ ] CRUD for queues
-   [ ] CRUD for numbers

Deliverable: - OpenAPI documentation.

------------------------------------------------------------------------

# Phase 6 -- Events

## WebSocket

-   [ ] call.started
-   [ ] call.ringing
-   [ ] call.answered
-   [ ] call.ended
-   [ ] queue.updated
-   [ ] agent.status

## Webhooks

-   [ ] Delivery
-   [ ] Retry
-   [ ] Signature validation

Deliverable: - Real-time event pipeline.

------------------------------------------------------------------------

# Phase 7 -- Admin UI

-   [ ] Dashboard
-   [ ] Tenant management
-   [ ] Agent management
-   [ ] Queue management
-   [ ] Number management
-   [ ] Live calls
-   [ ] Recordings
-   [ ] Settings

Deliverable: - Functional admin portal.

------------------------------------------------------------------------

# Phase 8 -- CRM SDK

-   [ ] JavaScript SDK
-   [ ] Python SDK
-   [ ] Authentication
-   [ ] Event subscriptions

Deliverable: - Simple integration library.

------------------------------------------------------------------------

# Phase 9 -- Testing

-   [ ] Linphone ↔ Linphone
-   [ ] Hold
-   [ ] Transfer
-   [ ] Queue
-   [ ] Recording
-   [ ] API tests
-   [ ] Load testing
-   [ ] Security testing

Deliverable: - Stable V1.

------------------------------------------------------------------------

# Phase 10 -- Production

-   [ ] Airtel SIP trunk
-   [ ] Monitoring
-   [ ] Backups
-   [ ] TLS
-   [ ] CI/CD
-   [ ] Deployment
-   [ ] Documentation

Deliverable: - Production-ready platform.

------------------------------------------------------------------------

# Suggested Repository

``` text
telephony-platform/
├── apps/
│   ├── api
│   ├── admin-ui
│   └── sdk
├── services/
│   ├── call-service
│   ├── agent-service
│   ├── queue-service
│   ├── number-service
│   ├── recording-service
│   └── webhook-service
├── adapters/
│   └── asterisk-adapter
├── shared/
├── database/
├── docker/
└── docs/
```

# Vibe Coding Prompt

Generate production-quality code incrementally. For each phase: 1.
Implement complete backend, frontend, database migrations, tests, and
API documentation. 2. Use clean architecture, SOLID principles,
TypeScript (Node.js) for backend APIs, React for admin UI, PostgreSQL,
Redis, Docker, and OpenAPI. 3. Keep modules independent and reusable. 4.
Do not leave TODOs or placeholders. 5. Ensure each phase is fully
runnable before proceeding to the next.
