# Webchat WebSocket Events

Contract for the customer-facing webchat widget. All frames are **JSON text** sent over the WebSocket connection.

**Base URL (dev):** `ws://localhost:3002/ws/webchat`  
**Join key:** `webchatId` (`wc_` + 32 hex chars) + `visitorId`

---

## Quick reference

| Direction | `type` | Purpose |
|-----------|--------|---------|
| → Server | `presence.bind` | Register visitor socket before chat opens |
| → Server | `session.start` | Open chat session |
| → Server | `message` | Customer sends text/attachments |
| → Server | `session.end` | Customer ends chat |
| → Server | `typing.started` / `typing.stopped` | Customer typing |
| → Server | `receipt.delivered` / `receipt.read` | Delivery ack |
| ← Client | `presence.bound` | Socket registered for proactive triggers |
| ← Client | `widget.popup` | Open launcher/panel (timer or API trigger) |
| ← Client | `session.ready` | Session accepted |
| ← Client | `message` | Bot / agent / system chat bubble |
| ← Client | `lifecycle` | Structured status events (banner, divider, state) |
| ← Client | `typing.started` / `typing.stopped` | Agent typing |
| ← Client | `receipt.sent` / `receipt.delivered` / `receipt.read` | Message receipts |
| ← Client | `session.ended` | Chat closed |
| ← Client | `system` | Protocol errors only (not business events) |

**Widget rule:** Use `lifecycle.event` for UI state. Use `message` for chat transcript bubbles. Do not parse free-text `message.text` to detect busy/connected/disconnected.

---

## Shared fields

### Lifecycle envelope (new)

All `type: "lifecycle"` frames share this shape:

```json
{
  "type": "lifecycle",
  "event": "handoff.connected",
  "conversationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "occurredAt": "2026-08-01T15:30:00.000Z",
  "lifecycleState": "connected",
  "actor": "system",
  "reason": "agent_accepted",
  "message": "You are now connected to a live agent.",
  "messageId": "f9e8d7c6-b5a4-3210-fedc-ba9876543210",
  "metadata": {}
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"lifecycle"` | Frame discriminator |
| `event` | string | Stable event key — use this in widget logic |
| `conversationId` | uuid | Conversation id |
| `webchatId` | string | Widget id (`wc_…`) |
| `visitorId` | string | Visitor session id |
| `occurredAt` | ISO-8601 | When the event happened |
| `lifecycleState` | enum | `bot` \| `waiting` \| `offered` \| `connected` \| `ended` |
| `actor` | enum | Who caused it: `customer` \| `agent` \| `bot` \| `system` |
| `reason` | string? | Machine reason code (see each event) |
| `message` | string? | Human-readable copy for banners/dividers |
| `messageId` | uuid? | Present when the same text is also in the transcript |
| `metadata` | object? | Event-specific extra fields |

### Message frame (chat bubble)

```json
{
  "type": "message",
  "from": "bot",
  "text": "Hello! How can I help you today?",
  "messageId": "f9e8d7c6-b5a4-3210-fedc-ba9876543210",
  "attachments": [],
  "stub": false
}
```

| `from` | Meaning |
|--------|---------|
| `user` | Customer message (echo on resume) |
| `bot` | AI assistant |
| `agent` | Live agent |
| `system` | System notice (busy, hold, etc.) |

---

## Client → server events

### `presence.bind`

Register the socket for proactive popup / bot triggers before the visitor opens chat. Alternatively, pass `webchatId` and `visitorId` on the WebSocket URL query string on connect.

```json
{
  "type": "presence.bind",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6"
}
```

Server replies with `presence.bound` using the same ids.

### `session.start`

Start or resume a chat session.

```json
{
  "type": "session.start",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "pageUrl": "https://example.com/pricing",
  "consent": { "accepted": true },
  "prechatAnswers": {
    "field_email": "customer@example.com",
    "field_first_name": "Priya"
  }
}
```

### `message`

