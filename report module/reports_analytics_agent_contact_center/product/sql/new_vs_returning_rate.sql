WITH base_conversation AS (
{{base_conversation}}
),
contacts_in_window AS (
    SELECT DISTINCT contact_id {{grain_extra}}
    FROM base_conversation
    WHERE {{scope_sql}}
      AND {{time_sql}}
      AND {{segment_sql}}
      AND {{filters_sql}}
      AND contact_id IS NOT NULL
),
contact_stats AS (
    SELECT
        contact_id,
        COUNT(*)::bigint AS convos,
        MIN(created_at) AS first_at
    FROM ccass.conversations
    WHERE organization_id = {org_id}
      AND contact_id IS NOT NULL
    GROUP BY contact_id
)
SELECT
    {{dimension_select}}
    COUNT(cw.contact_id)::bigint AS total_contacts,
    COUNT(*) FILTER (WHERE {{returning_predicate}})::bigint AS returning_contacts,
    COUNT(*) FILTER (WHERE NOT ({{returning_predicate}}))::bigint AS new_contacts,
    ROUND(
        COUNT(*) FILTER (WHERE NOT ({{returning_predicate}}))::numeric
        / NULLIF(COUNT(cw.contact_id), 0),
        4
    ) AS new_contact_rate,
    ROUND(
        COUNT(*) FILTER (WHERE {{returning_predicate}})::numeric
        / NULLIF(COUNT(cw.contact_id), 0),
        4
    ) AS returning_contact_rate
FROM contacts_in_window cw
LEFT JOIN contact_stats cs ON cs.contact_id = cw.contact_id
{{group_by_sql}}
{{limit_sql}}
