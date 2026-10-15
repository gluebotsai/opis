# Database v2 — multi-schema multi-tenancy + RLS

Single Postgres instance with schemas:

| Schema | Purpose |
| --- | --- |
| `platform` | Staff users, pricing, mail, partners/resellers |
| `accounts` | My Accounts (tenancy root = `organizations.id`) |
| `crm` / `cvm` / `ticketing` / `ccass` / `cdp` / `campaign` | Product stubs |

## Apply order (handled by `src/db/migrate.ts`)

1. `00_schemas.sql`
2. Legacy `database/schema.sql` + repairs (creates tables, then moved)
3. `01_move_tables.sql`
4. `02_tenancy.sql`
5. `03_product_stubs.sql`
6. `04_rls.sql`
7. `05_grants.sql`

## App requirements

- Connection `search_path`: `accounts, platform, public`
- Per request: `platform.set_staff_mode()` or `platform.set_tenant(org_id)`
- Leads created with a prospect `organizations` row and `leads.organization_id`

Tenancy key: `organization_id` (UUID).  
Human code: `tenant_id` / `organizations.tenant_id` (unchanged for API compatibility).

## How to verify

```bash
pnpm migrate
pnpm smoke:rls
node scripts/smoke-test-db.mjs
```

`pnpm smoke:rls` asserts:

1. All product/platform schemas exist
2. `users` lives in `platform`; `leads` / `organizations` in `accounts`
3. FORCE RLS is on for tenant tables
4. Prospect org is created with the lead (`organization_id` set)
5. Staff sees the lead; another org UUID sees 0; owner org sees 1
