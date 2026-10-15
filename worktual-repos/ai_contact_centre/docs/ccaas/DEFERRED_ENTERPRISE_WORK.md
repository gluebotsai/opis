# Deferred Enterprise Contact-Center Work

This document tracks provider- and platform-level work beyond the guarded email/webchat
automation foundation. Runtime mailbox policy, queue profiles, guarded email NLP, durable
provider dedup, RFC threading, delivery outbox, channel capacity, SLA timestamps, and removal
of customer-facing dummy responses are implemented.

## Shared routing and reliability

- Replace in-process offer-expiration timers with a durable worker and restart recovery.
- Add transactional outbox and Kafka publication for conversation, assignment, and delivery events.
- Add managed alert rules, queue-depth dashboards, and cross-region disaster-recovery drills.
- Move all channel events to the shared transactional event outbox once Kafka is provisioned.

## Email

- Add Microsoft Graph and SMTP/IMAP adapters behind the same canonical conversation API.
- Connect the pending attachment scan state to the production object store, malware scanner,
  quarantine release, inline-image rewriting, and retention lifecycle.
- Add provider webhook ingestion for Gmail bounces/complaints and automated suppression lists.
- Add CC/BCC/reply-all administration UI after legal/privacy policy is approved.
- Link senders to CDP contacts using tenant-scoped identity resolution.

## Webchat

- Add durable reconnect/session recovery, event replay, and configurable disconnect grace periods.
- Complete transfer routing, Transferred inbox semantics, mandatory disposition, and final closure.
- Add typing indicators, monotonic read receipts, internal notes, and attachment scanning/delivery.
- Add the operator dashboard for NLP shadow comparisons and canary promotion approvals.
- Add automatic internal suggestions after inbound messages while an agent is connected.

## SLA, workforce, and supervision

- Add live monitoring, reports, supervisor requeue/reassign controls, and recovery for stuck work.
- Add holiday calendars and multi-timezone exception schedules to business-hours eligibility.
- Derive performance and CDP metrics from committed lifecycle events through an idempotent projection.

## Security and governance

- Persist audit events rather than relying on application logs alone.
- Add retention/deletion policies, PII-safe logging, rate limits, and provider secret rotation.
- Add attachment malware scanning, content restrictions, and object-level authorization.
- Automate provider-secret rotation and deletion/export workflows for regional privacy regimes.
