
    
    select
      count(*) as failures,
      count(*) != 0 as should_warn,
      count(*) != 0 as should_error
    from (
      
    
  
    
    

select
    queue_agent_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_staging_aiccaas"."stg_setup_ccaas_queue_agents"
where queue_agent_id is not null
group by queue_agent_id
having count(*) > 1



  
  
      
    ) dbt_internal_test