# Worktual CRM — Vite + Fastify

## Primary

```bash
# terminal 1 — API
cd backend && npm run dev

# terminal 2 — SPA
cd frontend && npm run dev
```

- **Web:** http://localhost:5173  
- **API:** http://localhost:4000 (Swagger: `/docs`)

From repo root: `npm run dev:api` and `npm run dev:web`.

## Folders

| Path | Role |
|------|------|
| `frontend/` | Vite + React + Redux + React Router |
| `backend/src/` | Fastify API — `config/`, `dao/` (DB), `service/` (commands), `helpers/`, `lib/`, `middlewares/`, `modules/*/routes.ts`, `plugins/`, `server.ts`, `index.ts` |
| `backend/src/dao/**` | Prisma / account-DB queries, repositories, stores |
| `backend/src/service/**` | Route-facing commands and orchestration |
| `backend/src/config/modules.ts` | Business-type × role module matrix (API) |
| `frontend/src/config/modules.ts` | Nav gating matrix (UI copy) |

## API response envelope

All JSON APIs use:

```json
{ "statusCode": 200, "message": "success", "items": [], "total": 0 }
```

Payload fields are at the top level (no `metaResponse`). Errors:

```json
{ "statusCode": 400, "message": "Bad Request" }
```

Handlers use `sendSuccess` / `sendError` / `sendResult` from `backend/src/helpers/response.ts`.  
Messages live in `helpers/constants.ts` (`RESPONSE`).

```ts
return sendSuccess(reply, { user }, RESPONSE.fetched);
// → { statusCode: 200, message: "Fetched successfully", user: { … } }

return sendError(reply, RESPONSE.unauthorized, 401);
// → { statusCode: 401, message: "Not signed in." }
```

The Vite SPA unwraps the envelope in `frontend/src/services/api.ts` so UI services can keep using `{ ok, ... }`.

## OAuth (Email Connect)

Root `.env`:

```bash
FRONTEND_ORIGIN=http://localhost:5173
OAUTH_CALLBACK_ORIGIN=http://localhost:4000
GOOGLE_REDIRECT_URI=http://localhost:4000/api/google/oauth/callback
MICROSOFT_REDIRECT_URI=http://localhost:4000/api/microsoft/oauth/callback
```

Register those callback URIs in Google Cloud / Azure.

## Accounts onboarding (set-password → CRM dashboard)

After a Setup People user sets their password in Accounts, Accounts calls CRM to mint a one-time login URL.

- Mint (server-to-server): `POST /api/auth/onboarding-dashboard-link` with `x-internal-service-key: $INTERNAL_SERVICE_KEY`
- Browser: `https://rebuild-crm.worktual.com/auth/onboarding?code=…`
- Exchange: `POST /api/auth/onboarding-exchange` `{ "code" }` → session cookie, then `/dashboard` or `/marketing/dashboard`

QA API base for Accounts: `https://rebuild-crm.worktual.com/api` (product id `crm`).

