# Strangler migration inventory

**Primary app:** Vite `:5173` + Fastify `:4000` (see [split-stack-dev.md](./split-stack-dev.md)).  
Legacy Next.js App Router UI has been **removed** from the repo (2026-07 cutover). Domain lives under `backend/src/dao/**` (DB) and `backend/src/service/**` (commands).

## Ground rules

- Port behavior from historical Next screens when closing gaps; no redesigns.
- Reuse `backend/src/dao/**` + `backend/src/service/**` via Fastify thin routes.
- Tenant = login user `organization_id` only.

## Auth (Wave 1) — DONE

| Current | Fastify | Status |
|---------|---------|--------|
| `loginAction` | `POST /api/auth/login` | Done |
| `logoutAction` | `POST /api/auth/logout` | Done |
| Session cookie `worktual_uid` | Same cookie + HMAC | Done |
| Client session | `GET /api/auth/me` | Done |

## Contacts (Wave 2) — DONE (parity cutover)

Shared commands: [`backend/src/service/contacts/contact-commands.ts`](../backend/src/service/contacts/contact-commands.ts)  
Routes: [`backend/src/modules/contacts.ts`](../backend/src/modules/contacts.ts)  
Vite: list / detail / create / edit under `frontend/src/pages/Contact*`

| Capability | Fastify | Vite |
|------------|---------|------|
| List + filters + export | `GET /api/contacts`, `GET /api/contacts/export` | Done |
| Get + ownership | `GET /api/contacts/:id` (+ `assertRecordAccess`) | Done |
| Create / update / delete | `POST/PATCH/DELETE` | Done |
| Pin / convert lead | `POST .../pin`, `POST .../convert` | Done |
| Activities | `POST .../activities`, delete/status | Done |
| Duplicates / merge | find / preview / execute | API ready; list merge UI deferred |
| Enrichment SSE | Still on Next | Deferred (Socket.IO later) |

**Exit:** Contacts nav on `:5173` is live (not `ModulePendingPage`).

## Companies (Wave 3) — DONE (parity cutover)

Shared commands: [`backend/src/service/companies/company-commands.ts`](../backend/src/service/companies/company-commands.ts)  
Routes: [`backend/src/modules/companies.ts`](../backend/src/modules/companies.ts)  
Vite: list / detail / create / edit + locations

| Capability | Fastify | Vite |
|------------|---------|------|
| List | `GET /api/companies` | Done |
| Get + ownership | `GET /api/companies/:id` | Done |
| Create (+ primary location) | `POST /api/companies` | Done |
| Update / delete | `PATCH/DELETE /api/companies/:id` | Done |
| Locations CRUD | `.../locations` | Done |

## Products (Wave 4) — DONE (parity cutover)

Shared commands: [`backend/src/service/products/product-commands.ts`](../backend/src/service/products/product-commands.ts)  
Routes: [`backend/src/modules/products.ts`](../backend/src/modules/products.ts)  
Vite: list / detail / create / edit + CSV import

| Capability | Fastify | Vite |
|------------|---------|------|
| List + filters | `GET /api/products` | Done |
| Categories | `GET /api/products/categories` | Done |
| Select (Sales-ready) | `GET /api/products/select` | Done |
| Get / create / update / delete | CRUD on `/api/products/:id` | Done |
| CSV import | `POST /api/products/import` | Done |
| Catalog sync UI | Wave **7** Configuration | Done |

## Sales Wave 5A — DONE (pipeline + deals)

Shared commands: [`backend/src/service/sales/deal-commands.ts`](../backend/src/service/sales/deal-commands.ts)  
Routes: [`backend/src/modules/sales.ts`](../backend/src/modules/sales.ts)  
Select helpers: `GET /api/contacts/select`, `GET /api/companies/select`  
Vite: kanban pipeline, deal create/edit/detail

| Capability | Fastify | Vite |
|------------|---------|------|
| Board | `GET /api/sales/deals/board` | Done (kanban + table + owner/stage filters) |
| List | `GET /api/sales/deals` | API ready |
| Form options | `GET /api/sales/deals/form-options` | Done |
| CRUD + stage | POST/PATCH/DELETE + `POST .../stage` | Done |
| Quotes / orders | Wave **5B** | Done (invoice deep link → Vite Finance) |
| Calendar | Wave **8** | Done |

