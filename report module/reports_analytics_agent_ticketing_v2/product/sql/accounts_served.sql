WITH base_ticket AS (
{{base_ticket}}
),
served AS (
    SELECT
        base_ticket.status,
        base_ticket.priority,
        base_ticket.channel,
        base_ticket.category,
        base_ticket.skill,
        base_ticket.queue_name,
        base_ticket.assignee_name,
        base_ticket.resolver_name,
        base_ticket.customer_name,
        base_ticket.created_by_name,
        base_ticket.created_at,
        cp.id AS profile_id
    FROM base_ticket
    JOIN ticketing.contact_profile cp
        ON cp.id = base_ticket.customer_id
       AND cp.organization_id = base_ticket.organization_id
    WHERE {{scope_sql}}
      AND {{time_sql}}
      AND {{filters_sql}}
)
SELECT
    {{dimension_select}}
    COUNT(DISTINCT profile_id)::bigint AS accounts_served
FROM served
{{group_by_sql}}
