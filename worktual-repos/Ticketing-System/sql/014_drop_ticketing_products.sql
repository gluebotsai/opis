-- Remove obsolete local product catalog.
-- Tenant products live in inventory.products; entitlements use
-- ticketing.contact_products / ticketing.account_products (text product_id).

BEGIN;

DROP TABLE IF EXISTS ticketing.products;

COMMIT;
