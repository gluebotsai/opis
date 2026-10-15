# Setup workspace overview

## Purpose

Customer **Setup** configures org-wide resources that product spokes consume: people, teams, hours, channels (email, web chat), CCaaS queues, and knowledge docs. Inbox UX stays in spokes (CCaaS, Campaign, Lola); My Account owns **mapping and config**.

## Auth

- Customer Bearer (`withCustomerAuth`)
- Most writes: organization admin only

## Base path

```text
/api/v1/me/setup
```

**Client:** [`src/lib/setup/setupApi.js`](../../src/lib/setup/setupApi.js)

## Route registry

Handlers registered in [`server/index.js`](../../server/index.js); domain logic split by module:

| Area | Server module | Repo |
|------|---------------|------|
| Profile, branches, hours, teams, roles, users | `server/setupOrganization.js` | `setupOrganization.repo.js` |
| Email channels | `server/setupChannels.js` | `setupChannels.repo.js` |
| Web chat | `server/setupWebchat.js` | `setupWebchat.repo.js` |
| CCaaS queues | `server/setupQueues.js` | (queues repos / SQL in service) |
| Knowledge documents | `server/setupKnowledge.js` | `setupKnowledge.repo.js` |

## Product gates

| Feature | Gate |
|---------|------|
| Web Chat | Active subscription `contact-center` |
| Queues | Active subscription `contact-center` |
| Email | Purchased `contact-center` and/or `campaign` (`EMAIL_CHANNEL_PRODUCT_IDS`) |

## Files in this folder

- [organization.md](./organization.md)
- [channels-email.md](./channels-email.md)
- [channels-webchat.md](./channels-webchat.md)
- [queues.md](./queues.md)
- [knowledge-documents.md](./knowledge-documents.md)

## Reuse notes

- **CCaaS / Lola:** read web chat configs + queues + knowledge docs; do not fork schema.
- **Campaign:** reuse email channel configs tagged with `campaign`.
- **CRM:** reuse teams/roles/users/branches as the people/org spine.
