# Hybrid Onboarding Build Guide

This guide describes how to build the recommended approach:

**Manual-assisted onboarding on top of a standardized API/webhook foundation.**

---

## 1) Goal

Ship fast for early customers, while avoiding one-off integrations that cannot scale.

- Early stage: your team helps each customer onboard.
- Technical base: one canonical intake API and one canonical webhook schema.
- Growth stage: convert repeated manual tasks into self-serve setup screens.

---

## 2) Product model

Use one data model for both B2B and B2C:

- `organization` = paying tenant
- `account` (optional) = tenant's client/company segment
- `requester` = person who raises ticket
- `ticket` = normalized support record

Keep all integration inputs mapped into the same ticket creation flow.

---

## 3) Canonical intake API (single source of truth)

Create one API endpoint that every channel calls:

- `POST /api/intake/tickets`

Required fields:

- `organizationId`
- `channel` (`email`, `web_form`, `chat`, `api`)
- `requester` (`name`, one of `email` or `phone`)
- `subject`
- `description`

Optional fields:

- `accountId`
- `priority`
- `category`
- `attachments`
- `externalRef` (upstream system reference)
- `metadata` (arbitrary key-values)

Example payload:

```json
{
  "organizationId": "org_tech_solutions",
  "accountId": "acct_client_a",
  "channel": "web_form",
  "requester": {
    "name": "Riya Sharma",
    "email": "riya@clienta.com",
    "phone": "+919876543210"
  },
  "subject": "VPN not connecting",
  "description": "Unable to connect since morning",
  "priority": "High",
  "externalRef": "crm_case_98213",
  "metadata": {
    "sourcePage": "/support",
    "region": "IN"
  }
}
```

API response:

- returns `ticketId`, `ticketNumber`, current `status`, and timestamps

---

## 4) Channel adapters (manual-assisted first)

Each customer channel integration is an adapter that maps channel-specific payloads into the canonical intake API.

### A) Email adapter

- Inbound mailbox/webhook receives email
- Parse sender, subject, body, attachments
- Resolve requester/account
- Call `POST /api/intake/tickets`
- Use message/thread IDs for reply-to-ticket linking

### B) Web form adapter

- Customer website form posts to their backend
- Backend calls intake API with API key/JWT
- Apply captcha/rate-limit before calling your API

### C) Chat/WhatsApp adapter

- Provider webhook receives user message
- Map sender identity + text/media
- Create ticket or append to existing one
- Send confirmation message with ticket number

---

## 5) Canonical webhook events (outbound)

Expose a single event contract for customer systems:

- `ticket.created`
- `ticket.updated`
- `ticket.assigned`
- `ticket.status_changed`
- `ticket.resolved`
- `ticket.sla_breached`

Event envelope:

```json
{
  "eventId": "evt_01J...",
  "eventType": "ticket.created",
  "occurredAt": "2026-07-29T09:30:00Z",
  "organizationId": "org_tech_solutions",
  "accountId": "acct_client_a",
  "ticketId": "tkt_123",
  "ticketNumber": "TS-1042",
  "data": {
    "status": "Open",
    "priority": "High",
    "assignee": "Unassigned"
  }
}
```

Delivery requirements:

- HMAC signature header
- Retry with exponential backoff
- Idempotency key support
- Dead-letter/logging for repeated failures

---

## 6) Manual-assisted onboarding runbook

Use this checklist per new customer:

1. Create `organization`
2. Configure default queues and skills
3. Add staff users (admin/agent/resolver)
4. Configure intake channels:
   - support email forward/webhook
   - web form API credentials
   - optional chat connector
5. Configure outbound webhooks endpoint + secret
6. Map fields (`priority`, `category`, `account`)
7. Run UAT test cases
8. Go live and monitor first week

Target SLA for onboarding:

- Basic onboarding (email + web form): 1-3 days
- Advanced onboarding (chat + CRM sync): 3-7 days

---

## 7) Security and isolation

Mandatory controls:

- Enforce `organizationId` scoping on every read/write
- Validate all webhook signatures
- Store secrets encrypted at rest
- Rate-limit intake APIs
- Audit log for role/assignment/status changes
- PII-safe logging (mask emails/phones in diagnostics)

---

## 8) Phase roadmap (how this becomes self-serve)

### Phase 1: Assisted (now)

- Manual setup by your team
- Reusable API + webhook contracts
- Internal onboarding checklist

### Phase 2: Guided setup

- Admin UI wizard:
  - connect email
  - generate/rotate API keys
  - webhook test sender
  - field mapping UI

### Phase 3: Connector templates

- Prebuilt integration templates (common CMS/CRM/chat)
- One-click setup for frequent stacks

### Phase 4: Marketplace

- Public integration catalog
- Customer-managed installs and monitoring

---

## 9) Success metrics

Track these from day one:

- Time to first ticket (TTFT) per tenant
- Onboarding completion time
- Ticket creation success rate by channel
- Webhook delivery success/failure rate
- Duplicate ticket rate
- First response and resolution SLA adherence

---

## 10) Definition of done (MVP)

MVP is complete when:

- ~~One canonical intake API is live~~ **Done** — `POST /api/intake/tickets` + org API keys (`docs/intake-api.md`)
- ~~Email and web form adapters are production-ready~~ **Done (MVP)** — Help widget + `POST /api/intake/email` (threading via Message-ID / `#ticket`)
- ~~Outbound customer email~~ **Done (MVP)** — create / public reply / resolve (`MAIL_MODE=log|smtp`) — see `docs/INTEGRATIONS_README.md`
- ~~Automation / triggers~~ **Done (MVP)** — Express `automation_rules` after create/update — see `docs/INTEGRATIONS_README.md` §10
- Standard webhook events are available and signed
- Onboarding checklist is repeatable
- First 3-5 customers are onboarded without custom backend rewrites

---

## One-line strategy

**Start with manual-assisted onboarding, but force all integrations through one standard intake API and one standard webhook contract.**
