SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS entitlement_health
FROM campaign.organization_products
WHERE organization_id = {{org_id}}
  AND branch_id = {{branch_id}}
  AND product_code = 'campaign'
{{group_by_sql}}
{{limit_sql}}