## Sales Wave 5B — DONE (quotes + accept → order/invoice)

Shared commands: [`backend/src/service/sales/quote-commands.ts`](../backend/src/service/sales/quote-commands.ts)  
Routes: `/api/sales/quotes`, `/quotes/form-options`, `/quotes/:id/send|accept|reject`, `/deals/:id/quotes`  
Vite: Quotes list/create lifecycle; deal detail quotes panel

| Capability | Fastify | Vite |
|------------|---------|------|
| List | `GET /api/sales/quotes` | Done |
| Deal quotes | `GET /api/sales/deals/:id/quotes` | Done (panel) |
| Form options | `GET /api/sales/quotes/form-options` | Done |
| Create | `POST /api/sales/quotes` | Done |
| Send / accept / reject | `POST .../send|accept|reject` | Done |
| Accept → order + B2B invoice | Same domain as Next | Invoice link → `/finance/:id` |

## Finance Wave 6 — DONE (invoices)

Shared commands: [`backend/src/service/finance/invoice-commands.ts`](../backend/src/service/finance/invoice-commands.ts)  
Routes: [`backend/src/modules/finance.ts`](../backend/src/modules/finance.ts) (`/api/finance/...`)  
Vite: list + KPIs, detail, create from deal, send / mark paid  
**Invariant:** never enable Finance for B2C (module gating unchanged). Mutations: `admin` | `finance` only.

| Capability | Fastify | Vite |
|------------|---------|------|
| List + summary | `GET /api/finance/invoices` | Done |
| Bar chips | `GET /api/finance/invoices/bar` | Done |
| Detail | `GET /api/finance/invoices/:id` | Done |
| Create options / autofill | `.../create-options`, `.../autofill/:dealId` | Done |
| Create from deal | `POST /api/finance/invoices` | Done (tax UI + product/add-on lines) |
| Send email | `POST .../:id/send` | Done |
| Mark paid | `POST .../:id/mark-paid` | Done |

## Inbox + Configuration Wave 7 — DONE (MVP)

Shared commands:
- [`backend/src/service/configuration/configuration-commands.ts`](../backend/src/service/configuration/configuration-commands.ts)
- [`backend/src/service/inbox/inbox-commands.ts`](../backend/src/service/inbox/inbox-commands.ts)

Routes: `/api/configuration/*`, `/api/inbox/*`  
Vite: Inbox list/compose/reply/sync; Configuration Email + Catalog sync  

**OAuth:** start/callback on Fastify (`/api/google|microsoft/oauth/*`) — see Wave 13. Vite Connect uses same-origin `/api/.../start` (proxied to `:4000`).

| Capability | Fastify | Vite |
|------------|---------|------|
| Email status / disconnect / preferred send | `GET/POST /api/configuration/email…` | Done |
| Catalog list / connect / disconnect / sync | `GET/POST /api/configuration/catalog…` | Done (admin) |
| Inbox threads + sync + send | `/api/inbox/threads`, `/sync`, `/send` | Done |
| Folders / drafts / trash / AI draft | `PATCH .../folder`, draft + draft-reply | Done |
| AI draft / full folder UX / meetings | — | Done (Vite InboxClient) |

## Activities + Calendar Wave 8 — DONE (MVP)

Shared commands:
- [`backend/src/service/activities/activity-commands.ts`](../backend/src/service/activities/activity-commands.ts)
- [`backend/src/service/calendar/calendar-commands.ts`](../backend/src/service/calendar/calendar-commands.ts)
- [`backend/src/service/calendar/schedule-meeting-command.ts`](../backend/src/service/calendar/schedule-meeting-command.ts)

Routes: `/api/activities`, `/api/calendar/events|meetings|activities`  
Vite: Activities hub (list/KPIs/complete); Sales calendar week grid + schedule meeting + add task

