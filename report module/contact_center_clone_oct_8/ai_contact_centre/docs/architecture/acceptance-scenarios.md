# Acceptance Scenarios

Each scenario maps to explicit state transitions. E2E tests in `scripts/e2e/` and `apps/web/e2e/` must cover these.

## Webchat

| ID | Scenario | Initial State | Trigger | Expected End State | Services |
|----|----------|---------------|---------|-------------------|----------|
| W-01 | Bot enabled, grounded reply | (new) | Customer message | `bot_active`, bot reply delivered | chat-service → cc-core → nlp → chat-service |
| W-02 | Bot disabled at start | (new) | Session start | `queued`, no NLP | cc-core policy resolver |
| W-03 | Explicit human request | `bot_active` | "talk to agent" | `queued` → offer → `active` | nlp handoff → cc-core route |
| W-04 | Low confidence | `bot_active` | Ambiguous message | `queued` | nlp threshold → cc-core escalate |
| W-05 | Provider failure | `bot_active` | NLP timeout | `queued` or approved message | chat-service error handling |
| W-06 | No agents available | `queued` | Route attempt | `queued`, waiting message | cc-core routing |
| W-07 | Offer accept | `assigned` | Agent accept | `active` | cc-core accept → workspace |
| W-08 | Offer reject | `assigned` | Agent reject | `queued`, re-route | cc-core reject |
| W-09 | Offer timeout | `assigned` | Timer expiry | `queued`, re-route | offer-lifecycle |
| W-10 | Agent reply | `active` | Agent sends message | `active`, customer receives | cc-core → chat-service WS |
| W-11 | Customer end | `active` | Customer closes widget | `closed` | chat-service → cc-core |
| W-12 | Agent end + disposition | `active` | Agent ends | `resolved`, disposition saved | cc-core → CDP |
| W-13 | Reconnect after restart | `active` | WS reconnect | `active`, transcript restored | cc-core session recovery |
| W-14 | Policy change bot off | `bot_active` | Admin disables bot | `queued` | policy reconciliation |

## Email

| ID | Scenario | Initial State | Trigger | Expected End State | Services |
|----|----------|---------------|---------|-------------------|----------|
| E-01 | Auto-send bot reply | (new) | Inbound email | `bot_active` → outbox → sent | chat-service → nlp → cc-core outbox |
| E-02 | Shadow mode | (new) | Inbound email | NLP turn recorded, no send | email orchestrator shadow |
| E-03 | Grounding failure | `bot_active` | Unanswerable email | `queued` | nlp guard → cc-core |
| E-04 | Bot disabled | (new) | Inbound email | `queued` | policy resolver |
| E-05 | Thread follow-up | `bot_active` | Reply in same thread | `bot_active`, threaded reply | session by thread ID |
| E-06 | New thread same sender | (new) | Different Gmail thread | New conversation | session identity |
| E-07 | Post-close follow-up | `closed` | New inbound | New linked conversation | email session boundaries |
| E-08 | Duplicate Pub/Sub | any | Duplicate event | No duplicate message | email_provider_events dedupe |
| E-09 | Agent reply | `active` | Agent sends | Threaded outbound | outbox → Gmail |
| E-10 | Delivery failure retry | outbox | Transient Gmail error | `retrying` → `sent` | email-delivery worker |

## WhatsApp

| ID | Scenario | Initial State | Trigger | Expected End State | Services |
|----|----------|---------------|---------|-------------------|----------|
| WA-01 | Bot enabled reply | (new) | Inbound text | `bot_active`, Meta outbound | social → cc-core → nlp → Meta |
| WA-02 | Bot disabled | (new) | Inbound text | `queued` | cc-core policy |
| WA-03 | No test auto-reply | (new) | Inbound text | cc-core ingest (never template) | social-service ingest path |
| WA-04 | Explicit human | `bot_active` | "agent please" | `queued` | whatsapp orchestrator |
| WA-05 | Low confidence | `bot_active` | Ambiguous | `queued` | policy threshold |
| WA-06 | Policy change during open | `queued` | Admin enables bot | `bot_active` | social-conversations reconcile |
| WA-07 | Agent reply | `active` | Agent sends | Meta delivery | cc-core → social → Meta |
| WA-08 | Delivery receipt | sent | Meta status webhook | Message status updated | social → cc-core |
| WA-09 | Outside 24h window | `active` | Agent reply | Template required | session window check |
| WA-10 | Inactivity close | `bot_active` | Sweeper timeout | `closed` | session-sweeper |

## Cross-Channel

| ID | Scenario | Expected |
|----|----------|----------|
| X-01 | Same customer webchat + email | Single CDP contact, separate conversations |
| X-02 | Tenant isolation | Tenant A cannot read Tenant B memory/policy |
| X-03 | Interaction history | Agent sees prior channel interactions in customer panel |
| X-04 | Duplicate provider event | One message, one NLP turn, one outbound |
