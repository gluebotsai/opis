# Setup — organization (profile, branches, hours, teams, roles, users)

## Purpose

Shared org operating model: business profile, branches, holiday calendars, business hours, teams, roles, and setup users. Product spokes should treat this as the source of truth for “who works where.”

## Auth

Customer Bearer + org admin for writes.

## Source map

| Layer | Path |
|-------|------|
| Client | [`src/lib/setup/setupApi.js`](../../src/lib/setup/setupApi.js) |
| Server | [`server/setupOrganization.js`](../../server/setupOrganization.js) |
| Repo | [`server/repositories/raw/setupOrganization.repo.js`](../../server/repositories/raw/setupOrganization.repo.js) |
| Routes | [`server/index.js`](../../server/index.js) under `/api/v1/me/setup/...` |

## Endpoints

### Business profile

| Method | Path | Client helper | Body / query | Response | Notes |
|--------|------|---------------|--------------|----------|-------|
| GET | `/api/v1/me/setup/business-profile` | `getBusinessProfile` | — | `{ profile }` | |
| PUT | `/api/v1/me/setup/business-profile` | `saveBusinessProfile` | profile fields | `{ profile }` | Upsert |

### Branches

| Method | Path | Client helper | Body / query | Response | Notes |
|--------|------|---------------|--------------|----------|-------|
| GET | `/api/v1/me/setup/branches` | `listBranches` | — | `{ branches }` | |
| POST | `/api/v1/me/setup/branches` | `createBranch` | branch fields | `{ branch }` | |
| PATCH | `/api/v1/me/setup/branches/:id` | `updateBranch` | partial | `{ branch }` | |
| DELETE | `/api/v1/me/setup/branches/:id` | `deleteBranch` | — | `204` | |

### Holiday calendars

| Method | Path | Client helper | Body / query | Response | Notes |
|--------|------|---------------|--------------|----------|-------|
| GET | `/api/v1/me/setup/holiday-calendars` | `listHolidayCalendars` | — | `{ calendars }` | |
| POST | `/api/v1/me/setup/holiday-calendars` | `createHolidayCalendar` | calendar fields | `{ calendar }` | |
| POST | `/api/v1/me/setup/holiday-calendars/:id/holidays` | `addHolidays` | `{ holidays: [...] }` | `{ calendar }` / holidays | Bulk add |

Helpers (non-HTTP): [`src/lib/setup/countryHolidays.js`](../../src/lib/setup/countryHolidays.js).

### Business hours

| Method | Path | Client helper | Body / query | Response | Notes |
|--------|------|---------------|--------------|----------|-------|
| GET | `/api/v1/me/setup/business-hours` | `listBusinessHours` | — | `{ schedules }` / hours list | |
| POST | `/api/v1/me/setup/business-hours` | `createBusinessHours` | schedule payload | created row | |
| PATCH | `/api/v1/me/setup/business-hours/:id` | `updateBusinessHours` | partial | updated | |
| DELETE | `/api/v1/me/setup/business-hours/:id` | `deleteBusinessHours` | — | `204` | |

### Teams

| Method | Path | Client helper | Body / query | Response | Notes |
|--------|------|---------------|--------------|----------|-------|
| GET | `/api/v1/me/setup/teams` | `listTeams` | — | `{ teams }` | |
| GET | `/api/v1/me/setup/teams/:id` | `getTeam` | — | `{ team }` | Includes members |
| POST | `/api/v1/me/setup/teams` | `createTeam` | team + members | `{ team }` | |
| PATCH | `/api/v1/me/setup/teams/:id` | `updateTeam` | partial | `{ team }` | |
| DELETE | `/api/v1/me/setup/teams/:id` | `deleteTeam` | — | `204` | Queues may reference teams |

### Roles

| Method | Path | Client helper | Body / query | Response | Notes |
|--------|------|---------------|--------------|----------|-------|
| GET | `/api/v1/me/setup/roles` | `listRoles` | — | `{ roles }` | |
| POST | `/api/v1/me/setup/roles` | `createRole` | role + permissions | `{ role }` | |
| PATCH | `/api/v1/me/setup/roles/:id` | `updateRole` | partial | `{ role }` | |
| DELETE | `/api/v1/me/setup/roles/:id` | `deleteRole` | — | `204` | |

**Permission models**

- **Non-CRM products:** boolean flags `canView` / `canCreate` / `canEdit` / `canDelete` / `canExport`. `modulePermissions` is stored as `[]`.
- **CRM (`productId: crm`):** module access only — `modulePermissions: string[]` (stable slugs). CRUD flags are not used for CRM UI; server may leave them at defaults. Catalog depends on Business Profile `businessType`:
  - `B2B` — Dashboard, Inbox, Contact, Company, Marketing, Sales, Activities, Product, Finance, Service, Reports & Analytics, Configuration
  - `B2C` — Dashboard, Inbox, Contact, Marketing, Activities, Product, Commerce, Service, Reports & Analytics, Configuration
  - `B2B & B2C` (treated as **B2B2C**) — union of B2B + Commerce
- Creating/editing a CRM role requires business type to be set; unknown module ids are rejected. Catalog helpers: [`src/lib/setup/crmModules.js`](../../src/lib/setup/crmModules.js). Column: `setup_roles.module_permissions` (JSONB). Runtime enforcement in the CRM spoke is out of scope here.

**Custom roles (temporarily disabled)**

