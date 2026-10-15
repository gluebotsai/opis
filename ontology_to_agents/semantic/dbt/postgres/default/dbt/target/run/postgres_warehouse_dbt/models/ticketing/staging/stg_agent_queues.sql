
  create view "worktual_bigint"."ticketing_staging"."stg_agent_queues__dbt_tmp"
    
    
  as (
    

select
    cast(id as text)                as queue_id,
    cast(organization_id as text)   as organization_id,
    cast(queue_name as text)        as queue_name,
    cast(description as text)       as description,
    cast(type as text)              as queue_type,
    cast(type as text)              as type,
    cast(sla_status as text)        as queue_sla_status,
    cast(sla_status as text)        as sla_status,
    cast(external_id as text)       as queue_external_id,
    cast(external_id as text)       as external_id,
    open_tickets,
    assigned,
    true                            as is_active,
    created_at,
    updated_at
from "worktual_bigint"."ticketing"."agent_queues"
  );