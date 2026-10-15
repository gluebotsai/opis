-- Recreate ClickHouse dictionary after Postgres column rename (website_id, website_url).
-- Run on ClickHouse after public.admin_accounts has website_id / website_url columns.

DROP DICTIONARY IF EXISTS web_tracking.dict_admin_accounts;

-- Then apply 02b_dict_admin_accounts.sql via:
--   python3 scripts/apply_clickhouse_ddl.py --dictionary-only
-- Or paste substituted CREATE DICTIONARY from 02b_dict_admin_accounts.sql

SYSTEM RELOAD DICTIONARY web_tracking.dict_admin_accounts;

-- Verify:
-- SELECT name, status FROM system.dictionaries WHERE database = 'web_tracking';
