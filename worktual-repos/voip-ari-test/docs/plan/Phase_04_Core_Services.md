# Phase 4: Core Microservices Architecture

## 1. Overview
Implement the set of domain microservices responsible for call state management, agent availability, queue distribution, number routing, audio recordings, and webhook dispatches.

```text
                           ┌───────────────────────────────┐
                           │   telephony.events.asterisk   │ (Redis Pub/Sub)
                           └───────────────┬───────────────┘
                                           │
       ┌───────────────────┬───────────────┼───────────────┬───────────────────┐
       ▼                   ▼               ▼               ▼                   ▼
┌──────────────┐   ┌──────────────┐  ┌───────────┐  ┌─────────────┐   ┌─────────────────┐
│ call-service │   │agent-service │  │queue-serv.│  │number-serv. │   │recording-service│
└──────────────┘   └──────────────┘  └───────────┘  └─────────────┘   └─────────────────┘
```

---

## 2. Microservice Detailed Specifications

### 2.1 Call Service (`services/call-service`)
- **Responsibility**: Maintains active call state machine, executes call control commands (Originate, Hangup, Hold, Resume, Transfer, Mute).
- **Call State Machine**:
  ```text
  INITIATED ──► RINGING ──► ANSWERED ──► ON_HOLD ──► TRANSFERRED ──► COMPLETED
      │             │           │
      └──► FAILED   └──► BUSY   └──► NO_ANSWER
  ```
- **Key Methods**:
  - `originate(tenantId, from, to, callerId)`: Issues ARI command to create outbound channel and bridge endpoints.
  - `hangup(callId)`: Issues ARI hangup command.
  - `hold(callId)` / `resume(callId)`: Plays MOH (Music On Hold) on channel.
  - `transfer(callId, target, type)`: Performs Blind or Attended transfer via ARI channel redirect/bridge swap.

### 2.2 Agent Service (`services/agent-service`)
- **Responsibility**: Manages agent session, real-time presence status, and agent assignment.
- **Statuses**: `OFFLINE`, `AVAILABLE`, `BUSY`, `ON_BREAK`, `WRAP_UP`.
- **Sync**: Listens to SIP registration events from `asterisk-adapter` to automatically transition agent status to `AVAILABLE` or `OFFLINE`.

### 2.3 Queue Service (`services/queue-service`)
- **Responsibility**: ACD (Automatic Call Distribution) routing for inbound calls.
- **Routing Algorithms**:
  - `ringall`: Ring all available queue agents simultaneously.
  - `leastrecent`: Route call to the agent who answered a call longest ago.
  - `random`: Randomly pick an available agent.
- **Fallback**: If queue timeout (default 30s) expires without answer, trigger fallback route (voicemail or failover extension).

### 2.4 Number Service (`services/number-service`)
- **Responsibility**: DID (Direct Inward Dialing) lookup table. Matches incoming PSTN number (`+1234567890`) to tenant ID and target route (Queue or Extension).

### 2.5 Recording Service (`services/recording-service`)
- **Responsibility**: Manages audio recording life cycle.
- **Workflow**:
  1. Triggers ARI `recordChannel` / `snoopChannel` upon call answer.
  2. Receives recording completion event when call ends.
  3. Moves audio file from `/var/spool/asterisk/recording` to persistent storage / S3 bucket.
  4. Inserts `Recording` metadata record into database.

### 2.6 Webhook Service (`services/webhook-service`)
- **Responsibility**: Dispatches real-time HTTP POST notifications to tenant webhook endpoints.
- **Architecture**: Powered by **BullMQ** on Redis.
- **Features**:
  - HMAC SHA256 signature calculation using tenant secret (`X-Telephony-Signature`).
  - Exponential backoff retry strategy (5 attempts: 5s, 15s, 1m, 5m, 15m).

---

## 3. Implementation Steps
1. Scaffold each service in `services/*` using NestJS.
2. Share database models via `@telephony/shared`.
3. Connect services to Redis Pub/Sub to listen to `telephony.events.asterisk`.

---

## 4. Verification Steps
1. Start `call-service` and send an originate event via Redis.
2. Confirm channel creation and verify state progression from `INITIATED` to `ANSWERED` in database `CallHistory` table.
