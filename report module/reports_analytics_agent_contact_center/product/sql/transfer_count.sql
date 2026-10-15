SELECT
    {{dimension_select}}
    COUNT(DISTINCT ct.conversation_id)::bigint AS transfer_count
FROM ccass.conversation_transfers ct
LEFT JOIN ccass.queues fq ON fq.id = ct.from_queue_id
LEFT JOIN ccass.queues tq ON tq.id = ct.to_queue_id
WHERE ct.organization_id = {org_id}
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{segment_sql}}
  AND {{filters_sql}}
{{group_by_sql}}
{{limit_sql}}
