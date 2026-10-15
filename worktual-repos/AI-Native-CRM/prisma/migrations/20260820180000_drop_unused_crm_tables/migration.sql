-- Drop unused CRM tables: legacy service tickets, unbuilt catalog sync connectors,
-- and orphan B2C/commerce tables not mapped in Prisma or referenced by application code.

DROP TABLE IF EXISTS crm.catalog_integration_connections CASCADE;
DROP TABLE IF EXISTS crm.service_tickets CASCADE;

DROP TABLE IF EXISTS crm.b2c_wishlist_items CASCADE;
DROP TABLE IF EXISTS crm.b2c_winback_jobs CASCADE;
DROP TABLE IF EXISTS crm.b2c_upsell_jobs CASCADE;
DROP TABLE IF EXISTS crm.b2c_store_channels CASCADE;
DROP TABLE IF EXISTS crm.b2c_store_cart_lines CASCADE;
DROP TABLE IF EXISTS crm.b2c_store_carts CASCADE;
DROP TABLE IF EXISTS crm.b2c_shipment_update_jobs CASCADE;
DROP TABLE IF EXISTS crm.b2c_review_ask_jobs CASCADE;
DROP TABLE IF EXISTS crm.b2c_reply_analysis_jobs CASCADE;
DROP TABLE IF EXISTS crm.b2c_repeat_purchase_jobs CASCADE;
DROP TABLE IF EXISTS crm.b2c_product_views CASCADE;
DROP TABLE IF EXISTS crm.b2c_product_variants CASCADE;
DROP TABLE IF EXISTS crm.b2c_product_page_links CASCADE;
DROP TABLE IF EXISTS crm.b2c_order_lifecycle_jobs CASCADE;
DROP TABLE IF EXISTS crm.b2c_inventory_levels CASCADE;
DROP TABLE IF EXISTS crm.b2c_contact_preferences CASCADE;
DROP TABLE IF EXISTS crm.b2c_connector_states CASCADE;
DROP TABLE IF EXISTS crm.b2c_commerce_transactions CASCADE;
DROP TABLE IF EXISTS crm.b2c_commerce_return_lines CASCADE;
DROP TABLE IF EXISTS crm.b2c_commerce_returns CASCADE;
DROP TABLE IF EXISTS crm.b2c_commerce_order_lines CASCADE;
DROP TABLE IF EXISTS crm.b2c_commerce_order_events CASCADE;
DROP TABLE IF EXISTS crm.b2c_commerce_order_adjustments CASCADE;
DROP TABLE IF EXISTS crm.b2c_commerce_fulfillment_lines CASCADE;
DROP TABLE IF EXISTS crm.b2c_commerce_fulfillments CASCADE;
DROP TABLE IF EXISTS crm.b2c_commerce_orders CASCADE;
DROP TABLE IF EXISTS crm.b2c_catalog_product_sources CASCADE;
DROP TABLE IF EXISTS crm.b2c_cancel_feedback_jobs CASCADE;
DROP TABLE IF EXISTS crm.b2c_back_in_stock_jobs CASCADE;
DROP TABLE IF EXISTS crm.b2c_abandoned_cart_jobs CASCADE;

DROP TABLE IF EXISTS crm.commerce_journey_events CASCADE;
DROP TABLE IF EXISTS crm.commerce_journeys CASCADE;
DROP TABLE IF EXISTS crm.commerce_external_identities CASCADE;
DROP TABLE IF EXISTS crm.webhook_deliveries CASCADE;
DROP TABLE IF EXISTS crm.org_commerce_settings CASCADE;

DROP TYPE IF EXISTS crm."CatalogSyncProvider";
DROP TYPE IF EXISTS crm."CatalogConnectionStatus";
DROP TYPE IF EXISTS crm."TicketStatus";
