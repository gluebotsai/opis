
    
    select
      count(*) as failures,
      count(*) != 0 as should_warn,
      count(*) != 0 as should_error
    from (
      
    
  
    
    

select
    task_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_staging_aiccaas"."stg_agent_tasks"
where task_id is not null
group by task_id
having count(*) > 1



  
  
      
    ) dbt_internal_test