| Capability | Fastify | Vite |
|------------|---------|------|
| Activity feed + stats | `GET /api/activities`, `/stats` | Done |
| Complete task | `POST /api/activities/:id/complete` | Done |
| Calendar events | `GET /api/calendar/events` | Done (week + month) |
| Schedule meeting | `POST /api/calendar/meetings` | Done |
| Add task from calendar | `POST /api/calendar/activities` | Done |
| Month view / weekends toggle | Client | Done |
| Google event sync | Deferred | CRM events only |

## Commerce Wave 9 — DONE (B2C / B2B2C orders)

Shared commands: [`backend/src/service/commerce/commerce-commands.ts`](../backend/src/service/commerce/commerce-commands.ts)  
Routes: `/api/commerce/orders`, create-options, create, detail  
Vite: list + create, detail; contact “New order” + orders panel  
**Gating:** B2C / B2B2C only (not B2B). Mutations: `canEditCommerce`.

| Capability | Fastify | Vite |
|------------|---------|------|
| List commerce orders | `GET /api/commerce/orders` | Done |
| Create options | `GET .../create-options` | Done |
| Create (contact + product) | `POST /api/commerce/orders` | Done |
| Detail | `GET /api/commerce/orders/:id` | Done |
| Contact deep link | `?contactId=` | Done |
| Status edit / multi-line | Deferred | Not in Next |

## Dashboard + Reports Wave 10 — DONE

Shared commands:
- [`backend/src/service/home/dashboard-commands.ts`](../backend/src/service/home/dashboard-commands.ts)
- [`backend/src/service/reports/report-commands.ts`](../backend/src/service/reports/report-commands.ts)

Routes: `/api/home`, `/api/home/ops/*`, `/api/reports`, `/api/reports/refresh`  
Vite: `/dashboard` (persona home + admin/rep ops), `/reports` (funnel snapshot / own-scoped live)  
Index redirects to `/dashboard`.

| Capability | Fastify | Vite |
|------------|---------|------|
| Home dashboard | `GET /api/home` (+ query filters) | Done |
| Bulk / auto-assign leads | `POST /api/home/ops/…` | Done |
| Reassign deal | `POST /api/home/ops/reassign-deal` | Done |
| Reports payload | `GET /api/reports` | Done |
| Refresh org snapshot | `POST /api/reports/refresh` | Done (admin/manager) |

## Agents Wave 11 — DONE (metrics dashboard)

Shared commands: [`backend/src/service/ai/agents-commands.ts`](../backend/src/service/ai/agents-commands.ts)  
Routes: `GET /api/agents?range=1h|1d|7d`  
Vite: `/agents` — same agent cards / range picker as Next  
**RBAC:** `canViewAgents` (admin + sales_manager). Native Python runners remain
on the AI side service.

| Capability | Fastify | Vite |
|------------|---------|------|
| Dashboard metrics | `GET /api/agents` | Done |
| Range filter | `?range=` | Done |
| Trigger / configure agents | N/A (side service) | Deferred |

## Marketing + Service Wave 12 — DONE (MS proxy / handoff)

Shared commands:
- [`backend/src/service/service/service-commands.ts`](../backend/src/service/service/service-commands.ts)
- [`backend/src/service/marketing/marketing-commands.ts`](../backend/src/service/marketing/marketing-commands.ts)

Routes:
- `GET /api/service/tickets` — read-through Service MS
- `GET /api/marketing/status` — Campaign app link-out
- `POST /api/marketing/leads` — inbound lead webhook (same as Next `/api/marketing/leads`)

Vite: `/service` ticket list; Marketing campaign shell (`/marketing/dashboard|create|campaigns|inbox|templates|events`) with local draft/template UX; marketing role home → `/marketing/dashboard`.

**Boundary:** Campaign DB and Service MS remain systems of record. CRM does not store campaigns/tickets.

| Capability | Fastify | Vite |
|------------|---------|------|
| Service ticket list | `GET /api/service/tickets` | Done |
| Marketing status / link-out | `GET /api/marketing/status` | Done |
| Inbound marketing leads | `POST /api/marketing/leads` | Webhook (MS → CRM) |
| Campaign create / inbox / templates | Local shell (same as Next Phase 1) | Done |
| Live campaign_db listing | Deferred | Empty states |

