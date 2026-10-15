
    
    select
      count(*) as failures,
      count(*) != 0 as should_warn,
      count(*) != 0 as should_error
    from (
      
    
  
    
    



select execution_id
from "worktual_bigint"."ccass_marts_aiccaas"."mart_copilot_skill_executions"
where execution_id is null



  
  
      
    ) dbt_internal_test