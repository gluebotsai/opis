# Telephony Platform Implementation Plan

This plan outlines the architecture and phased implementation for building an independent, reusable, multi-tenant Telephony Platform. This platform will act as an abstraction layer (CPaaS) over an Asterisk PBX, exposing REST APIs, WebSockets, and Webhooks to downstream products like CRMs and Contact Centers.

## Technology Stack Decisions
- **Backend**: Node.js with NestJS
- **Database**: PostgreSQL
- **ARI Client**: Node.js `ari-client` library

## Proposed Changes

We will approach this in iterative phases, starting with a robust local development setup.

### Phase 1: Local Development & Infrastructure Setup

This phase focuses on getting the core infrastructure running locally using Docker without a real SIP provider.

#### [NEW] docker-compose.yml
- Define an `asterisk` service using a standard Asterisk image.
- Define a `db` service (PostgreSQL).
- Define an `api` service for the Telephony Platform backend.

#### [NEW] asterisk/config/
- Basic `pjsip.conf` for SIP extensions (e.g., for Linphone).
- Basic `extensions.conf` to route calls to Stasis (ARI).
- Basic `ari.conf` and `manager.conf` to allow the backend to connect.

### Phase 2: Core Platform Backend Scaffold

This phase sets up the core backend server.

#### [NEW] platform-backend/
- Initialize the NestJS project.
- **Database Schema**: Implement TypeORM/Prisma migrations for `tenants`, `agents`, `sip_extensions`, `numbers`, `queues`, `calls`, `call_history`.
- **ARI/AMI Client**: Connect to Asterisk via ARI for call control and AMI for lower-level events.

### Phase 3: APIs and WebSockets

This phase implements the abstraction layer.

#### [NEW] platform-backend/src/api/
- **REST APIs**: Implement endpoints for `POST /calls`, `POST /calls/:id/hangup`, `POST /calls/:id/hold`, `POST /calls/:id/transfer`, `POST /calls/:id/mute`.
- **WebSocket Server**: Implement a pub/sub system to emit `call.started`, `call.ringing`, `call.answered`, `call.ended`, `agent.online`, `queue.updated` to connected clients (like a CRM).
- **Webhook Dispatcher**: Implement a worker that sends HTTP POST requests to configured tenant webhook URLs for major call lifecycle events.

### Phase 4: Basic Call Control Implementation

This phase implements the business logic bridging the REST APIs to Asterisk ARI.

#### [NEW] platform-backend/src/telephony/
- **Originate**: Use ARI to spawn a channel to a SIP extension, and upon answer, bridge to the destination.
- **State Machine**: Track call states in memory/DB and broadcast changes to WebSockets/Webhooks.
- **Recording**: Trigger ARI recording and manage the resulting files.

## Verification Plan

### Automated Tests
- We will write unit tests for the NestJS backend's API handlers and state machines.
- We can use an ARI mock or a testing framework to simulate Asterisk events.

### Manual Verification
1. **Local Setup**: Run `docker-compose up`.
2. **SIP Client Registration**: Register two softphones (e.g., Linphone) against the local Asterisk using credentials from the database.
3. **API Call**: Send a `POST /calls` to the Telephony Platform to originate a call between the two softphones.
4. **WebSocket Observation**: Connect a test script to the WebSocket server and observe `call.ringing` and `call.answered` events as the softphones interact.
5. **Database Check**: Verify that `call_history` and `calls` tables are updated correctly after hanging up.