```json
{
  "type": "message",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "text": "I need to talk to a live agent"
}
```

### `session.end`

```json
{
  "type": "session.end",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "reason": "customer_ended"
}
```

### `typing.started` / `typing.stopped`

```json
{
  "type": "typing.started",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6"
}
```

### `receipt.delivered` / `receipt.read`

```json
{
  "type": "receipt.read",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "messageId": "f9e8d7c6-b5a4-3210-fedc-ba9876543210",
  "occurredAt": "2026-08-01T15:31:00.000Z"
}
```

---

## Server → client events

### `presence.bound`

Acknowledges `presence.bind` (or query-param connect). No UI change required.

```json
{
  "type": "presence.bound",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6"
}
```

### `widget.popup`

Proactive engagement — from a client timer or from `POST …/trigger-bot`. Open the launcher bubble or full panel; optionally auto-start the bot session when `autoSessionStart` is true.

```json
{
  "type": "widget.popup",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "openMode": "panel",
  "autoSessionStart": true,
  "text": "Need help choosing a plan?",
  "reason": "api_trigger"
}
```

| Field | Values | Notes |
|-------|--------|-------|
| `openMode` | `bubble` \| `panel` | `panel` opens the chat UI |
| `autoSessionStart` | boolean | When true, server also sends `session.ready` + bot greeting |
| `text` | string? | Proactive copy (bubble teaser and/or first bot line) |
| `reason` | string? | e.g. `api_trigger`, `tracker` |

**Widget:** If chat is already open, ignore. Otherwise open UI per `openMode`. When `autoSessionStart` is false, wait for the visitor to click before sending `session.start`.

### 1. `session.ready`

Session accepted. New sessions may have no history; resumed sessions include `messages`.

```json
{
  "type": "session.ready",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "conversationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "resumed": true,
  "messages": [
    {
      "from": "bot",
      "text": "Hello! How can I help you today?",
      "at": "2026-08-01T15:28:00.000Z"
    },
    {
      "from": "user",
      "text": "connect to live agent",
      "at": "2026-08-01T15:28:30.000Z"
    }
  ],
  "stub": false
}
```

**Widget:** Enable composer. If `resumed: true`, render `messages` in the thread.

**Lifecycle mirror (optional):**

```json
{
  "type": "lifecycle",
  "event": "session.ready",
  "conversationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "occurredAt": "2026-08-01T15:28:00.000Z",
  "lifecycleState": "bot",
  "actor": "system",
  "reason": "session_started",
  "metadata": { "resumed": false }
}
```

---

### 2. Bot / agent / user `message`

Regular chat bubbles. Render in the message list.

**Bot reply:**

```json
{
  "type": "message",
  "from": "bot",
  "text": "I can help with branch locations. We have offices in Chennai and Madurai.",
  "messageId": "11111111-1111-1111-1111-111111111111"
}
```

**Agent reply:**

```json
{
  "type": "message",
  "from": "agent",
  "agent_name": "Bharathi Sivakumar",
  "text": "Hi, I'm here to help you with your request.",
  "messageId": "22222222-2222-2222-2222-222222222222"
}
```

`agent_name` is present only when `from` is `"agent"`. It is the live agent's display name, resolved from `ccass.agents.id`.

**System notice (also in transcript):**

```json
{
  "type": "message",
  "from": "system",
  "text": "All our live agents are currently busy. Please continue chatting with our AI assistant or try again later.",
  "messageId": "33333333-3333-3333-3333-333333333333"
}
```

---

### 3. `handoff.requested`

Customer or bot requested a live agent.

```json
{
  "type": "lifecycle",
  "event": "handoff.requested",
  "conversationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "occurredAt": "2026-08-01T15:29:00.000Z",
  "lifecycleState": "waiting",
  "actor": "customer",
  "reason": "explicit_request",
  "metadata": {
    "queueId": "81019f3d-826b-498f-8273-18abe4df6dba",
    "handoffReason": "explicit_request"
  }
}
```

