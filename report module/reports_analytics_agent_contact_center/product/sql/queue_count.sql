SELECT
    COUNT(*)::bigint AS queue_count
FROM ccass.queues q
WHERE q.organization_id = {org_id}
  AND q.status = 'active'
{{limit_sql}}
