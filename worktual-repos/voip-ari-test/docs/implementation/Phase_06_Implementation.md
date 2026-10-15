# Phase 6 Implementation Summary: Real-Time Events & Webhooks

## Overview
Phase 6 implemented the real-time event distribution pipeline delivering live WebSocket event streams (`ws://localhost:3000/events`) and HTTP Webhook dispatches with HMAC SHA256 signatures.

---

## 1. Components Implemented

### A. WebSocket Events Gateway (`apps/api/src/events/events.gateway.ts`)
- Socket.io namespace `/events`.
- Tenant isolation: Clients automatically join room `tenant:${tenantId}` based on connection parameters.
- Subscribes to Redis topic `telephony.events.asterisk` and live-broadcasts events to room members:
  - `call.started`: Emitted when call channel enters Stasis app.
  - `call.ringing`: Emitted when destination extension is ringing.
  - `call.answered`: Emitted when call is answered.
  - `call.ended`: Emitted when call hangs up.

### B. Webhook Service (`services/webhook-service`)
- **Port**: `3005`
- **Modules**:
  - `WebhookDispatcherService` (`src/services/webhook.dispatcher.ts`):
    - Listens to Asterisk event stream from Redis.
    - Queries active tenant webhooks from PostgreSQL database.
    - Computes HMAC SHA256 payload signature using `Webhook.secret`.
    - Dispatches HTTP POST requests with headers:
      - `Content-Type: application/json`
      - `X-Telephony-Signature: sha256=<hmac_hash>`
      - `X-Telephony-Event: <event_name>`
  - `WebhookController` (`src/controllers/webhook.controller.ts`):
    - `GET /webhooks`
    - `POST /webhooks` (Register tenant webhook URL & secret)
