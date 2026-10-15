SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS identity_keys_count
FROM cdp.identity_keys
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
