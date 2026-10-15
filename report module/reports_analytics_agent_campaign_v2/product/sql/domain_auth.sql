SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS domain_count,
    COUNT(*) FILTER (WHERE spf_ok AND dkim_ok AND dmarc_ok)::bigint AS fully_authenticated
FROM campaign.email_domains
WHERE organization_id = {{org_id}}
{{group_by_sql}}
{{limit_sql}}
