
  create view "worktual_bigint"."ticketing_staging"."stg_sla_policies__dbt_tmp"
    
    
  as (
    

select
    cast(id as text)                as sla_policy_id,
    cast(organization_id as text)   as organization_id,
    cast(priority as text)          as priority,
    cast(display_name as text)      as policy_name,
    first_response_hours,
    resolution_hours,
    created_at,
    updated_at
from "worktual_bigint"."ticketing"."sla_policies"
  );