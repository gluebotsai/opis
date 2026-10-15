# Internal — staff auth and admin

## Purpose

Internal Worktual staff sign-in, profile, and admin user management (not customer portal). Used by sales, finance, and admin UIs inside My Account.

## Auth

| Area | Gate |
|------|------|
| Login | Public |
| Session | `requireAuth` (staff Bearer) |
| User admin / pricing / cancellation admin | `requireAdminAuth` |

## Source map

| Layer | Path |
|-------|------|
| Client | [`src/lib/auth.js`](../../src/lib/auth.js), [`src/lib/signIn.js`](../../src/lib/signIn.js), [`src/lib/users.js`](../../src/lib/users.js), [`src/lib/adminCancellationRequests.js`](../../src/lib/adminCancellationRequests.js) |
| Server | [`server/auth.js`](../../server/auth.js), [`server/users.js`](../../server/users.js), bulk upload helpers |

## Endpoints

### Auth

| Method | Path | Client helper | Body | Response | Notes |
|--------|------|---------------|------|----------|-------|
| POST | `/api/auth/login` | `login` | email, password | token + user | |
| POST | `/api/auth/sign-in` | sign-in helpers | email, password | token + user | Alternate entry |
| POST | `/api/auth/logout` | `logout` | — | — | Requires auth |
| GET | `/api/auth/me` | `fetchCurrentUserProfile` | — | user profile | |
| PUT | `/api/auth/profile` | `updateCurrentUserProfile` | profile fields | user | |

### Admin users

| Method | Path | Client helper | Notes |
|--------|------|---------------|-------|
| GET | `/api/admin/users` | `fetchManagedUsers` | |
| POST | `/api/admin/users` | `createManagedUser` | |
| PUT | `/api/admin/users/:id` | `updateManagedUser` | |
| DELETE | `/api/admin/users/:id` | `deleteManagedUser` | |
| POST | `/api/admin/users/bulk/preview` | `previewBulkUserUpload` | CSV body |
| POST | `/api/admin/users/bulk/import` | `importBulkUserUpload` | CSV body |

### Admin cancellation requests

| Method | Path | Client helper | Notes |
|--------|------|---------------|-------|
| GET | `/api/admin/cancellation-requests` | list admin cancellations | Filter query |
| GET | `/api/admin/cancellation-requests/:id` | get one | |
| POST | `/api/admin/cancellation-requests/:id/approve` | approve | |
| POST | `/api/admin/cancellation-requests/:id/reject` | reject | |

### Admin pricing

| Method | Path | Notes |
|--------|------|-------|
| PUT | `/api/admin/pricing-catalog` | Update catalog (admin) |

## Reuse notes

- Product spokes generally **do not** call staff auth — they use customer entitlements.
- Keep staff and customer tokens separate.
