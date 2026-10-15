
    
    select
      count(*) as failures,
      count(*) != 0 as should_warn,
      count(*) != 0 as should_error
    from (
      
    
  
    
    



select team_id
from "worktual_bigint"."ccass_staging_aiccaas"."stg_setup_teams"
where team_id is null



  
  
      
    ) dbt_internal_test