## OAuth BFF Wave 13 — DONE

Shared: [`backend/src/service/oauth/oauth-bff.ts`](../backend/src/service/oauth/oauth-bff.ts)  
Routes: `/api/google/oauth/start|callback`, `/api/microsoft/oauth/start|callback`  
Vite Connect → same-origin start (proxied); callback on `OAUTH_CALLBACK_ORIGIN` (default Fastify `:4000`).  
Next routes thin-wrap the same commands.

| Capability | Fastify | Vite |
|------------|---------|------|
| Google OAuth start/callback | Done | Connect button |
| Microsoft OAuth start/callback | Done | Connect button |
| returnTo SPA | Absolute URL to `:5173` | Done |

**Setup:** set `FRONTEND_ORIGIN`, `OAUTH_CALLBACK_ORIGIN`, and redirect URIs in Google/Azure (see [split-stack-dev.md](./split-stack-dev.md)).

## Parity pass (post Wave 13)

Closed major Vite MVP gaps vs Next:

| Area | Fixed |
|------|--------|
| Contact detail | Quick actions, timeline, merge wizard, deal links, status badges |
| Deal detail | Proposals, history, closed-won/lost dialogs, full quick actions, activity delete |
| Invoice create | Regional tax UI + product add-ons |
| Inbox | Draft/Trash folders, compose picker, threaded reply, meetings, AI draft, autosave |
| Pipeline | Owner/stage filters, table view, lost-reason dialog |
| Calendar | Week/month toggle, weekends |

Still thinner / deferred (acceptable): Google Meet Chrome add-on (Next-only host); live `campaign_db` listing; Google Calendar event ingest into CRM calendar.

## Cutover (2026-07) — Vite is primary

| Decision | Status |
|----------|--------|
| Day-to-day CRM on Vite + Fastify | **Yes** |
| Next App Router UI in repo | **Removed** |
| Deal duplicate warning on create | **Done** |
| Google Meet Chrome add-on | **Removed with Next** (re-add under Vite if needed later) |

## Meeting Assist live flow — DONE (MVP parity)

