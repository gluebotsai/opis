
    
    select
      count(*) as failures,
      count(*) != 0 as should_warn,
      count(*) != 0 as should_error
    from (
      
    
  
    
    

select
    team_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_staging_aiccaas"."stg_setup_teams"
where team_id is not null
group by team_id
having count(*) > 1



  
  
      
    ) dbt_internal_test