| `reason` | When |
|----------|------|
| `explicit_request` | Customer asked for live agent |
| `low_confidence` | Bot confidence below threshold |
| `repeated_bot_failure` | Bot failed multiple turns |
| `policy_threshold` | Channel policy triggered handoff |
| `provider_unavailable` | NLP provider failed |

**Widget:** Show “Connecting you to an agent…” state. Disable bot-only UI if needed.

---

### 4. `handoff.queued`

Conversation entered the queue. Waiting for an available agent.

```json
{
  "type": "lifecycle",
  "event": "handoff.queued",
  "conversationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "occurredAt": "2026-08-01T15:29:05.000Z",
  "lifecycleState": "waiting",
  "actor": "system",
  "reason": "queued_for_agent",
  "message": "Please hold while we connect you to a live agent.",
  "messageId": "44444444-4444-4444-4444-444444444444",
  "metadata": {
    "queueId": "81019f3d-826b-498f-8273-18abe4df6dba",
    "queueLabel": "Support queue",
    "handoffReason": "explicit_request"
  }
}
```

Often followed by a transcript bubble:

```json
{
  "type": "message",
  "from": "system",
  "text": "Please hold while we connect you to a live agent.",
  "messageId": "44444444-4444-4444-4444-444444444444"
}
```

**Widget:** Show queue/waiting banner. Copy comes from tenant config `handoffMessage`.

---

### 5. `handoff.offered`

Offer sent to an agent (internal routing step). Usually not shown to customer; optional subtle “finding an agent” state.

```json
{
  "type": "lifecycle",
  "event": "handoff.offered",
  "conversationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "occurredAt": "2026-08-01T15:29:10.000Z",
  "lifecycleState": "offered",
  "actor": "system",
  "reason": "agent_offer_created",
  "metadata": {
    "queueId": "81019f3d-826b-498f-8273-18abe4df6dba",
    "offerTimeoutSeconds": 30
  }
}
```

**Widget:** Keep waiting state. Do not expose agent identity.

---

### 6. `handoff.connected`

Agent accepted the chat. **Show “LIVE AGENT CONNECTED” divider.**

```json
{
  "type": "lifecycle",
  "event": "handoff.connected",
  "conversationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "occurredAt": "2026-08-01T15:29:45.000Z",
  "lifecycleState": "connected",
  "actor": "agent",
  "reason": "agent_accepted",
  "message": "You are now connected to a live agent.",
  "metadata": {
    "queueId": "81019f3d-826b-498f-8273-18abe4df6dba",
    "agentDisplayName": "Agent"
  }
}
```

**Widget:** Render centered divider/banner with `message` or default “Live agent connected”. Switch to live-agent mode.

---

### 7. `handoff.busy`

No agent available. Falls back to bot.

```json
{
  "type": "lifecycle",
  "event": "handoff.busy",
  "conversationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "occurredAt": "2026-08-01T15:29:15.000Z",
  "lifecycleState": "bot",
  "actor": "system",
  "reason": "no_agents_available",
  "message": "All our live agents are currently busy. Please continue chatting with our AI assistant or try again later.",
  "messageId": "55555555-5555-5555-5555-555555555555",
  "metadata": {
    "queueId": "81019f3d-826b-498f-8273-18abe4df6dba",
    "handoffReason": "explicit_request",
    "resumedBot": true
  }
}
```

| `reason` | When |
|----------|------|
| `no_agents_available` | Queue empty / all agents busy |
| `agent_rejected` | Offered agent declined |
| `offer_expired` | Agent did not accept in time |
| `routing_failed` | Routing error |

Plus transcript bubble (`from: "system"`). Copy from tenant config `queueBusyMessage`.

**Widget:** Warning banner. Re-enable bot chat.

---

### 8. `handoff.resumed_bot`

Returned to bot after failed handoff (without busy message already sent).