`CUSTOM_SETUP_ROLES_ENABLED` in [`src/lib/setup/defaultRoles.js`](../../src/lib/setup/defaultRoles.js) is `false`. UI hides Add/Edit/Delete; API rejects create/patch/delete; People may assign **default roles only**. Re-enable later when custom roles are allowed again.

**CRM default roles**

When an **org admin** logs into My Account (and also when Business Profile `businessType` is saved), the server ensures these CRM roles exist if the org has an **active CRM** subscription and a resolvable business type. Existing roles with the same name are left unchanged (insert-only). Templates: [`src/lib/setup/crmDefaultRoles.js`](../../src/lib/setup/crmDefaultRoles.js); seeder: [`server/ensureCrmDefaultRoles.js`](../../server/ensureCrmDefaultRoles.js).

| Role | Modules (intersected with business-type catalog) |
|------|--------------------------------------------------|
| Admin | Everything the business type allows |
| Manager | Everything the business type allows |
| Sales Rep | Dashboard, Inbox, Contact, Company, Sales, Activities, Product, Commerce*, Service, Reports & Analytics, Configuration — no Marketing, no Finance |
| Marketing | Dashboard, Inbox, Contact, Company, Marketing, Activities, Product, Commerce*, Reports & Analytics, Configuration — no Sales, Finance, or Service |
| Finance | Dashboard, Inbox, Contact, Company, Finance, Reports & Analytics |

\*Commerce (and Company) appear only when the org business type allows them. Other products’ default roles are out of scope for now.

**CCaaS default roles** (`productId: contact-center`)

Same seed triggers as CRM (org-admin login + Business Profile save) when the org has an **active** `contact-center` subscription. Business type is not required. Insert-only. Templates: [`src/lib/setup/ccaasDefaultRoles.js`](../../src/lib/setup/ccaasDefaultRoles.js); seeder: [`server/ensureCcaasDefaultRoles.js`](../../server/ensureCcaasDefaultRoles.js). Shared entry: [`server/ensureProductDefaultRoles.js`](../../server/ensureProductDefaultRoles.js).

| Role | Permissions (modules TBD) |
|------|---------------------------|
| Admin | View, Create, Edit, Delete, Export |
| Agent | View only |

### Setup users (people)

| Method | Path | Client helper | Body / query | Response | Notes |
|--------|------|---------------|--------------|----------|-------|
| GET | `/api/v1/me/setup/users` | `listSetupUsers` | — | `{ users }` | Org people directory |
| POST | `/api/v1/me/setup/users` | `createSetupUser` | user fields | `{ user, inviteSent, inviteError }` | Sends product invite when `productAccess` set |
| PATCH | `/api/v1/me/setup/users/:id` | `updateSetupUser` | partial | `{ user, inviteSent, inviteError, accessNotified, accessNotifyError }` | Invites when product access first added (pending/invited). If `inviteStatus=active` and products/roles change → access-updated email (no password link) |
| POST | `/api/v1/me/setup/users/:id/resend-invite` | `resendSetupUserInvite` | — | `{ user, inviteSent, email, expiresAt }` | Pending/invited only |
| DELETE | `/api/v1/me/setup/users/:id` | `deleteSetupUser` | — | `204` | |

User fields include directory data plus invite metadata: `inviteStatus` (`pending` \| `invited` \| `active` \| `disabled`), `invitedAt`, `passwordSetAt`. **`password_hash` is never returned.**

### Product-user invite (public — not My Account login)

Onboarded people (`setup_users`) are **product users**, not My Account admins. Invite email uses Worktual platform mail (`SETUP_INVITE_SMTP_FROM`, default `Worktual <sample151102@gmail.com>`) with a **set-password link only** (no temporary password).

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/v1/invite/setup-user?token=` | Public | Preview: email, name, products, expiry |
| POST | `/api/v1/invite/setup-user/set-password` | Public | `{ token, password, confirmPassword }` → stores hash, `inviteStatus=active` |

UI: `/invite/set-password?token=…` ([`SetupUserSetPasswordPage.jsx`](../../src/pages/SetupUserSetPasswordPage.jsx)). After success, lists product names (no product login URLs yet).

Tokens: `setup_user_invite_tokens` (hashed, 72h, one-time). Server: [`server/setupUserInvite.js`](../../server/setupUserInvite.js).

### Access grant / update email (Active users only)

When an admin changes `productAccess` for a user who already set a password (`inviteStatus=active`):

- DB grants are updated as usual (`setup_user_product_access`).
- User receives `notifySetupUserAccessChanged` — lists added/removed products and current access.
- **No** set-password link; existing password continues to work.
- Mail failure does not roll back the DB change (`accessNotifyError` on PATCH response).

Pending/invited users do not get this mail (they use the set-password invite / resend flow instead).

Constants: `SETUP_TIMEZONES`, `SETUP_DAYS` exported from `setupApi.js`.

## Dependencies / gates

None beyond customer auth + org admin. CCaaS queues require a team from this surface. Product invites require at least one `productAccess` grant.

## Reuse notes

- **CRM / CCaaS:** list teams and users for assignment UIs; do not create a second people store.
- **Product spokes:** authenticate product users against `setup_users.password_hash` in a later phase — this pass only stores the hash after invite set-password.
- **Lola:** business hours + holidays inform out-of-hours messaging (see web chat personalisation).
- Do **not** create `customer_users` for Setup People invites.