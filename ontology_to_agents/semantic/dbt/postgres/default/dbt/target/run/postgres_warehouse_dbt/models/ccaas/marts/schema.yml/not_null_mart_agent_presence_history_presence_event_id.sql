
    
    select
      count(*) as failures,
      count(*) != 0 as should_warn,
      count(*) != 0 as should_error
    from (
      
    
  
    
    



select presence_event_id
from "worktual_bigint"."ccass_marts_aiccaas"."mart_agent_presence_history"
where presence_event_id is null



  
  
      
    ) dbt_internal_test