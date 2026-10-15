
  create view "worktual_bigint"."ccass_staging_aiccaas"."stg_setup_teams__dbt_tmp"
    
    
  as (
    

select
    id as team_id,
    organization_id,
    name as team_name,
    status,
    created_at
from "worktual_bigint"."accounts"."setup_teams"
  );