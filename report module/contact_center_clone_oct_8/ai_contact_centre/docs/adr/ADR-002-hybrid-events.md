# ADR-002: Hybrid event architecture

**Status:** Accepted

Use transactional outbox + Kafka for domain events, Debezium CDC for platform schema changes, and Kafka consumers for Redis cache + Socket.IO push.
