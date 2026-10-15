# Fix: wishlist / checkout events in payload but Product Analytics shows 0

## Symptom

- Ingest POST contains `add_to_wishlist` / `remove_from_wishlist` (and maybe `begin_checkout`).
- **Cart** KPIs work (`add_to_cart`, `remove_from_cart`).
- **Wishlist** (and sometimes checkout starts) stay **0** on Product Analytics.

## Cause

ClickHouse materialized view **`mv_fact_product`** on the server was created **before** wishlist names were added to its `WHERE event_name IN (...)` list.  
`apply_clickhouse_ddl.py` uses `CREATE MATERIALIZED VIEW IF NOT EXISTS` — it **does not update** an existing MV.

Events are accepted and appear in **`events_staging`** (and may have landed in **`fact_custom_events`** on old pipelines), but **not** in **`fact_product_interactions`**, which the API queries.

## Fix (QA / production ClickHouse)

From repo root, with `.env` pointing at the cluster:

```bash
clickhouse-client \
  --host "$CLICKHOUSE_HOST" \
  --port "${CLICKHOUSE_PORT:-8123}" \
  --user "${CLICKHOUSE_USER:-default}" \
  --password "$CLICKHOUSE_PASSWORD" \
  --multiquery < clickhouse/ddl/14_recreate_mv_fact_product_wishlist.sql
```

Or use your usual ClickHouse HTTP/client tool to run `clickhouse/ddl/14_recreate_mv_fact_product_wishlist.sql`.

This script:

1. Drops and recreates **`mv_fact_product`** (with wishlist + begin_checkout).
2. Drops and recreates **`mv_fact_custom`** (excludes wishlist from custom catch-all).
3. **Optional backfill** from `events_staging` (last 90 days) for wishlist/checkout rows missing from facts.

**No api-node / web restart required.**

## Verify

```sql
-- After a new wishlist click on the store:
SELECT section, count()
FROM web_tracking.fact_product_interactions
WHERE website_id = 1009
  AND created_at > now() - INTERVAL 1 DAY
GROUP BY section
ORDER BY count() DESC;
```

Expect rows for `add_to_wishlist`, `remove_from_wishlist`.

```sql
-- Historical wishlist stuck in custom events (pre-fix):
SELECT event_name, count()
FROM web_tracking.fact_custom_events
WHERE website_id = 1009
  AND event_name IN ('add_to_wishlist', 'remove_from_wishlist')
  AND created_at > now() - INTERVAL 30 DAY
GROUP BY event_name;
```

If counts exist here but not in `fact_product_interactions`, run the backfill section in `14_recreate_mv_fact_product_wishlist.sql`.

## Booxoo (website_id 1009)

Payload example is valid — SDK and ingest are fine. Apply the MV recreate on **`10.180.0.126`** (same host used for DDL apply), then trigger one wishlist action and refresh Product Analytics.
