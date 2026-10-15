WITH missed AS (
    SELECT COUNT(*)::bigint AS missed_count
    FROM ccass.agent_missed_contacts
    WHERE organization_id = {org_id}
      AND {{scope_sql}}
      AND (missed_at >= TIMESTAMPTZ '{{time_start}}' AND missed_at < TIMESTAMPTZ '{{time_end}}')
      AND {{segment_sql}}
      AND {{filters_sql}}
),
accepted AS (
    SELECT COUNT(*)::bigint AS accepted_count
    FROM ccass.conversation_assignments
    WHERE organization_id = {org_id}
      AND state = 'accepted'
      AND {{scope_sql}}
      AND (offered_at >= TIMESTAMPTZ '{{time_start}}' AND offered_at < TIMESTAMPTZ '{{time_end}}')
)
SELECT
    m.missed_count,
    (m.missed_count + a.accepted_count)::bigint AS total_contacts_offered,
    ROUND(
        m.missed_count::numeric
        / NULLIF(m.missed_count + a.accepted_count, 0),
        4
    ) AS missed_contact_rate
FROM missed m, accepted a
{{limit_sql}}
