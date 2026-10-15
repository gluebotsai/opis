
    
    select
      count(*) as failures,
      count(*) != 0 as should_warn,
      count(*) != 0 as should_error
    from (
      
    
  
    
    

select
    presence_event_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_staging_aiccaas"."stg_agent_presence_history"
where presence_event_id is not null
group by presence_event_id
having count(*) > 1



  
  
      
    ) dbt_internal_test