# PostgreSQL — read-only access for ClickHouse dictionary

ClickHouse dictionary `web_tracking.dict_admin_accounts` reloads from **`public.v_web_tracking_ingest_registry`** on **`worktual_bigint`** every 15–60 seconds.

The view flattens My Accounts JSON (`visitorAllowanceBySlot`) from `accounts.subscriptions` / `accounts.active_products`. There is **no** `public.admin_accounts` on My Accounts QA.

**Ingest** validates websites via the dictionary in ClickHouse memory only — no Postgres query per SDK payload.

## DB team — one-time (order matters)

**1. Create user and view**

```bash
psql "postgresql://ADMIN@10.180.0.126:5432/worktual_bigint" -f postgres/ddl/10_v_web_tracking_ingest_registry.sql
```

Or run manually:

```sql
CREATE USER ch_sync WITH PASSWORD 'Click1234';
GRANT USAGE ON SCHEMA public TO ch_sync;
-- then CREATE VIEW from 10_v_web_tracking_ingest_registry.sql
```

**2. Column grants for `ch_sync`**

```bash
psql "postgresql://ADMIN@10.180.0.126:5432/worktual_bigint" -f postgres/ddl/admin_accounts_ch_sync.sql
```

**`ch_sync` gets SELECT only** on: `website_id`, `website_url`, `site_type`, `status`, `organization_id`, `is_active`.

Verify as `ch_sync`:

```sql
SELECT website_id, website_url, organization_id, status, is_active
FROM public.v_web_tracking_ingest_registry
WHERE website_id = 1001;
```

Expected: `organization_id = 1003`, URL `https://beta.worktual.co.uk/`.

## App / ClickHouse — one-time dictionary

`.env`:

```env
CH_DICT_PG_HOST=10.180.0.126
CH_DICT_PG_PORT=5432
CH_DICT_PG_DB=worktual_bigint
CH_DICT_PG_USER=ch_sync
CH_DICT_PG_PASSWORD=Click1234
CH_DICT_PG_SCHEMA=public
CH_DICT_PG_TABLE=v_web_tracking_ingest_registry
```

```sql
DROP DICTIONARY IF EXISTS web_tracking.dict_admin_accounts;
```

```bash
python scripts/apply_clickhouse_ddl.py --dictionary-only
python scripts/verify_dict_admin_accounts.py
```

Expected: dictionary `status = LOADED`, rows for registered websites.

## Dictionary columns

| Postgres view column | ClickHouse dict attribute |
|----------------------|---------------------------|
| `website_id` | `website_id` (UInt32) |
| `website_url` | `website_url` |
| `site_type` | `site_type` |
| `status` | `status` |
| `organization_id` | `organization_id` (Int64) |
| `is_active` | `is_active` |

## Ongoing

- Postgres / My Accounts config changes appear in the dictionary within ~60 seconds (automatic reload).
- Restart app after `.env` change: `python run_backend.py --all --detach`
