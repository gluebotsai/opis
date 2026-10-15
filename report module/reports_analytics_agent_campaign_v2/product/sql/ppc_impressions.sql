SELECT
    {{dimension_select}}
    COALESCE(SUM(NULLIF(launch_plan#>>'{channel_run,impressions}','')::numeric),0) AS ppc_impressions

FROM (
{{base_campaign}}
) campaigns
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{ppc_exclude_sql}}
  AND {{filters_sql}}

{{group_by_sql}}
{{limit_sql}}
