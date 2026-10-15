# Golden path: Webchat → Agent

**Status:** Phase 0 spike (not yet implemented)

Widget contract and WebSocket frames: [docs/chatservice/](../chatservice/README.md).

## Flow

1. Customer sends message via webchat widget → `chat-service` (`/ws/webchat` WebSocket)
2. `chat-service` publishes `cc.message.received` to Kafka
3. `cc-core` ingest consumer creates/updates conversation + outbox event
4. Outbox publisher emits `cc.conversation.message.created`
5. Realtime bridge pushes to agent browser via Socket.IO

## Success criteria

- [ ] End-to-end message visible in agent workspace within 2s (dev)
- [ ] Trace ID propagated across HTTP + Kafka
- [ ] Failed messages land in DLQ with alert hook

See [AI_CONTACT_CENTER_PLAN.md](../AI_CONTACT_CENTER_PLAN.md) for architecture details.
