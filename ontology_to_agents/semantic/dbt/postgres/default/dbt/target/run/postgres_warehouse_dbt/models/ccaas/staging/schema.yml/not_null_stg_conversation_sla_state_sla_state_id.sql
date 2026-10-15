
    
    select
      count(*) as failures,
      count(*) != 0 as should_warn,
      count(*) != 0 as should_error
    from (
      
    
  
    
    



select sla_state_id
from "worktual_bigint"."ccass_staging_aiccaas"."stg_conversation_sla_state"
where sla_state_id is null



  
  
      
    ) dbt_internal_test