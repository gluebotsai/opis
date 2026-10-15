
  create view "worktual_bigint"."ticketing_staging"."stg_agent_queue_members__dbt_tmp"
    
    
  as (
    

select
    cast(id as text)                as queue_membership_id,
    cast(organization_id as text)   as organization_id,
    cast(queue_id as text)          as queue_id,
    cast(user_id as text)           as user_id,
    created_at
from "worktual_bigint"."ticketing"."agent_queue_members"
  );