Shared commands: [`backend/src/service/ai/meeting-assist-commands.ts`](../backend/src/service/ai/meeting-assist-commands.ts) (no `next/cache` — wraps `backend/src/service/ai/meeting-assist.ts`, which turned out to already be framework-agnostic; only `meeting-assist-actions.ts`'s `"use server"` + `revalidatePath` needed dropping)
Routes: [`backend/src/modules/meeting-assist.ts`](../backend/src/modules/meeting-assist.ts) → `/api/meeting-assist/sessions/*`
Vite: `frontend/src/components/meeting-assist/AssistSidePanel.tsx`, `frontend/src/pages/MeetingAssistPanelPage.tsx` (`/meeting-assist/panel/:sessionId`), Meet/Zoom/Teams hosts under `frontend/src/pages/hosts/`, `frontend/src/components/contacts/MeetingAssistPanel.tsx` (contact meeting activity → "History")

| Capability | Fastify | Vite |
|------------|---------|------|
| Start / resume session | `POST /api/meeting-assist/sessions` | Done |
| Get session (+ chunks, activity/contact context) | `GET .../:sessionId` | Done — enriched with `activity`/`contactName` so the SPA needs one round trip instead of Next's 3 server-side fetches |
| Get session for activity (optional, added) | `GET .../activity/:activityId` | Done — used by the panel's "History" view |
| Append transcript chunks (live push + provider webhooks) | `POST .../:sessionId/chunks` | Done |
| Run KB-backed assist | `POST .../:sessionId/assist` | Done |
| Finalize → roll up to `ContactActivity.transcriptText` | `POST .../:sessionId/finalize` | Done |
| Live transcript + auto-assist stream | `GET .../:sessionId/events` (SSE) | Done — `EventSource` w/ credentials, same event shape as Next |
| Browser / host coaching UI | Same domain (`runMeetingAssist`, `meeting-assist-auto.ts` debounce) | Done — shared `AssistSidePanel` for Meet/Zoom/Teams + CRM deep link; old fullscreen CRM companion removed |

**Auth:** session cookie for user-facing routes; `POST .../chunks` and `POST .../finalize` also accept `x-internal-secret` (same secret as `ENRICH_INTERNAL_SECRET`/`CRON_SECRET`) for provider webhooks, matching `isInternalAgentAuthorized()` behavior but adapted to Fastify's plain header object.

**Deferred (historical):** Chrome-extension Meet prototype — superseded by official Meet / Zoom / Teams side panels. See [`docs/in-meeting-assist.md`](./in-meeting-assist.md) for panel JWT auth, host URLs, and transcript webhooks. `meeting-assist-auto.ts`'s in-memory debounce state is per-process (same as Next), so it won't share state across horizontally-scaled Fastify instances — pre-existing limitation, not introduced by this port.

## Notification bell + AI LeadSummaryPanel — DONE

Shared commands:
- [`backend/src/service/notifications/notification-commands.ts`](../backend/src/service/notifications/notification-commands.ts) (list / mark read / mark all — extracted from `actions.ts`, no `next/cache`)
- [`backend/src/service/ai/lead-summary-commands.ts`](../backend/src/service/ai/lead-summary-commands.ts) (RBAC wrapper over `getOrRefreshLeadSummary` + `getLeadScoreStatus`)

Routes: `/api/notifications`, `/api/notifications/:id/read`, `/api/notifications/read-all`, `/api/notifications/events` (SSE, admin-only) · `/api/contacts/:id/summary`, `/api/contacts/:id/summary/refresh`, `/api/contacts/:id/summary/events` (SSE)  
Vite: `NotificationBell` in the header (before Help, same as Next); `LeadSummaryPanel` + `LeadSummaryAutoRefresh` + `LeadScoreBadge` on the contact detail page.

| Capability | Fastify | Vite |
|------------|---------|------|
| Notification list + unread count (admin-only) | `GET /api/notifications` | Done |
| Mark one / all read | `POST .../:id/read`, `POST .../read-all` | Done |
| Live unread badge | `GET /api/notifications/events` (SSE, admin-only) | Done — `EventSource` w/ credentials |
| Deep links | Stored `href` (e.g. `/inbox?thread=...`) | Done — `react-router` `Link` |
| AI lead summary + score gauge | `GET /api/contacts/:id/summary` | Done |
| Force refresh | `POST /api/contacts/:id/summary/refresh` | Wired (not yet a UI button) |
| Live auto-refresh on timeline change | `GET /api/contacts/:id/summary/events` (SSE, ownership-scoped) | Done — `EventSource` w/ credentials |

## Later waves (checklist)

| Wave | Module | Status | Notes |
|------|--------|--------|-------|
| 5B | Sales quotes/orders | **Done** | Accept → order → invoice on Vite Finance |
| 6 | Finance | **Done** | Never enable for B2C |
| 7 | Inbox + Configuration | **Done** | OAuth BFF on Fastify (Wave 13) |
| 8 | Activities | **Done** | Hub + sales calendar MVP |
| 9 | Commerce | **Done** | Contact-first orders; B2B excluded |
| 10 | Dashboard + Reports | **Done** | Home aggregates + funnel snapshots |
| 11 | Agents | **Done** | Metrics dashboard; native Python runtime stays side service |
| 12 | Marketing + Service | **Done** | MS proxy/handoff + campaign shell |
| 13 | OAuth BFF | **Done** | Email Connect no longer needs Next `:3000` |

### Per-wave pattern

1. Inventory Next routes/actions → add rows here  
2. `*-commands.ts` (no `next/cache`) + `backend/src/modules/`  
3. Port UI into `frontend/src/`  
4. Update deep-link allowlists if needed  
5. Smoke vs Next → mark Done here; remove pending route

## Dev

See [split-stack-dev.md](./split-stack-dev.md): Vite `:5173` → Fastify `:4000`.
