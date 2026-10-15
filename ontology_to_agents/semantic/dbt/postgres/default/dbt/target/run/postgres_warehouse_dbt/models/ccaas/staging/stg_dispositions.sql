
  create view "worktual_bigint"."ccass_staging_aiccaas"."stg_dispositions__dbt_tmp"
    
    
  as (
    select
    id as disposition_id,
    organization_id,
    code,
    label,
    category,
    outcome,
    is_active
from "worktual_bigint"."ccass"."dispositions"
  );