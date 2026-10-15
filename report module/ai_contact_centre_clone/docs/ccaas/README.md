# CCaaS documentation

Contact-center platform service documentation.

| Document | Description |
|----------|-------------|
| [CONTACT_CENTER_SCHEMA.md](./CONTACT_CENTER_SCHEMA.md) | **Schema documentation** — `accounts` setup, `ccass` runtime, and `cdp` customer tables, columns, types, keys, and relationships |
| [WHATSAPP_SOCIAL_SERVICE.md](./WHATSAPP_SOCIAL_SERVICE.md) | WhatsApp adapter APIs, webhooks, template approval, and configuration |
| [INSTAGRAM_FACEBOOK_SOCIAL_SERVICE.md](./INSTAGRAM_FACEBOOK_SOCIAL_SERVICE.md) | Instagram + Facebook Messenger webhooks, send APIs, credentials, routing |
| [INTERNAL_CHAT.md](./INTERNAL_CHAT.md) | Internal team chat for admin and agent — rooms, APIs, realtime, and permissions |
| [ORG_ROUTING_RECORDING.md](./ORG_ROUTING_RECORDING.md) | Org-level routing profile and recording tables, columns, keys, and relationships |
| [ACCOUNTS_ONBOARDING_DASHBOARD.md](./ACCOUNTS_ONBOARDING_DASHBOARD.md) | Accounts set-password → Contact Center dashboard deep-link (mint + exchange) |
| [TELEPHONY_PRESENCE_STORED_PROCEDURE.md](./TELEPHONY_PRESENCE_STORED_PROCEDURE.md) | Unified Media Node: presence SP contract, call scenarios, and sample payloads |
| [SFT agent catalog](../a2a/SFT_AGENT_CATALOG.md) | Internal JSON APIs to list/export NLP agents for synthetic / SFT data generation |
| [DEFERRED_ENTERPRISE_WORK.md](./DEFERRED_ENTERPRISE_WORK.md) | Deferred email, webchat, routing, SLA, reliability, and governance work |

Regenerate schema documentation after migrations (requires database access):

```bash
npx tsx packages/db-cc/scripts/generate-schema-docs.ts
```
