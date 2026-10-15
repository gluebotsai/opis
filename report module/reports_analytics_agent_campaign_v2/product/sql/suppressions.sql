SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS suppressions
FROM campaign.email_suppressions
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
