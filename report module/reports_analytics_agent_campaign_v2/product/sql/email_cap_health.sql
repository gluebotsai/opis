SELECT
    {{dimension_select}}
    hourly_cap,
    daily_cap,
    warmup_stage,
    health_status
FROM campaign.email_sending_caps
WHERE organization_id = {{org_id}}
{{limit_sql}}
