SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS daily_report_email_log
FROM campaign.daily_report_email_deliveries
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
