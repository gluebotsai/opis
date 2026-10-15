# Internal — mail workspace

## Purpose

**Staff** mailbox (finance/sales mail UI inside My Account): OAuth to Microsoft/Google/Yahoo, inbox, send. This is **not** the customer Setup email channel API.

Customer channel email → [setup/channels-email.md](../setup/channels-email.md).

## Auth

`requireMailAuth` (mail session). Graph webhook is public with validation.

## Source map

| Layer | Path |
|-------|------|
| Client | [`src/lib/email.js`](../../src/lib/email.js) |
| Server | [`server/mail.js`](../../server/mail.js), OAuth helpers, Graph webhook |

## Endpoints

| Method | Path | Client helper | Notes |
|--------|------|---------------|-------|
| GET | `/api/mail/config` | `fetchMailConfigStatus` | `mailbox` query |
| GET | `/api/mail/oauth/status` | `fetchMailOAuthStatus` | |
| GET | `/api/mail/oauth/connect` | `fetchMailOAuthConnectUrl` | Returns authorize URL |
| GET | `/api/mail/oauth/admin-consent` | admin consent redirect | Microsoft |
| GET | `/api/mail/oauth/callback` | Microsoft callback | Also `/auth/microsoft/callback` |
| GET | `/api/mail/oauth/google/callback` | Google | Also `/auth/google/callback` |
| GET | `/api/mail/oauth/yahoo/callback` | Yahoo | Also `/auth/yahoo/callback` |
| POST | `/api/mail/oauth/disconnect` | `disconnectMailOAuth` | |
| GET | `/api/mail/workspace` | `fetchMailWorkspace` | Folders + summary |
| GET | `/api/mail/verify` | verify connection | |
| POST | `/api/mail/send` | `sendMail` | |
| GET | `/api/mail/inbox` | `fetchInbox` | |
| GET | `/api/mail/messages` | `fetchMailMessages` | |
| GET | `/api/mail/messages/:uid` | `fetchMailMessage` | |
| GET | `/api/mail/messages/:uid/attachments/:attachmentId` | `fetchMailAttachment` | |
| POST | `/api/mail/graph/webhook` | — | Microsoft Graph notifications |

## Reuse notes

- CCaaS/Campaign **customer** mailboxes use Setup channel OAuth, not `/api/mail/*`.
- Do not mix mail auth tokens with customer Bearer tokens.
