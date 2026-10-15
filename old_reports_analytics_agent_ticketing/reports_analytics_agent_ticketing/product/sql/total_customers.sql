SELECT
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM accounts.active_products ap
            WHERE ap.organization_id = {{org_id}}
              AND ap.product_id = 'ticketing'
        )
        THEN (
            SELECT COUNT(*)::bigint
            FROM cdp.customer_profile p
            WHERE p.organization_id = {{org_id}}
              AND p.contact_type IN ('lead', 'customer')
        )
        ELSE 0::bigint
    END AS total_customers
