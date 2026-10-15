SELECT
    {{dimension_select}}
    COUNT(DISTINCT campaigns.id)::bigint AS campaigns_total

FROM (
{{base_campaign}}
) campaigns
{{channel_join}}
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{ppc_exclude_sql}}
  AND {{filters_sql}}

{{group_by_sql}}
{{limit_sql}}