```json
{
  "type": "lifecycle",
  "event": "handoff.resumed_bot",
  "conversationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "occurredAt": "2026-08-01T15:29:20.000Z",
  "lifecycleState": "bot",
  "actor": "system",
  "reason": "routing_unavailable",
  "metadata": {
    "previousState": "waiting",
    "handoffReason": "explicit_request"
  }
}
```

**Widget:** Clear waiting banner. Bot mode active.

---

### 9. `handoff.transferred`

Chat moved to another queue or agent.

```json
{
  "type": "lifecycle",
  "event": "handoff.transferred",
  "conversationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "occurredAt": "2026-08-01T15:35:00.000Z",
  "lifecycleState": "waiting",
  "actor": "agent",
  "reason": "queue_transfer",
  "message": "Your chat is being transferred to another team.",
  "metadata": {
    "fromQueueId": "81019f3d-826b-498f-8273-18abe4df6dba",
    "toQueueId": "99999999-9999-9999-9999-999999999999"
  }
}
```

**Widget:** “Transferring…” banner. Wait for next `handoff.connected`.

---

### 10. `agent.typing.started` / `agent.typing.stopped`

**Simple frame (today):**

```json
{ "type": "typing.started", "from": "agent" }
```

```json
{ "type": "typing.stopped", "from": "agent" }
```

**Lifecycle mirror (optional):**

```json
{
  "type": "lifecycle",
  "event": "agent.typing.started",
  "conversationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "occurredAt": "2026-08-01T15:30:10.000Z",
  "lifecycleState": "connected",
  "actor": "agent"
}
```

**Widget:** Show/hide “Agent is typing…” indicator.

---

### 11. `agent.disconnected`

Agent left before the customer ended the chat.

```json
{
  "type": "lifecycle",
  "event": "agent.disconnected",
  "conversationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "occurredAt": "2026-08-01T15:40:00.000Z",
  "lifecycleState": "waiting",
  "actor": "agent",
  "reason": "agent_left",
  "message": "The agent has left the chat. We are finding someone else to help you.",
  "metadata": {
    "nextAction": "requeue"
  }
}
```

| `reason` | When |
|----------|------|
| `agent_left` | Agent ended without closing session |
| `agent_transferred` | Handed off elsewhere |
| `offer_expired` | Pending offer timed out |
| `session_timeout` | Inactivity timeout |

**Widget:** Status banner. May be followed by `handoff.queued` or `handoff.busy`.

---

### 12. `session.ended`

Chat closed. Disable composer.

```json
{
  "type": "session.ended",
  "reason": "agent_closed"
}
```

**Lifecycle mirror:**

```json
{
  "type": "lifecycle",
  "event": "session.ended",
  "conversationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "occurredAt": "2026-08-01T15:45:00.000Z",
  "lifecycleState": "ended",
  "actor": "agent",
  "reason": "agent_closed",
  "message": "This conversation is closed.",
  "metadata": {
    "endActor": "agent",
    "dispositionCode": "resolved"
  }
}
```

| `endActor` | Example `reason` |
|------------|------------------|
| `customer` | `customer_ended`, `customer_left` |
| `agent` | `agent_closed`, `resolved` |
| `session` | `session_expired`, `inactivity_timeout`, `visitor_disconnected` |
| `system` | `policy_close`, `bot_resolved_inactivity` |

**Widget:** Show closed state footer. Disable input.

---

### 13. `visitor.disconnected`

WebSocket dropped (tab closed, network loss). Customer did not explicitly end.

```json
{
  "type": "lifecycle",
  "event": "visitor.disconnected",
  "conversationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "webchatId": "wc_5d80cd9b1ace4080bc70717552472611",
  "visitorId": "gzezerbx8kcms3il9m6",
  "occurredAt": "2026-08-01T15:46:00.000Z",
  "lifecycleState": "ended",
  "actor": "customer",
  "reason": "visitor_disconnected",
  "metadata": {
    "gracePeriodSeconds": 120
  }
}
```

**Widget:** On reconnect, send `session.start` again; server may resume with `session.ready` + history.

---

### 14. Receipts

