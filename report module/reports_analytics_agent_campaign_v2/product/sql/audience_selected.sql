SELECT
    {{dimension_select}}
    COALESCE(SUM(campaigns.audience_count),0)::bigint AS audience_selected

FROM (
{{base_campaign}}
) campaigns
WHERE {{scope_sql}}
  AND {{time_sql}}
  AND {{ppc_exclude_sql}}
  AND {{filters_sql}}

{{group_by_sql}}
{{limit_sql}}
