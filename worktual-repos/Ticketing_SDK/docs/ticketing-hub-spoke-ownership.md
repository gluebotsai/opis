# Ticketing hub/spoke table ownership

Ticketing is a **spoke**. Company, staff identity, person, orders, and the product catalog live in hub schemas. Ticketing owns support **operational** data only.

## Source of truth

| Domain | Table(s) | Ticketing role |
|--------|----------|----------------|
| Company / tenant | `accounts.organizations` | FK only — **never INSERT** |
| Staff identity | `accounts.setup_users` (+ product access / roles) | FK only — **never INSERT** |
| Person details | `cdp.customer_profile` | Resolve via `cdp_id` |
| Email / phone | `cdp.identity_keys` | Match / lookup |
| Orders | `cdp.orders`, `cdp.order_items` | Read by `cdp_id` (360 / context) |
| Tenant products | `inventory.products` | Read entitlements; no spoke product catalog |
| Spoke org prefs | `ticketing.org_settings` | ticket_prefix, portal_*, timezone, slug |
| Staff bridge | `ticketing.agents` | Local PK + `setup_user_id` → setup_users |
| Support contact ops + portal | `ticketing.contact_profile` | Own extra fields + auth |
| B2B client accounts (spoke) | `ticketing.ticketing_accounts` | Not MyAccount |
| Cases | `ticketing.tickets` | Own fully |
| Ticket config | `ticket_statuses`, `sla_policies`, `sla_policy_defaults`, `automation_rules` | Own org settings |

Do **not** create ticketing copies of MyAccount orgs/users, CDP people, CDP orders, or inventory products. Unmapped seed with no hub row is discarded.

## Ticket create gate

Every create path (`POST /api/tickets`, intake, webchat, portal, widgets) must:

1. **MyAccount** — `accounts.setup_user_product_access` has `product_id = 'ticketing'` for the request `organization_id`.
2. **CDP** — person exists in `cdp.customer_profile` + `cdp.identity_keys` for that same `organization_id` (email/phone/`cdp_id`).
3. **Spoke** — Active `ticketing.contact_profile` linked by `cdp_id` (lazy-created when MyAccount imported CDP-only contacts).

## `ticketing.org_settings`

Spoke-only settings keyed by `organization_id` → `accounts.organizations`:

- `ticket_prefix`, `display_timezone`
- `portal_auth_mode`, `portal_label`, `portal_slug` (may also read accounts `support_portal_*`)

Display name comes from `accounts.organizations.company_name`.

## `ticketing.agents`

Thin staff mirror:

- `id` — local FK target for sessions, assignee, notes, presence, notifications
- `organization_id` → `accounts.organizations`
- `setup_user_id` → `accounts.setup_users` (required, unique)
- Spoke extras: `support_email` / `support_phone`, notify prefs, local timezone/language

Login/assign: resolve MyAccount user → find/create **agent** only if `setup_users` already exists.

## `ticketing.contact_profile`

Renamed from `ticketing.customers`. Holds spoke fields only:

- `id`, `organization_id`, **`cdp_id`** (unique per org)
- Portal: `password_hash`, `password_set_at`, `last_portal_login_at`
- Ops: `status`, `total_tickets`, optional `account_id` → `ticketing_accounts`
- Optional legacy: `external_id`

**No** `name` / `email` / `phone` on this table — resolve from CDP via `cdp_id`.

**Admin add:** `POST /api/customers` checks the Ticketing directory for duplicate email/phone; if new, upserts CDP (`customer_profile` + `identity_keys`) then inserts `contact_profile`. **Create ticket** uses `requireExistingCustomer` (MyAccount Ticketing entitlement + CDP person + Active spoke link).

## Cases vs config

- **`tickets`** = support cases
- Statuses / SLA / automation = **ticket config family**

## Traps

1. Dual SoR for company/staff/name/email/phone/products/orders inside ticketing  
2. Inserting into `accounts.*` from ticketing bootstrap or “ensure org/user”  
3. Naming spoke table `customer_profile` (collides with CDP) — use **`contact_profile`**  
4. Confusing MyAccount `accounts.*` with spoke **`ticketing.ticketing_accounts`** (B2B clients)  
5. Using `setup_users.id` as ticket assignee without going through `agents.id`  
6. Writing a second product catalog or empty `contact_products` / `account_products` (dropped)  
7. Creating tickets without a CDP person for the org, or when the org has no MyAccount `product_id = 'ticketing'` grant

## Schema note

MyAccount schema `accounts.*` ≠ `ticketing.ticketing_accounts` (B2B client accounts in the spoke).
