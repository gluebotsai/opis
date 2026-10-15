# Ticketing auth handoff

Cross-team reference for Accounts, CRM, CCaaS, and Platform.

## Four authentication surfaces

| Surface | Who | Credential |
|---------|-----|------------|
| **1. Staff app** | Admin, Agent, Resolver, Viewer | MyAccount email/password → `worktual_token` cookie |
| **2. Support portal** | End customers | OTP/password → `wt_portal` |
| **3. Org API keys** | CRM/CCaaS/email adapters | `Authorization: Bearer wt_live_…` or `X-Api-Key` |
| **4. Service actor** | LangGraph / spoke-to-spoke | `X-Coworker-Tasks-Key` + `X-Coworker-Actor-Id` + `X-Coworker-Org-Id` |

Additional spoke-to-spoke intake auth:

| Surface | Who | Credential |
|---------|-----|------------|
| **Internal service** | Campaign, Social, CCaaS core | `X-Internal-Service-Key` + `X-Ticketing-Org-Id` on `POST /api/intake/tickets` |

## Product entitlement

Staff and CRM JWT paths require active **ticketing** product access in Accounts (`setup_user_product_access.product_id = 'ticketing'`).

- **SPA login:** may create/find thin `ticketing.agents` row via MyAccount `setup_users` (fail closed if hub user missing — never invent MyAccount data)
- **CRM JWT Path A:** **403** if product missing — no auto-create

Tenant (`organization_id`) is always `accounts.organizations.id` from auth — never trusted from request body alone. Unmapped seed orgs (e.g. old Worktual/Jane UUID seed) are discarded; live mapping keeps org **1000**.

## Staff standalone login

1. `POST /api/auth/login` — MyAccount password via Accounts `setup_users`
2. Ticketing JWT in `worktual_token` httpOnly cookie (7d)
3. `GET /api/auth/me` reloads role/modules from Accounts on each request

Response includes host chrome hints:

```json
{
  "user": { "id", "role", "organizationId", ... },
  "modules": ["dashboard", "assigned", ...],
  "dataScope": "org | assignee | requester",
  "portalLabel": "AGENT PORTAL"
}
```

## CRM JWT (Path A)

CRM mints HS256 JWT; Ticketing verifies separately from SPA cookie secret.

| Setting | Value |
|---------|--------|
| `CRM_JWT_ACCESS_SECRET` | Shared HMAC secret |
| `CRM_JWT_ISSUER` | `worktual-crm` (default) |
| `CRM_JWT_USER_ID_CLAIM` | `sub` (default) |

Required claims: user id (`sub`), org id (`org_id` | `organization_id` | `tenant_id`).

Verification order on `/api/*`: **SPA cookie/JWT first**, then CRM Bearer.

## CRM iframe embed (Path B)

1. Host loads `https://<ticketing-spa>/dashboard?embed=1`
2. Host sends `postMessage`:

```json
{ "type": "worktual:ticketing-auth", "token": "<CRM or Ticketing JWT>" }
```

3. SPA stores token in `localStorage` key `worktual.ticketing.jwt` and uses `Authorization: Bearer` on API calls.

## LangGraph service actor

Agents persist memory via Ticketing API:

```
X-Coworker-Tasks-Key: <COWORKER_TASKS_SECRET>
X-Coworker-Actor-Id: <ticketing user uuid>
X-Coworker-Org-Id: <ticketing org uuid>
```

Routes: `GET|PUT /api/coworker/conversation-context`, `POST /api/coworker/workflow-events`.

Set `CONVERSATION_CONTEXT_VIA_API=0` on agents to fall back to direct SQL (legacy dev only).

## Customer redirect

Staff login with customer role → **403** + `supportPortalPath` (unchanged).