**Sent (server ack after customer message):**

```json
{
  "type": "receipt.sent",
  "messageId": "66666666-6666-6666-6666-666666666666",
  "occurredAt": "2026-08-01T15:30:05.000Z"
}
```

**Delivered / read (agent side reflected back):**

```json
{
  "type": "receipt.delivered",
  "messageId": "22222222-2222-2222-2222-222222222222",
  "occurredAt": "2026-08-01T15:30:12.000Z"
}
```

**Widget:** Update tick marks on outgoing customer messages.

---

### 15. `system` (errors only)

Protocol/validation errors. **Not** for business events like busy or connected.

```json
{
  "type": "system",
  "text": "Session not started. Send session.start first."
}
```

---

## Typical flow (live agent handoff)

```text
1. session.start
2. session.ready                    (lifecycleState: bot)
3. message (user)                   "connect to live agent"
4. message (bot)                    bot reply
5. lifecycle handoff.requested      reason: explicit_request
6. lifecycle handoff.queued         + message (system) hold copy
7. lifecycle handoff.offered        (optional, internal)
8. lifecycle handoff.connected      LIVE AGENT CONNECTED divider
9. message (agent)                  first agent reply
10. typing.started / typing.stopped
11. message (agent/customer)        conversation continues
12. lifecycle session.ended         + session.ended
```

**Busy path:**

```text
5. lifecycle handoff.requested
6. lifecycle handoff.busy           + message (system) busy copy
7. lifecycle handoff.resumed_bot
8. message (bot)                    bot continues
```

---

## Widget implementation checklist

```ts
switch (frame.type) {
  case "session.ready":
    enableComposer();
    if (frame.resumed) renderHistory(frame.messages);
    break;

  case "message":
    appendBubble(frame.from, frame.text, frame.messageId);
    break;

  case "lifecycle":
    switch (frame.event) {
      case "handoff.queued":
        showBanner("waiting", frame.message);
        break;
      case "handoff.connected":
        showDivider("Live agent connected", frame.message);
        setMode("live_agent");
        break;
      case "handoff.busy":
        showBanner("warning", frame.message);
        setMode("bot");
        break;
      case "agent.disconnected":
        showBanner("info", frame.message);
        break;
      case "session.ended":
        disableComposer();
        showFooter(frame.message ?? "Conversation closed");
        break;
      // ...handle other events
    }
    break;

  case "typing.started":
    showAgentTyping();
    break;

  case "typing.stopped":
    hideAgentTyping();
    break;

  case "session.ended":
    disableComposer();
    break;

  case "system":
    showError(frame.text); // protocol only
    break;
}
```

---

## Tenant copy keys (from webchat config)

| Config key | Used for |
|------------|----------|
| `handoffMessage` | `handoff.queued` / hold message |
| `queueBusyMessage` | `handoff.busy` message |
| `agentHandoffMessage` | Alternate handoff copy |
| `agentBusyMessage` | Alternate busy copy |
| `agentUnavailableMessage` | No agents / OOH |
| `outOfHoursMessage` | Outside business hours |

Server fills `lifecycle.message` and `message.text` from these configs when available.

---

## Event enum (complete list)

```ts
type WebchatLifecycleEvent =
  | "session.ready"
  | "handoff.requested"
  | "handoff.queued"
  | "handoff.offered"
  | "handoff.connected"
  | "handoff.busy"
  | "handoff.resumed_bot"
  | "handoff.transferred"
  | "agent.typing.started"
  | "agent.typing.stopped"
  | "agent.disconnected"
  | "session.ended"
  | "visitor.disconnected";
```

---

## Notes

- **Backward compatible:** Existing widgets can ignore `lifecycle` and still work with `message` + `session.ended`.
- **Prefer `lifecycle.event`** for banners, dividers, and composer enable/disable.
- **`message` frames** remain the source of truth for chat history/transcript.
- **Do not** use `type: "system"` for busy/connected/disconnected — use `lifecycle` instead.
