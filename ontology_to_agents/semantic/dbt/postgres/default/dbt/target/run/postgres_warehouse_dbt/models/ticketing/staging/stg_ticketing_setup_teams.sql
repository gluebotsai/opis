
  create view "worktual_bigint"."ticketing_staging"."stg_setup_teams__dbt_tmp"
    
    
  as (
    

select
    team_id,
    organization_id,
    name                                            as myaccount_team_name,
    description                                     as team_description,
    status                                          as team_status,
    created_at,
    updated_at
from "worktual_bigint"."shared_staging"."stg_accounts_setup_teams"
  );