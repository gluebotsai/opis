SELECT
    {{dimension_select}}
    CASE WHEN COALESCE(SUM(NULLIF(launch_plan#>>'{channel_run,clicks}','')::numeric),0) = 0 THEN NULL
    ELSE SUM(NULLIF(launch_plan#>>'{channel_run,spend}','')::numeric)
         / SUM(NULLIF(launch_plan#>>'{channel_run,clicks}','')::numeric) END AS ppc_cpc

FROM (
{{base_campaign}}
) campaigns
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{ppc_exclude_sql}}
  AND {{filters_sql}}

{{group_by_sql}}
{{limit_sql}}
