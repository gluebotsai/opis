SELECT
    {{dimension_select}}
    CASE WHEN COALESCE(SUM(open_count),0) = 0 THEN NULL
    ELSE SUM(submission_count)::numeric / SUM(open_count) END AS event_conversion
FROM campaign.campaign_opportunity_events
WHERE organization_id = {{org_id}}
  AND {{time_sql}}
{{group_by_sql}}
{{limit_sql}}
