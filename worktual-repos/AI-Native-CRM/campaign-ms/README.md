# Worktual Campaign MS — Phase 1

Standalone campaign product. Uses `my_account_qa` for login (users only) and `campaign_db` for all campaign data. UI matches Worktual CRM (tokens, login shell, sidebar, header).

## Login credentials

Same seeded CRM users (password for all: **`demo`**).

Recommended for Campaign:

| Email | Role |
|-------|------|
| `marketing.b2b@worktual.com` | marketing |
| `admin.b2b@worktual.com` | admin |
| `manager.b2b@worktual.com` | sales_manager |

Also work if their `organization_id` matches the seeded campaign tenant (`DEFAULT_TENANT_ID`) and `organization_products` has `campaign` active (seed does this for the default tenant).

Other CRM seed emails (`rep.*`, `viewer.*`, `finance.*`, `*.b2c@`, `*.b2b2c@`) use the same password `demo`.

## Prerequisites

- PostgreSQL with `my_account_qa` and `campaign_db`
- Node 20+

## Setup

```bash
cd campaign-ms
cp .env.example .env
npm install
npx prisma migrate dev --name init_campaign_phase1
npm run db:seed
npm run dev
```

App: [http://localhost:3001](http://localhost:3001)

## CRM link-out

In CRM `.env`:

```bash
MARKETING_MS_URL="http://localhost:3001"
```
