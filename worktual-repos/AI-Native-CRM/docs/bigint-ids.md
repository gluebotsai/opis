# worktual_bigint identity map (UUID → bigint)

CRM / CDP / accounts on `worktual_bigint` use **bigint** for shared identity
and **text** for CRM entity cuids / CDP person keys.

## bigint (cast as `::bigint` in SQL; Prisma `BigInt`)

| Column pattern | Meaning |
|----------------|---------|
| `organization_id` / `tenant_id` | Tenant |
| `setup_users.id`, `*_user_id`, `owner_user_id`, … | Users |
| `cdp.products.product_id` | CDP product PK |

Default seed tenant on this DB: **`1000`**.

## text (do not cast as uuid/bigint)

| Column | Meaning |
|--------|---------|
| `cdp.customer_profile.cdp_id` | Person key (text; UUID-shaped or numeric string) |
| `crm.contact_profiles.account_contact_id`, `*.contact_id` | Same as `cdp_id` (text) |
| `companies.id`, `deals.id`, `quotes.id`, … | CRM cuid PKs |
| `company_id`, `deal_id`, `location_id` | CRM entity FKs |

## Code touchpoints

- Prisma: `prisma/schema.prisma` (CRM), `campaign-ms/prisma/schema.prisma`
- Bridge: `backend/src/dao/db/prisma.ts` (string ↔ BigInt)
- Accounts SQL: `backend/src/service/account/setup-users.ts`
- MCP SQL: `ai-service/app/mcp/dispatch.py`
- Env: `DATABASE_URL` / `ACCOUNT_DATABASE_URL` → `…/worktual_bigint`

After schema edits: `npm run db:generate` from repo root.
