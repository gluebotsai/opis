SELECT
    {{dimension_select}}
    COALESCE(SUM(open_count),0)::bigint AS event_opens
FROM campaign.campaign_opportunity_events
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
