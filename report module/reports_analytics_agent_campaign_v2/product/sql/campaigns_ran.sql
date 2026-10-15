SELECT
    {{dimension_select}}
    COUNT(DISTINCT campaigns.id)::bigint AS campaigns_ran

FROM (
{{base_campaign}}
) campaigns
{{channel_join}}
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{ppc_exclude_sql}}
  AND {{filters_sql}}

  AND campaigns.status IN ('live','completed','cancelled')
{{group_by_sql}}
{{limit_sql}}
